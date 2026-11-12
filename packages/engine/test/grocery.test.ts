import assert from "node:assert/strict";
import { createGroceryClient } from "../src/grocy/grocery.ts";
import { test } from "./support/hang-ceiling.ts";

const config = {
  url: "http://grocy/api",
  apiKey: "synthetic-key",
  username: "example-alex",
};
// Values copied from a disposable Grocy 4.7.1 capture.
const purchase = {
  id: 3,
  product_id: 1,
  amount: 0.75,
  best_before_date: "2999-12-31",
  purchased_date: "2026-11-10",
  transaction_type: "purchase",
  undone: 0,
  location_id: 2,
  transaction_id: "6af62c0058842",
};
const add = {
  amount: 0.75,
  best_before_date: "2999-12-31",
  purchased_date: "2026-11-10",
  location_id: 2,
};

function fakeGrocy(respond: () => Response | Promise<Response>) {
  const sent: { url: string; method: string; body?: unknown }[] = [];
  const client = createGroceryClient({
    config,
    ownerId: 1,
    fetch: async (url, init) => {
      const body =
        init?.body instanceof ReadableStream
          ? JSON.parse(await new Response(init.body).text())
          : undefined;
      sent.push({ url: String(url), method: init?.method ?? "GET", body });
      return respond();
    },
  });
  return { client, sent };
}

test("Grocery writes send the frozen body once and classify each outcome", async () => {
  let reply: () => Response = () => Response.json({ created_object_id: "4" });
  const { client, sent } = fakeGrocy(() => reply());
  const unit = { name: "Example gram", name_plural: "Example grams" };
  assert.deepEqual(await client.createUnit(1, unit), {
    status: "confirmed",
    value: 4,
  });
  assert.deepEqual(sent.at(-1), {
    url: "http://grocy/api/objects/quantity_units",
    method: "POST",
    body: unit,
  });
  const outcomes: [() => Response, string][] = [
    [
      () =>
        Response.json(
          {
            error_message:
              "SQLSTATE[23000]: Integrity constraint violation: 19 UNIQUE constraint failed: quantity_units.name",
          },
          { status: 400 },
        ),
      "rejected",
    ],
    [
      () =>
        Response.json(
          {
            error_message:
              "SQLSTATE[23000]: Integrity constraint violation: 19 UNIQUE constraint failed: products.name",
          },
          { status: 400 },
        ),
      "uncertain",
    ],
    [() => Response.json({}), "uncertain"],
    [
      () => {
        throw new Error("synthetic-key reset");
      },
      "uncertain",
    ],
  ];
  for (const [next, status] of outcomes) {
    reply = next;
    const result = await client.createUnit(1, unit);
    assert.equal(result?.status, status);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-key/);
  }
  const count = sent.length;
  for (const result of [
    await client.createUnit(2, unit),
    await client.createLocation(1, { name: "Shelf {top}" }),
    await client.createProduct(1, {
      name: "Example rice",
      location_id: 2,
      qu_id_stock: 4,
      default_best_before_days: -2,
    }),
    await client.addStock(1, 1, { ...add, purchased_date: "2026-02-30" }),
    await client.addStock(1, 1, { ...add, best_before_date: "2026-13-01" }),
  ])
    assert.equal(result?.status, "not_sent");
  assert.equal(sent.length, count);
});

test("Stock adds confirm only a receipt matching the confirmed purchase", async () => {
  let rows: unknown[] = [purchase];
  const { client, sent } = fakeGrocy(() => Response.json(rows));
  assert.deepEqual(await client.addStock(1, 1, add), {
    status: "confirmed",
    value: { transactionId: purchase.transaction_id, rows: [purchase] },
  });
  assert.deepEqual(sent.at(-1)?.body, {
    ...add,
    transaction_type: "purchase",
  });
  for (const changed of [
    [{ ...purchase, amount: 0.5 }],
    [
      { ...purchase, amount: 1e308 },
      { ...purchase, amount: 1e308 },
    ],
    [
      { ...purchase, amount: 1.75 },
      { ...purchase, amount: -1 },
    ],
    [{ ...purchase, undone: 1 }],
    [{ ...purchase, best_before_date: "2026-11-10" }],
    [],
  ]) {
    rows = changed;
    assert.equal((await client.addStock(1, 1, add))?.status, "uncertain");
  }
});

test("Grocery reads gate the version, filter exactly and report capped discovery", async () => {
  let body: unknown = {
    grocy_version: { Version: "4.7.1", ReleaseDate: "2026-09-04" },
  };
  const { client, sent } = fakeGrocy(() => Response.json(body));
  assert.equal((await client.requireSupportedVersion(1))?.status, "ok");
  body = { grocy_version: { Version: "4.8.0" } };
  assert.deepEqual(await client.requireSupportedVersion(1), {
    status: "not_sent",
    reason: "unsupported_version",
  });
  body = [];
  await client.productNamed(1, "Example rice & beans");
  assert.equal(
    sent.at(-1)?.url,
    "http://grocy/api/objects/products?query%5B%5D=name%3DExample%20rice%20%26%20beans&order=id%3Aasc&limit=2",
  );
  const count = sent.length;
  assert.equal((await client.productNamed(1, "Rice {x}"))?.status, "failed");
  assert.equal((await client.barcodeRows(1, "null"))?.status, "failed");
  assert.equal(sent.length, count);
  body = [purchase, { ...purchase, id: 4 }, { ...purchase, id: 5 }];
  assert.deepEqual(await client.purchasesAfter(1, 1, 2, 2), {
    status: "ok",
    value: { rows: [purchase, { ...purchase, id: 4 }], complete: false },
  });
  body = { id: 5, name: "Example gram", name_plural: null, active: 1 };
  assert.equal((await client.unit(1, 4))?.status, "failed");
  body = [{ ...purchase, id: 2 }];
  assert.equal((await client.purchasesAfter(1, 1, 2, 2))?.status, "failed");
});
