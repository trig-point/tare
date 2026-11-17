import assert from "node:assert/strict";
import { cn } from "../src/shared/ui/cn.ts";
import { test } from "./support.mts";

test("cn lets a later Tailwind class replace a conflicting one", () => {
  assert.equal(cn("px-4 py-2", "px-3"), "py-2 px-3");
  assert.equal(
    cn("bg-primary", false, undefined, "bg-destructive"),
    "bg-destructive",
  );
  assert.equal(
    cn("text-sm text-muted-foreground", "text-step-1"),
    "text-muted-foreground text-step-1",
  );
  assert.equal(cn("rounded-md", "rounded-token"), "rounded-token");
  assert.equal(cn(), "");
});
