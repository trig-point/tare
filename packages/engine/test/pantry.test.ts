import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createGrocyClient } from "../src/grocy/client.ts";
import { createJobRunner } from "../src/jobs.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { credentials, fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "invented-secret",
  username: credentials.username,
};
const product = {
  id: 1,
  name: "Synthetic beans",
  qu_id_stock: 1,
  enable_tare_weight_handling: 0 as const,
};
const unit = { id: 1, name: "can", name_plural: null };
const stockRow = {
  product_id: 1,
  amount: -2,
  best_before_date: "2999-12-31",
  product,
};
const stock = [stockRow];
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setupService(context: TestContext) {
  const setup = fixture(context);
  const data: { now: Date; stock: unknown; detail: unknown } = {
    now: new Date("2026-01-01T00:00:00Z"),
    stock,
    detail: { product, quantity_unit_stock: unit },
  };
  const client = createGrocyClient({
    config,
    ownerId: setup.admin.id,
    fetch: async (url) => {
      return Response.json(
        String(url).endsWith("/stock") ? data.stock : data.detail,
      );
    },
  });
  const options = {
    database: setup.database,
    config,
    ownerId: setup.admin.id,
    clock: { now: () => data.now },
    client,
  };
  const service = createPantryService(options);
  return { ...setup, options, service, data };
}

test("snapshots replace atomically, preserve success on failed assembly and age from fetch start", async (context) => {
  const setup = setupService(context);
  const { service, admin, database } = setup;
  assert.equal(service.read(admin.id).state, "never_refreshed");
  assert.equal(service.read(admin.id).stale, true);
  const first = await service.refresh(admin.id);
  assert.deepEqual(first.products, [
    {
      product_id: 1,
      name: product.name,
      amount: -2,
      stock_unit: unit,
      best_before_date: "2999-12-31",
      grams: null,
    },
  ]);
  assert.equal(first.stale, false);
  setup.data.now = new Date(setup.data.now.getTime() + 600_001);
  for (const bad of [
    [...stock, ...stock],
    [{ ...stock[0], amount: "bad" }],
    null,
  ]) {
    setup.data.stock = bad;
    const failed = await service.refresh(admin.id);
    assert.deepEqual(failed.products, first.products);
    assert.equal(failed.last_success_at, first.last_success_at);
    assert.equal(failed.fetch_started_at, first.fetch_started_at);
    assert.equal(failed.stale, true);
    assert.equal(failed.error?.reason, "invalid_response");
  }
  setup.data.stock = stock;
  setup.data.detail = {
    product: { ...product, qu_id_stock: 2 },
    quantity_unit_stock: unit,
  };
  assert.equal(
    (await service.refresh(admin.id)).error?.reason,
    "invalid_response",
  );
  setup.data.detail = { product, quantity_unit_stock: unit };
  database.exec(
    "CREATE TRIGGER reject_pantry BEFORE INSERT ON pantry_products BEGIN SELECT RAISE(ABORT, 'synthetic refusal'); END",
  );
  await assert.rejects(service.refresh(admin.id), /synthetic refusal/);
  assert.deepEqual(service.read(admin.id).products, first.products);
  database.exec("DROP TRIGGER reject_pantry");
  setup.data.stock = [];
  const empty = await service.refresh(admin.id);
  assert.equal(empty.state, "ready");
  assert.deepEqual(empty.products, []);
  assert.equal(empty.error, null);
});

test("identity changes latch until reset, no-op preserves and disabled never touches storage", async (context) => {
  const setup = setupService(context);
  const { admin, options } = setup;
  const original = await setup.service.refresh(admin.id);
  assert.deepEqual(setup.service.reset(admin.id), original);
  for (const changed of [
    { config: { ...config, url: "http://replacement/api" } },
    { config: { ...config, username: "replacement" } },
    { ownerId: admin.id + 1 },
  ]) {
    const drifted = createPantryService({ ...options, ...changed });
    const owner = changed.ownerId ?? admin.id;
    assert.equal((await drifted.refresh(owner)).state, "reset_required");
    const reverted = createPantryService(options);
    assert.equal(reverted.read(admin.id).state, "reset_required");
    assert.deepEqual(reverted.read(admin.id).products, []);
    assert.equal(reverted.reset(admin.id).state, "never_refreshed");
  }
  const service = createPantryService(options);
  const before = service.read(admin.id).generation;
  assert.equal(service.reset(admin.id, true).generation, Number(before) + 1);
  const disabled = createPantryService({
    ...options,
    config: null,
    ownerId: null,
  });
  setup.database.close();
  assert.equal(disabled.read(admin.id).state, "disabled");
  assert.equal(disabled.reset(admin.id, true).generation, null);
  assert.equal((await disabled.refresh(admin.id)).state, "disabled");
});

for (const obsolete of [undefined, { status: "ok" as const, value: stock }])
  test(`job/manual joining discards obsolete ${obsolete ? "success" : "failure"}, then drains shutdown`, async (context) => {
    const setup = setupService(context);
    const entered = deferred<void>();
    const pending =
      deferred<Awaited<ReturnType<typeof setup.options.client.stock>>>();
    const successorEntered = deferred<void>();
    const successorStock =
      deferred<Awaited<ReturnType<typeof setup.options.client.stock>>>();
    let calls = 0;
    const client = {
      ...setup.options.client,
      stock: () => {
        calls++;
        entered.resolve();
        if (calls === 1) return pending.promise;
        successorEntered.resolve();
        return successorStock.promise;
      },
    };
    const service = createPantryService({ ...setup.options, client });
    const reports: string[] = [];
    const runner = createJobRunner({
      ...setup.options,
      timezone: "UTC",
      report: (code) => reports.push(code),
    });
    runner.register(service.job);
    runner.start();
    const job = runner.runNow(service.job.name);
    await entered.promise;
    const old = service.refresh(setup.admin.id);
    service.reset(setup.admin.id, true);
    const successor = service.refresh(setup.admin.id);
    pending.resolve(obsolete);
    await successorEntered.promise;
    const discarded = service.read(setup.admin.id);
    successorStock.resolve(await setup.options.client.stock(setup.admin.id));
    await Promise.all([job, old, successor]);
    assert.equal(calls, 2);
    assert.equal(service.read(setup.admin.id).error, null);
    assert.equal(service.read(setup.admin.id).products.length, 1);
    await runner.stop();
    assert.deepEqual(reports, []);
    assert.equal(discarded.state, "never_refreshed");
    assert.equal(discarded.error, null);
    const detailStarted = deferred<void>();
    const detailPending =
      deferred<Awaited<ReturnType<typeof client.product>>>();
    let details = 0;
    const draining = createPantryService({
      ...setup.options,
      client: {
        stock: async () => ({
          status: "ok",
          value: [
            stockRow,
            { ...stockRow, product_id: 2, product: { ...product, id: 2 } },
          ],
        }),
        product: () => {
          details++;
          detailStarted.resolve();
          return detailPending.promise;
        },
      },
    });
    const work = draining.refresh(setup.admin.id);
    await detailStarted.promise;
    draining.reset(setup.admin.id, true);
    const queued = assert.rejects(
      draining.refresh(setup.admin.id),
      /pantry_stopping/,
    );
    const stopped = draining.stop();
    await assert.rejects(draining.refresh(setup.admin.id), /pantry_stopping/);
    detailPending.resolve({
      status: "ok",
      value: { product, quantity_unit_stock: unit },
    });
    await assert.rejects(work, /pantry_stopping/);
    await stopped;
    await queued;
    assert.equal(details, 1);
  });

test("refresh failures fail jobs", async (context) => {
  const setup = setupService(context);
  setup.data.stock = null;
  const reports: string[] = [];
  const runner = createJobRunner({
    ...setup.options,
    timezone: "UTC",
    report: (code) => reports.push(code),
  });
  runner.register(setup.service.job);
  runner.start();
  context.after(() => runner.stop());
  assert.equal((await runner.runNow(setup.service.job.name)).status, "failed");
  assert.deepEqual(reports, []);
});

test("colliding errors are withheld from storage", async (context) => {
  const setup = setupService(context);
  setup.data.stock = null;
  for (const apiKey of ["invalid_response", "reason"]) {
    const service = createPantryService({
      ...setup.options,
      config: { ...config, apiKey },
    });
    if (apiKey === "reason")
      await assert.rejects(service.refresh(setup.admin.id));
    else
      assert.equal(
        (await service.refresh(setup.admin.id)).error?.reason,
        "response_withheld",
      );
    const row = setup.database
      .prepare("SELECT error FROM pantry_connection")
      .get() as { error: string | null };
    assert.equal(row.error?.includes(apiKey) ?? false, false);
  }
});

test("pantry schema rejects malformed persisted state", (context) => {
  const { database } = setupService(context);
  for (const [column, value] of [
    ["generation", 0],
    ["reset_required", 2],
    ["fetch_started_at", "invalid"],
    ["last_success_at", "2026-02-30T00:00:00.000Z"],
    ["username", Buffer.from("invalid")],
  ] as const)
    assert.throws(() =>
      database.prepare(`UPDATE pantry_connection SET ${column} = ?`).run(value),
    );
});

test("post-reset caller starts a successor after obsolete persistence rejects", async (context) => {
  const setup = setupService(context);
  const entered = deferred<void>();
  const pending =
    deferred<Awaited<ReturnType<typeof setup.options.client.stock>>>();
  let calls = 0;
  const service = createPantryService({
    ...setup.options,
    client: {
      ...setup.options.client,
      stock: () => {
        calls++;
        entered.resolve();
        return calls === 1
          ? pending.promise
          : setup.options.client.stock(setup.admin.id);
      },
    },
  });
  const old = service.refresh(setup.admin.id);
  const rejected = assert.rejects(old, /synthetic write failure/);
  await entered.promise;
  service.reset(setup.admin.id, true);
  const successor = service.refresh(setup.admin.id);
  const transaction = context.mock.method(setup.database, "transaction", () => {
    transaction.mock.restore();
    throw new Error("synthetic write failure");
  });
  pending.resolve({ status: "ok", value: [] });
  assert.equal((await successor).products.length, 1);
  await rejected;
  assert.equal(calls, 2);
});
