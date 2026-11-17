import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { usualFoodsQuery } from "../src/food-api.ts";
import { refreshToday } from "../src/today-api.ts";
import { test } from "./support.mts";

test("refreshToday replaces a first usual-foods read that was in flight", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { promise: firstRead, resolve: finishFirstRead } =
    Promise.withResolvers<string[]>();
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: usualFoodsQuery(1).queryKey,
    queryFn: () => (++calls === 1 ? firstRead : ["after-log"]),
  });
  const unsubscribe = observer.subscribe(() => {});
  const stopWatching = client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "invalidate")
      finishFirstRead(["before-log"]);
  });
  try {
    await refreshToday(client, 1);
    assert.deepEqual(client.getQueryData(usualFoodsQuery(1).queryKey), [
      "after-log",
    ]);
  } finally {
    stopWatching();
    unsubscribe();
    client.clear();
  }
});
