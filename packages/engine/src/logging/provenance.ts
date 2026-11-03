import { OperationError } from "../operations/registry.ts";

export type Provenance = "verified" | "label" | "estimated";
export interface Claim {
  provenance?: Provenance;
  source?: string | null;
}
export function resolveProvenance(
  request: Claim,
  referencedFood: { provenance: string } | null,
): Provenance {
  if (referencedFood) {
    if (
      request.provenance !== undefined &&
      request.provenance !== referencedFood.provenance
    )
      throw new OperationError(400, "provenance_mismatch");
    if (!["verified", "label", "estimated"].includes(referencedFood.provenance))
      throw new Error("Invalid stored provenance");
    return referencedFood.provenance as Provenance;
  }
  if (request.provenance === "verified")
    throw new OperationError(400, "verified_not_allowed");
  if (request.provenance === "label" && !request.source?.trim())
    throw new OperationError(400, "label_source_required");
  return request.provenance ?? "estimated";
}
