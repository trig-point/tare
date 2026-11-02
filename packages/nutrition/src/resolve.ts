import { type IdentityKey, matchesIdentity } from "./identity.ts";
import {
  checkRecord,
  type NutritionRecord,
  type RecordIssue,
} from "./record.ts";

export type Tier = "own" | "cache" | "usda" | "off";
export const LOOKUP_TIERS = {
  automatic: ["own", "cache"],
  explicit: ["own", "cache", "usda", "off"],
} as const;
export type BasisRequirement =
  | "any"
  | "mass"
  | "volume"
  | { readonly count: string };
export interface LookupRequest {
  readonly kind: "automatic" | "explicit";
  readonly key: IdentityKey;
  readonly basis: BasisRequirement;
}
export type Candidates = Partial<Record<Tier, readonly NutritionRecord[]>>;
type MissReason = "no_match" | "basis_mismatch" | "ambiguous";
export type LookupResult =
  | {
      readonly status: "match";
      readonly tier: Tier;
      readonly records: readonly [NutritionRecord, ...NutritionRecord[]];
    }
  | {
      readonly status: "miss";
      readonly reason: MissReason;
      readonly searched: readonly Tier[];
      readonly identityMatched: readonly Tier[];
      readonly final: boolean;
    };

export class InvalidRecordError extends Error {
  readonly tier: Tier;
  readonly issues: readonly { index: number; issues: readonly RecordIssue[] }[];

  constructor(tier: Tier, issues: InvalidRecordError["issues"]) {
    super(`Invalid nutrition records in ${tier}`);
    this.name = "InvalidRecordError";
    this.tier = tier;
    this.issues = issues;
  }
}

function matchesBasis(
  record: NutritionRecord,
  requirement: BasisRequirement,
): boolean {
  const basis = record.basis;
  if (basis === null) return false;
  if (requirement === "any") return true;
  if (typeof requirement === "string") return basis.dimension === requirement;
  return basis.dimension === "count" && basis.unit === requirement.count;
}

/**
 * Pass own foods and cache first. Only an explicit miss with final: false permits
 * fetching the next tier: USDA (skip when no API key), then Open Food Facts.
 * Call again with the fetched tier. A match, final miss, or InvalidRecordError
 * ends the lookup without another fetch. Cache refresh is the caller's decision.
 */
export function resolveLookup(
  request: LookupRequest,
  candidates: Candidates,
): LookupResult {
  const searched: Tier[] = [];
  const identityMatched: Tier[] = [];
  const miss = (reason: MissReason): LookupResult => ({
    status: "miss",
    reason,
    searched,
    identityMatched,
    final:
      reason === "ambiguous" ||
      ((request.key.kind === "barcode" || request.key.kind === "source_id") &&
        identityMatched.includes("cache")),
  });

  for (const tier of LOOKUP_TIERS[request.kind]) {
    const records = candidates[tier];
    if (records === undefined) continue;
    searched.push(tier);
    const invalid = records.flatMap((record, index) => {
      const issues = checkRecord(record);
      return issues.length === 0 ? [] : [{ index, issues }];
    });
    if (invalid.length > 0) throw new InvalidRecordError(tier, invalid);

    const identities = records.filter(
      (record) =>
        (request.key.kind !== "meal_kit" || tier === "own") &&
        matchesIdentity(request.key, record),
    );
    if (identities.length > 0) identityMatched.push(tier);
    if (
      request.key.kind === "meal_kit" &&
      request.key.chef === null &&
      identities.length > 1
    )
      return miss("ambiguous");

    let matching = identities.filter((record) =>
      matchesBasis(record, request.basis),
    );
    if (
      tier === "cache" &&
      (request.key.kind === "barcode" || request.key.kind === "source_id")
    ) {
      const source = (["usda", "off"] as const).find((source) =>
        matching.some((record) => record.source === source),
      );
      matching = matching.filter((record) => record.source === source);
    }
    if (
      matching.length > 1 &&
      (request.key.kind !== "name" || request.kind === "automatic")
    )
      return miss("ambiguous");
    const [first, ...remaining] = matching;
    if (first !== undefined)
      return { status: "match", tier, records: [first, ...remaining] };
  }
  return miss(identityMatched.length > 0 ? "basis_mismatch" : "no_match");
}
