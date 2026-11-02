import { caseFold } from "unicode-case-folding";

export function foldName(text: string): string {
  return caseFold(text.normalize("NFC").trim()).normalize("NFC");
}
