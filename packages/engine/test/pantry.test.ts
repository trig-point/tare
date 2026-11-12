import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Database } from "better-sqlite3";
import { createGrocyClient } from "../src/grocy/client.ts";
import { createJobRunner } from "../src/jobs.ts";
import { createPantryService } from "../src/pantry/service.ts";
import { fixture } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { grocy as config, grocyFetch } from "./support/pantry-fake.ts";

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
function setupService(context: TestContext) {
  const setup = fixture(context);
  const data = {
    now: new Date("2026-01-01T00:00:00Z"),
    stock: stock as unknown,
    detail: { product, quantity_unit_stock: unit } as unknown,
    details: {} as Record<string, unknown>,
    catalog: [
      { id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 },
    ] as unknown,
    barcodes: [] as unknown,
  };
  const grocy = grocyFetch({
    "/stock": () => data.stock,
    "/objects/products": () => data.catalog,
    "/objects/product_barcodes": () => data.barcodes,
    "/stock/products/:id": ({ id }: { id?: string }) =>
      data.details[id ?? ""] ?? data.detail,
  });
  const client = createGrocyClient({
    config,
    ownerId: setup.admin.id,
    fetch: grocy.fetch,
  });
  const options = {
    database: setup.database,
    config,
    ownerId: setup.admin.id,
    clock: { now: () => data.now },
    client,
  };
  const service = createPantryService(options);
  return { ...setup, options, service, data, hold: grocy.hold };
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
  for (const invalid of [
    { stock: [...stock, ...stock] },
    { stock: null },
    {
      stock,
      detail: {
        product: { ...product, qu_id_stock: 2 },
        quantity_unit_stock: unit,
      },
    },
  ]) {
    Object.assign(setup.data, invalid);
    const failed = await service.refresh(admin.id);
    assert.equal(failed.error?.reason, "invalid_response");
    assert.deepEqual({ ...failed, error: null }, { ...first, stale: true });
  }
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

for (const outcome of ["success", "failure"] as const)
  test(`job/manual joining discards obsolete ${outcome}`, async (context) => {
    const setup = setupService(context);
    const entered = Promise.withResolvers<void>();
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof setup.options.client.stock>>
      >();
    const successorEntered = Promise.withResolvers<void>();
    const successorStock =
      Promise.withResolvers<
        Awaited<ReturnType<typeof setup.options.client.stock>>
      >();
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
    context.after(() => runner.stop());
    const job = runner.runNow(service.job.name);
    await entered.promise;
    const old = service.refresh(setup.admin.id);
    service.reset(setup.admin.id, true);
    const successor = service.refresh(setup.admin.id);
    pending.resolve(
      outcome === "failure" ? undefined : { status: "ok", value: stock },
    );
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
  });

test("shutdown rejects queued refreshes and drains the active request", async (context) => {
  const setup = setupService(context);
  const detailStarted = Promise.withResolvers<void>();
  const detailPending =
    Promise.withResolvers<
      Awaited<ReturnType<typeof setup.options.client.product>>
    >();
  let details = 0;
  const draining = createPantryService({
    ...setup.options,
    client: {
      ...setup.options.client,
      stock: async () => ({
        status: "ok",
        value: [
          stockRow,
          { ...stockRow, product_id: 2, product: { ...product, id: 2 } },
        ],
      }),
      catalog: async () => ({
        status: "ok",
        value: [
          { id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 },
          { id: 2, name: "Synthetic item", qu_id_stock: 1, active: 1 },
        ],
      }),
      barcodes: async () => ({ status: "ok", value: [] }),
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

function addFoods(database: Database, userId: number) {
  const insert = (sql: string, ...values: unknown[]) =>
    Number(database.prepare(sql).run(...values).lastInsertRowid);
  const sourceSql =
    "INSERT INTO source_foods (source, source_key, name, barcode, provenance, fetched_at) VALUES ('off', ?, 'Synthetic cereal', ?, 'label', '2026-01-01T00:00:00.000Z')";
  return {
    food: insert(
      "INSERT INTO foods (user_id, name, provenance) VALUES (?, 'Synthetic soup', 'label')",
      userId,
    ),
    source: insert(sourceSql, "0000000000017", "0000000000017"),
    unlabelled: insert(sourceSql, "synthetic-key", null),
  };
}
const gram = { id: 5, name: "gram", name_plural: "grams" };

test("bindings validate, replace, track refresh status and clear on reset", async (context) => {
  const { service, admin, database, data, hold } = setupService(context);
  const ids = addFoods(database, admin.id);
  const generation = Number(service.read(admin.id).generation);
  const food = { reference_kind: "food", reference_id: ids.food } as const;
  const source = { reference_kind: "source_food", reference_id: ids.source };
  const save = (change: object) =>
    service.save(admin.id, {
      ...food,
      product_id: 1,
      stock_unit_id: 1,
      quantity_per_serving: 0.5,
      expected_generation: generation,
      ...change,
    });
  data.catalog = [
    { id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 },
    { id: 2, name: "Synthetic item", qu_id_stock: 1, active: 1 },
    { id: 3, name: "Synthetic item", qu_id_stock: 1, active: 0 },
  ];
  data.details["2"] = {
    product: { ...product, id: 2, enable_tare_weight_handling: 1 },
    quantity_unit_stock: unit,
  };
  const saved = (await save({})).bindings;
  assert.deepEqual(saved, [
    {
      ...food,
      product_id: 1,
      stock_unit_id: 1,
      quantity_per_serving: 0.5,
      status: "valid",
    },
  ]);
  for (const [change, code] of [
    [{ product_id: 2 }, "pantry_binding_conflict"],
    [{ ...source, product_id: 2 }, "pantry_tare_weight"],
    [{ ...source, product_id: 3 }, "pantry_product_missing"],
    [{ ...source, stock_unit_id: 5 }, "pantry_unit_changed"],
    [
      { ...source, expected_generation: generation + 1 },
      "pantry_generation_changed",
    ],
    [{ ...source, reference_id: ids.source + 99 }, "food_not_found"],
  ] as const)
    await assert.rejects(save(change), { code });
  assert.deepEqual(service.read(admin.id).bindings, saved);

  data.stock = [{ ...stockRow, product: { ...product, qu_id_stock: 5 } }];
  data.detail = {
    product: { ...product, qu_id_stock: 5 },
    quantity_unit_stock: gram,
  };
  assert.deepEqual((await service.refresh(admin.id)).bindings, [
    { ...saved[0], status: "unit_mismatch" },
  ]);
  const reconfirmed = await save({
    stock_unit_id: 5,
    quantity_per_serving: 200,
  });
  assert.deepEqual(reconfirmed.bindings, [
    { ...saved[0], stock_unit_id: 5, quantity_per_serving: 200 },
  ]);
  data.stock = [];
  assert.equal((await service.refresh(admin.id)).bindings[0]?.status, "valid");
  data.catalog = null;
  const failed = await service.refresh(admin.id);
  assert.equal(failed.error?.reason, "invalid_response");
  assert.equal(failed.bindings[0]?.status, "valid");
  data.catalog = [{ id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 }];
  data.detail = {
    product: { ...product, qu_id_stock: 5, enable_tare_weight_handling: 1 },
    quantity_unit_stock: gram,
  };
  const tared = await service.refresh(admin.id);
  assert.equal(tared.bindings[0]?.status, "tare_enabled");
  data.stock = [{ ...stockRow, product: { ...product, qu_id_stock: 5 } }];
  data.catalog = [{ id: 1, name: "Synthetic item", qu_id_stock: 1, active: 0 }];
  const missing = await service.refresh(admin.id);
  assert.deepEqual(missing.products, []);
  assert.equal(missing.bindings[0]?.status, "product_missing");

  data.catalog = [{ id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 }];
  data.stock = stock;
  data.detail = { product, quantity_unit_stock: unit };
  const held = async <Value>(work: () => Promise<Value>) => {
    const paused = hold(/^\/stock\/products\/\d+$/);
    const started = work();
    await paused.reached;
    return { started, release: paused.release };
  };
  const stale = await held(() => service.refresh(admin.id));
  service.remove(admin.id, food);
  await save({ quantity_per_serving: 2 });
  stale.release();
  assert.equal((await stale.started).error, null);
  const recreated = { ...saved[0], quantity_per_serving: 2 };
  assert.deepEqual(service.read(admin.id).bindings, [recreated]);

  const overtaken = await held(() => save(source));
  service.reset(admin.id, true);
  overtaken.release();
  await assert.rejects(overtaken.started, {
    code: "pantry_generation_changed",
  });
  assert.deepEqual(service.read(admin.id).bindings, []);
  assert.deepEqual(
    database.prepare("SELECT count(*) AS count FROM pantry_bindings").get(),
    { count: 0 },
  );
});

test("barcode proposals need one exact active product and never save", async (context) => {
  const { service, admin, database, data } = setupService(context);
  const ids = addFoods(database, admin.id);
  const propose = (
    reference_kind: "food" | "source_food",
    reference_id: number,
  ) => service.propose(admin.id, { reference_kind, reference_id });
  const row = (product_id: number, barcode = "0000000000017") => ({
    product_id,
    barcode,
    qu_id: null,
    amount: null,
  });
  data.catalog = [
    { id: 1, name: "Synthetic item", qu_id_stock: 1, active: 1 },
    { id: 2, name: "Synthetic item", qu_id_stock: 1, active: 1 },
    { id: 3, name: "Synthetic item", qu_id_stock: 1, active: 0 },
  ];
  data.barcodes = [row(1), row(1), row(3), row(2, "00000000000170")];
  assert.deepEqual(await propose("source_food", ids.source), {
    outcome: "proposal",
    proposal: {
      generation: service.read(admin.id).generation,
      product_id: 1,
      name: product.name,
      stock_unit: unit,
    },
    error: null,
  });
  assert.deepEqual(await propose("food", ids.food), {
    outcome: "unsupported",
    proposal: null,
    error: null,
  });
  assert.deepEqual(await propose("source_food", ids.unlabelled), {
    outcome: "no_barcode",
    proposal: null,
    error: null,
  });
  await assert.rejects(propose("source_food", ids.source + 99), {
    code: "food_not_found",
  });
  data.detail = {
    product: { ...product, enable_tare_weight_handling: 1 },
    quantity_unit_stock: unit,
  };
  assert.deepEqual(await propose("source_food", ids.source), {
    outcome: "tare_enabled",
    proposal: null,
    error: null,
  });
  data.barcodes = [row(1), row(2)];
  assert.deepEqual(await propose("source_food", ids.source), {
    outcome: "ambiguous",
    proposal: null,
    error: null,
  });
  data.barcodes = [row(3)];
  assert.deepEqual(await propose("source_food", ids.source), {
    outcome: "no_match",
    proposal: null,
    error: null,
  });
  data.barcodes = null;
  assert.deepEqual(await propose("source_food", ids.source), {
    outcome: "failed",
    proposal: null,
    error: { reason: "invalid_response", http_status: 200 },
  });
  assert.deepEqual(service.read(admin.id).bindings, []);
});
