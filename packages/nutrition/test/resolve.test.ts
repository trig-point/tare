import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Candidates,
  type IdentityKey,
  InvalidRecordError,
  type LookupRequest,
  type LookupResult,
  type NutritionRecord,
  resolveLookup,
  type Tier,
} from "../src/index.ts";

function food(overrides: Partial<NutritionRecord> = {}): NutritionRecord {
  return {
    source: "own",
    sourceId: "42",
    name: "Chicken Bowl",
    brand: null,
    barcode: "0012345678901",
    labelSource: null,
    retrievedAt: "2024-02-29T12:34:56.789Z",
    mealKit: null,
    basis: { dimension: "mass", amount: 100, unit: "g" },
    nutrients: {
      kcal: { amount: 5, provenance: "label" },
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
    },
    ...overrides,
  };
}
const barcode: IdentityKey = { kind: "barcode", code: "0012345678901" };
const name: IdentityKey = { kind: "name", name: "chicken bowl", brand: null };
const meal: IdentityKey = {
  kind: "meal_kit",
  service: "Example Kitchen",
  mealName: "Cloud Bowl",
  chef: null,
};
const request: LookupRequest = {
  kind: "explicit",
  key: barcode,
  basis: "mass",
};
const count = { dimension: "count", amount: 1, unit: "meal" } as const;
const volume = { dimension: "volume", amount: 250, unit: "ml" } as const;
const usda = food({ source: "usda" });
const off = food({ source: "off" });
const secondUsda = food({ source: "usda", sourceId: "43" });
const kitKey = {
  service: "example kitchen",
  mealName: "CLOUD BOWL",
  chef: "Example Chef",
};
const kit = food({ mealKit: kitKey });

function miss(
  reason: "no_match" | "basis_mismatch" | "ambiguous",
  searched: Tier[],
  identityMatched: Tier[] = [],
  final = false,
): LookupResult {
  return { status: "miss", reason, searched, identityMatched, final };
}
function match(
  result: LookupResult,
  tier: Tier,
  ...records: NutritionRecord[]
) {
  assert.deepEqual(result, { status: "match", tier, records });
}
function unread(candidates: Candidates, ...tiers: Tier[]): Candidates {
  for (const tier of tiers)
    Object.defineProperty(candidates, tier, {
      get() {
        assert.fail(`Read forbidden tier ${tier}`);
      },
    });
  return candidates;
}

test("similar names and missing barcodes never substitute a generic food", () => {
  const generic = food({ name: "Greek yogurt, plain", barcode: null });
  assert.deepEqual(
    resolveLookup(
      { ...request, key: { ...name, name: "Greek yogurt" } },
      { usda: [generic] },
    ),
    miss("no_match", ["usda"]),
  );
  assert.deepEqual(
    resolveLookup(request, { off: [generic] }),
    miss("no_match", ["off"]),
  );
});

test("automatic lookups ignore matching or invalid external arrays and never read their getters", () => {
  const automatic = { ...request, kind: "automatic" } as const;
  for (const external of [
    { usda: [usda], off: [off] },
    {
      usda: [food({ basis: { ...count, amount: -1 } })],
      off: [
        food({
          source: "off",
          nutrients: {
            ...off.nutrients,
            kcal: { amount: 1, provenance: "verified" },
          },
        }),
      ],
    },
    unread({}, "usda", "off"),
  ]) {
    const supplied = Object.defineProperties(
      { own: [], cache: [] },
      Object.getOwnPropertyDescriptors(external),
    );
    assert.deepEqual(
      resolveLookup(automatic, supplied),
      miss("no_match", ["own", "cache"]),
    );
  }
});

test("own foods win before cache; USDA wins before OFF externally and for cached barcodes", () => {
  const own = food();
  match(resolveLookup(request, { own: [own], cache: [off] }), "own", own);
  match(resolveLookup(request, { usda: [usda], off: [off] }), "usda", usda);
  match(
    resolveLookup(request, unread({ own: [own] }, "cache", "usda", "off")),
    "own",
    own,
  );
  match(resolveLookup(request, unread({ usda: [usda] }, "off")), "usda", usda);
  match(resolveLookup(request, { cache: [off, usda] }), "cache", usda);
  for (const wrong of [
    food({ ...usda, basis: volume }),
    food({ ...usda, barcode: "99999999" }),
  ])
    match(resolveLookup(request, { cache: [wrong, off] }), "cache", off);
});

test("basis failures fall through; unknown basis fails any; count units use exact text", () => {
  const own = food({ basis: volume });
  match(resolveLookup(request, { own: [own], cache: [off] }), "cache", off);
  assert.deepEqual(
    resolveLookup(request, { own: [own], cache: [] }),
    miss("basis_mismatch", ["own", "cache"], ["own"]),
  );
  assert.deepEqual(
    resolveLookup(
      { ...request, basis: "any" },
      { own: [food({ basis: null })] },
    ),
    miss("basis_mismatch", ["own"], ["own"]),
  );
  const counted = food({ basis: count });
  match(
    resolveLookup({ ...request, basis: { count: "meal" } }, { own: [counted] }),
    "own",
    counted,
  );
  for (const unit of ["bar", "Meal"])
    assert.deepEqual(
      resolveLookup({ ...request, basis: { count: unit } }, { own: [counted] }),
      miss("basis_mismatch", ["own"], ["own"]),
    );
  match(
    resolveLookup({ ...request, basis: "volume" }, { own: [own] }),
    "own",
    own,
  );
  match(
    resolveLookup({ ...request, basis: "any" }, { own: [counted] }),
    "own",
    counted,
  );
});

test("visited tiers validate every record and report all invalid indexes", () => {
  const invalid = food({ name: " " });
  assert.throws(
    () =>
      resolveLookup(request, {
        own: [
          food(),
          invalid,
          food({ sourceId: "" }),
          food({ barcode: "not-a-code" }),
        ],
      }),
    (error) => {
      assert.ok(error instanceof InvalidRecordError);
      assert.equal(error.name, "InvalidRecordError");
      assert.equal(error.tier, "own");
      assert.deepEqual(error.issues, [
        { index: 1, issues: [{ code: "empty_name" }] },
        { index: 2, issues: [{ code: "empty_source_id" }] },
        { index: 3, issues: [{ code: "invalid_barcode" }] },
      ]);
      return true;
    },
  );
  match(
    resolveLookup(request, { cache: [off], usda: [invalid] }),
    "cache",
    off,
  );
});

test("explicit name lookups keep both cached sources; automatic names are ambiguous", () => {
  match(
    resolveLookup({ ...request, key: name }, { cache: [off, usda] }),
    "cache",
    off,
    usda,
  );
  assert.deepEqual(
    resolveLookup(
      { kind: "automatic", key: name, basis: "mass" },
      unread({ cache: [off, usda] }, "usda", "off"),
    ),
    miss("ambiguous", ["cache"], ["cache"], true),
  );
  assert.deepEqual(
    resolveLookup(
      { kind: "automatic", key: name, basis: "mass" },
      unread({ own: [food(), food({ name: "chicken bowl" })] }, "cache"),
    ),
    miss("ambiguous", ["own"], ["own"], true),
  );
});

test("name brands fold exactly when supplied and null ignores the candidate brand", () => {
  const branded = food({ brand: "ACME" });
  match(
    resolveLookup({ ...request, key: name }, { own: [branded] }),
    "own",
    branded,
  );
  const key = { ...name, brand: "Acme" };
  match(resolveLookup({ ...request, key }, { own: [branded] }), "own", branded);
  for (const brand of ["Acme Foods", null])
    assert.deepEqual(
      resolveLookup({ ...request, key }, { own: [food({ brand })] }),
      miss("no_match", ["own"]),
    );
});

test("barcode and source ids use exact caller-normalized text and source", () => {
  assert.deepEqual(
    resolveLookup(
      { ...request, key: { kind: "barcode", code: "12345678901" } },
      { cache: [off] },
    ),
    miss("no_match", ["cache"]),
  );
  const key: IdentityKey = { kind: "source_id", source: "off", id: "123" };
  assert.deepEqual(
    resolveLookup(
      { ...request, key },
      { cache: [food({ source: "usda", sourceId: "123" })] },
    ),
    miss("no_match", ["cache"]),
  );
  const identified = food({ source: "off", sourceId: "123" });
  match(
    resolveLookup({ ...request, key }, { cache: [identified] }),
    "cache",
    identified,
  );
  assert.deepEqual(
    resolveLookup(
      { ...request, key: { ...key, id: " 123" } },
      { cache: [identified] },
    ),
    miss("no_match", ["cache"]),
  );
});

test("chef-less meal keys count every identity before basis and only in own foods", () => {
  for (const second of [
    food({ ...kit, basis: count }),
    food({ ...kit, basis: null }),
    food({ ...kit, mealKit: { ...kitKey, chef: "Another Chef" } }),
  ])
    assert.deepEqual(
      resolveLookup(
        { ...request, key: meal },
        unread({ own: [kit, second] }, "cache"),
      ),
      miss("ambiguous", ["own"], ["own"], true),
    );
  match(resolveLookup({ ...request, key: meal }, { own: [kit] }), "own", kit);
  assert.deepEqual(
    resolveLookup({ ...request, key: meal }, { own: [], cache: [kit] }),
    miss("no_match", ["own", "cache"]),
  );
  assert.deepEqual(
    resolveLookup({ ...request, key: meal }, { own: [food()] }),
    miss("no_match", ["own"]),
  );
});

test("a supplied meal chef matches only that folded chef, service and meal name", () => {
  const key = { ...meal, chef: "example chef" };
  match(resolveLookup({ ...request, key }, { own: [kit] }), "own", kit);
  for (const mealKit of [
    { ...kitKey, chef: null },
    { ...kitKey, chef: "Another Chef" },
    { ...kitKey, service: "Other Kitchen" },
    { ...kitKey, mealName: "Other Bowl" },
  ])
    assert.deepEqual(
      resolveLookup({ ...request, key }, { own: [food({ mealKit })] }),
      miss("no_match", ["own"]),
    );
  assert.deepEqual(
    resolveLookup({ ...request, key }, { own: [kit, kit] }),
    miss("ambiguous", ["own"], ["own"], true),
  );
});

test("ambiguous cached barcodes stop before reading either external tier", () => {
  assert.deepEqual(
    resolveLookup(
      request,
      unread({ cache: [usda, secondUsda, off] }, "usda", "off"),
    ),
    miss("ambiguous", ["cache"], ["cache"], true),
  );
});

test("omitted tiers are absent from searched and empty candidates remain a miss", () => {
  assert.deepEqual(resolveLookup(request, {}), miss("no_match", []));
  assert.deepEqual(
    resolveLookup(request, { off: [] }),
    miss("no_match", ["off"]),
  );
});

for (const basis of [null, volume])
  test(`repeat barcode cache identity hit with ${basis === null ? "unknown" : "incompatible"} basis is final`, () => {
    assert.deepEqual(
      resolveLookup(request, { cache: [food({ ...off, basis })] }),
      miss("basis_mismatch", ["cache"], ["cache"], true),
    );
  });

test("source-id cache identity hits also stop fetching after a basis failure", () => {
  const key: IdentityKey = {
    kind: "source_id",
    source: "off",
    id: off.sourceId,
  };
  assert.deepEqual(
    resolveLookup(
      { ...request, key },
      { cache: [food({ ...off, basis: null })] },
    ),
    miss("basis_mismatch", ["cache"], ["cache"], true),
  );
});

test("own hits, unrelated cache rows and name hits do not make basis misses final", () => {
  const own = food({ basis: null });
  for (const cache of [[], [food({ ...off, barcode: "99999999" })]])
    assert.deepEqual(
      resolveLookup(request, { own: [own], cache }),
      miss("basis_mismatch", ["own", "cache"], ["own"]),
    );
  assert.deepEqual(
    resolveLookup(
      { ...request, key: name },
      { cache: [food({ ...off, basis: null })] },
    ),
    miss("basis_mismatch", ["cache"], ["cache"]),
  );
});

test("cache basis failures still visit an external tier already supplied", () => {
  match(
    resolveLookup(request, {
      cache: [food({ ...off, basis: null })],
      usda: [usda],
    }),
    "usda",
    usda,
  );
  assert.deepEqual(
    resolveLookup(request, {
      cache: [food({ ...off, basis: null })],
      usda: [food({ ...usda, basis: null })],
    }),
    miss("basis_mismatch", ["cache", "usda"], ["cache", "usda"], true),
  );
});

test("caller fetches nothing after repeat barcode hits and fetches USDA then OFF after a cache miss", () => {
  function lookup(
    candidates: Candidates,
    fetcher: (tier: "usda" | "off") => NutritionRecord[],
  ): LookupResult {
    let result = resolveLookup(request, candidates);
    for (const tier of ["usda", "off"] as const) {
      if (result.status === "match" || result.final) break;
      candidates[tier] = fetcher(tier);
      result = resolveLookup(request, candidates);
    }
    return result;
  }
  const fetched: Tier[] = [];
  const fetcher = (tier: "usda" | "off") => {
    fetched.push(tier);
    return tier === "usda" ? [food({ ...usda, basis: null })] : [off];
  };
  assert.deepEqual(
    lookup({ own: [], cache: [food({ ...off, basis: null })] }, fetcher),
    miss("basis_mismatch", ["own", "cache"], ["cache"], true),
  );
  match(lookup({ own: [], cache: [off] }, fetcher), "cache", off);
  assert.deepEqual(
    lookup({ own: [], cache: [usda, secondUsda] }, fetcher),
    miss("ambiguous", ["own", "cache"], ["cache"], true),
  );
  assert.deepEqual(fetched, []);
  match(lookup({ own: [], cache: [] }, fetcher), "off", off);
  assert.deepEqual(fetched, ["usda", "off"]);
});
