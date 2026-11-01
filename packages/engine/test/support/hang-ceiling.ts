import { test as runTest, type TestContext } from "node:test";

export const HANG_CEILING_MS = 60_000;

export function test(
  name: string,
  run: (context: TestContext) => void | Promise<void>,
) {
  return runTest(name, { timeout: HANG_CEILING_MS }, run);
}
