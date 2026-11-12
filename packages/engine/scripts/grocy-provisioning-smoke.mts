#!/usr/bin/env node
// Opt-in wire smoke for Grocy provisioning. It writes made-up data and runs
// only against a fresh disposable Grocy on loopback; see docs/deploy.md.
import { isDeepStrictEqual } from "node:util";
import {
  createGroceryClient,
  neverExpires,
  purchaseMatches,
} from "../src/grocy/grocery.ts";

const url = process.env.TARE_GROCY_SMOKE_URL?.trim() ?? "";
const apiKey = process.env.TARE_GROCY_SMOKE_API_KEY?.trim() ?? "";
const loopback = /^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost):\d+\/api$/;
if (
  process.env.TARE_GROCY_SMOKE_DISPOSABLE !== "yes" ||
  !loopback.test(url) ||
  !apiKey
) {
  console.error(
    "Set TARE_GROCY_SMOKE_DISPOSABLE=yes, TARE_GROCY_SMOKE_API_KEY and a loopback TARE_GROCY_SMOKE_URL ending in /api",
  );
  process.exit(2);
}
const exchanges: Record<string, unknown>[] = [];
const checks: { name: string; pass: boolean }[] = [];
let loseResponse = false;
const parsed = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const recordingFetch: typeof fetch = async (input, init) => {
  const body =
    init?.body instanceof ReadableStream
      ? await new Response(init.body).text()
      : init?.body;
  const response = await fetch(input, { ...init, body });
  const text = await response.text();
  exchanges.push({
    method: init?.method ?? "GET",
    path: String(input).slice(url.length),
    request: typeof body === "string" ? parsed(body) : undefined,
    status: response.status,
    response: parsed(text),
    lost: loseResponse || undefined,
  });
  if (loseResponse) throw new Error("Response lost after Grocy processed it");
  return new Response(text || null, response);
};
const grocery = createGroceryClient({
  config: { url, apiKey, username: "smoke" },
  ownerId: 1,
  fetch: recordingFetch,
});
const raw = async (method: string, path: string, body?: unknown) => {
  const response = await recordingFetch(`${url}${path}`, {
    method,
    headers: { "GROCY-API-KEY": apiKey, "Content-Type": "application/json" },
    redirect: "manual",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const rows = async (path: string) => {
  const listed = await raw("GET", path);
  if (!Array.isArray(listed)) throw new Error(`${path} is not a list`);
  return listed as { id: number; [field: string]: unknown }[];
};
const check = (name: string, pass: boolean) => checks.push({ name, pass });
const value = <Value,>(
  result: { status: string; value?: Value } | undefined,
) => {
  if (result?.status !== "ok" && result?.status !== "confirmed")
    throw new Error(`Unexpected result ${JSON.stringify(result)}`);
  return result.value as Value;
};
const lost = async <Result,>(send: () => Promise<Result>) => {
  loseResponse = true;
  try {
    return await send();
  } finally {
    loseResponse = false;
  }
};

try {
  if ((await rows("/objects/products")).length)
    throw new Error("Refusing: Grocy already has products");
  if ((await rows("/objects/stock_log")).length)
    throw new Error("Refusing: Grocy already has stock history");
  if ((await grocery.requireSupportedVersion(1))?.status !== "ok")
    throw new Error("Refusing: Grocy version is not supported");
  for (const entity of ["quantity_units", "locations"])
    for (const row of await rows(`/objects/${entity}`))
      await raw("DELETE", `/objects/${entity}/${row.id}`);
  check(
    "setup starts empty",
    (await rows("/objects/quantity_units")).length === 0 &&
      (await rows("/objects/locations")).length === 0,
  );

  const gramUnit = { name: "Smoke gram", name_plural: "Smoke grams" };
  const gram = value(await grocery.createUnit(1, gramUnit));
  const pack = value(
    await grocery.createUnit(1, { name: "Smoke pack", name_plural: "Packs" }),
  );
  const pantryName = "Smoke pantry & shelf";
  const pantry = value(await grocery.createLocation(1, { name: pantryName }));
  const unit = value(await grocery.unit(1, gram));
  check(
    "created unit and location read back with planned fields",
    unit.name === gramUnit.name &&
      unit.name_plural === gramUnit.name_plural &&
      value(await grocery.location(1, pantry)).name === pantryName &&
      value(await grocery.unitNamed(1, gramUnit.name))[0]?.id === gram,
  );

  const plannedRice = {
    name: "Smoke rice",
    location_id: pantry,
    qu_id_stock: gram,
    default_best_before_days: neverExpires.defaultDays,
  };
  const rice = value(await grocery.createProduct(1, plannedRice));
  const riceRow = value(await grocery.product(1, rice));
  check(
    "new product read back with every planned field",
    riceRow.name === plannedRice.name &&
      riceRow.active === 1 &&
      riceRow.location_id === pantry &&
      [
        riceRow.qu_id_stock,
        riceRow.qu_id_purchase,
        riceRow.qu_id_consume,
        riceRow.qu_id_price,
      ].every((id) => id === gram) &&
      riceRow.default_best_before_days === -1 &&
      riceRow.min_stock_amount === 0 &&
      riceRow.enable_tare_weight_handling === 0,
  );
  const duplicates = [
    await grocery.createProduct(1, plannedRice),
    await grocery.createUnit(1, { ...gramUnit, name_plural: "Other" }),
    await grocery.createLocation(1, { name: pantryName }),
  ];
  check(
    "duplicate names are proven rejected without new rows",
    duplicates.every((result) => result?.status === "rejected") &&
      (await rows("/objects/products")).length === 1,
  );
  check(
    "names are unique case-sensitively",
    value(await grocery.productNamed(1, "smoke rice")).length === 0 &&
      (await grocery.createProduct(1, { ...plannedRice, name: "smoke rice" }))
        ?.status === "confirmed",
  );

  const plannedBarcode = {
    product_id: rice,
    barcode: "0200000000024",
    qu_id: gram,
    amount: 500,
  };
  const barcode = value(await grocery.createBarcode(1, plannedBarcode));
  const { id: _barcodeId, ...barcodeFields } = value(
    await grocery.barcode(1, barcode),
  );
  check(
    "barcode reads back raw with its unit and amount",
    isDeepStrictEqual(barcodeFields, plannedBarcode),
  );
  check(
    "duplicate raw barcode is proven rejected",
    (await grocery.createBarcode(1, { ...plannedBarcode, amount: 1 }))
      ?.status === "rejected",
  );
  check(
    "padded and unpadded barcodes are separate raw values",
    value(await grocery.barcodeRows(1, "200000000024")).length === 0 &&
      value(await grocery.barcodeRows(1, "0200000000024")).length === 1,
  );

  const oats = Number(
    (
      await raw("POST", "/objects/products", {
        name: "Smoke oats",
        location_id: pantry,
        qu_id_stock: gram,
        qu_id_purchase: pack,
      })
    ).created_object_id,
  );
  const oatsBaseline = value(await grocery.stockLogMax(1, oats));
  const fractional = {
    amount: 0.75,
    best_before_date: "2027-03-01",
    purchased_date: "2026-11-10",
    location_id: pantry,
  };
  const oatsReceipt = value(await grocery.addStock(1, oats, fractional));
  check(
    "fractional add on a pack-purchased product books native stock units",
    oatsBaseline === 0 &&
      (await raw("GET", `/stock/products/${oats}`)).stock_amount === 0.75 &&
      purchaseMatches(
        value(await grocery.transaction(1, oatsReceipt.transactionId)),
        oats,
        fractional,
      ),
  );

  const riceAdd = {
    ...fractional,
    amount: 250,
    best_before_date: neverExpires.bestBeforeDate,
  };
  const riceReceipt = value(await grocery.addStock(1, rice, riceAdd));
  check(
    "never-expiring add keeps purchase and best-before dates distinct",
    riceReceipt.rows.every(
      (row) =>
        row.best_before_date === "2999-12-31" &&
        row.purchased_date === "2026-11-10",
    ),
  );

  const riceBaseline = value(await grocery.stockLogMax(1, rice));
  const before = (await rows("/objects/stock_log")).length;
  const lostAdd = await lost(() => grocery.addStock(1, rice, riceAdd));
  const found = value(await grocery.purchasesAfter(1, rice, riceBaseline, 10));
  check(
    "lost add response is uncertain, booked once and verifiable",
    lostAdd?.status === "uncertain" &&
      (await rows("/objects/stock_log")).length === before + 1 &&
      found.complete &&
      found.rows.length === 1 &&
      purchaseMatches(
        value(
          await grocery.transaction(1, found.rows[0]?.transaction_id ?? ""),
        ),
        rice,
        riceAdd,
      ),
  );
  const punctuated = "Smoke shelf (2%) $5 ^top";
  const shelf = value(await grocery.createLocation(1, { name: punctuated }));
  check(
    "a name with parentheses, percent, dollar and caret is found by name",
    value(await grocery.locationNamed(1, punctuated))[0]?.id === shelf &&
      value(await grocery.locationNamed(1, pantryName))[0]?.id === pantry,
  );
  const lostCreate = await lost(() =>
    grocery.createLocation(1, { name: "Smoke freezer" }),
  );
  check(
    "lost create response is uncertain and the object is found by name",
    lostCreate?.status === "uncertain" &&
      value(await grocery.locationNamed(1, "Smoke freezer")).length === 1,
  );

  for (const amount of [0.1, 0.2, 0.3])
    value(await grocery.addStock(1, oats, { ...fractional, amount }));
  const afterFirst = oatsReceipt.rows[0]?.id ?? 0;
  const capped = value(await grocery.purchasesAfter(1, oats, afterFirst, 2));
  check(
    "capped discovery reports itself incomplete",
    !capped.complete && capped.rows.length === 2,
  );
  const highest = Math.max(
    ...(await rows("/objects/stock_log"))
      .filter((row) => row.product_id === oats)
      .map((row) => row.id),
  );
  check(
    "stock-log maximum is the highest id, not the first",
    highest > afterFirst &&
      value(await grocery.stockLogMax(1, oats)) === highest,
  );
  const shelfAdd = { ...fractional, amount: 0.05, location_id: shelf };
  check(
    "an add to a non-default location books at that location",
    value(await grocery.addStock(1, oats, shelfAdd)).rows.every(
      (row) => row.location_id === shelf,
    ),
  );
  const missingBefore = (await rows("/objects/stock_log")).length;
  check(
    "add to a missing product is proven rejected without a booking",
    (await grocery.addStock(1, 999, riceAdd))?.status === "rejected" &&
      (await rows("/objects/stock_log")).length === missingBefore,
  );

  const stock = (await raw("GET", "/stock")) as {
    product_id: number;
    amount: number;
  }[];
  const amountOf = (productId: number) =>
    stock.find((row) => row.product_id === productId)?.amount ?? 0;
  check(
    "stock equals confirmed and adopted quantities",
    amountOf(rice) === 500 && Math.abs(amountOf(oats) - 1.4) < 1e-9,
  );
  await raw("POST", `/stock/transactions/${riceReceipt.transactionId}/undo`);
  check(
    "undone transaction no longer verifies",
    !purchaseMatches(
      value(await grocery.transaction(1, riceReceipt.transactionId)),
      rice,
      riceAdd,
    ),
  );
} catch (error) {
  check(`smoke aborted: ${(error as Error).message}`, false);
}
const failed = checks.filter((entry) => !entry.pass);
console.log(
  JSON.stringify({ exchanges, checks, passed: !failed.length }, null, 2)
    .replaceAll(JSON.stringify(apiKey).slice(1, -1), "[redacted]")
    .replaceAll(apiKey, "[redacted]"),
);
if (failed.length) process.exitCode = 1;
