#!/usr/bin/env node
import { parseArgs } from "node:util";
import { openDatabase } from "../src/db.ts";
import { importFiles } from "../src/import/files.ts";
import { OperationError } from "../src/operations/registry.ts";

try {
  const { values } = parseArgs({
    options: {
      user: { type: "string" },
      intake: { type: "string" },
      weight: { type: "string" },
      days: { type: "string" },
    },
    allowPositionals: false,
  });
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (
    !values.user?.trim() ||
    !databaseUrl ||
    ![values.intake, values.weight, values.days].some(Boolean)
  ) {
    console.error(JSON.stringify({ code: "usage" }));
    process.exitCode = 2;
  } else {
    const connection = openDatabase(databaseUrl);
    try {
      const summaries = await importFiles(
        connection.database,
        values.user.trim(),
        {
          intake: values.intake,
          weight: values.weight,
          days: values.days,
        },
      );
      for (const summary of summaries) console.log(JSON.stringify(summary));
      process.exitCode = summaries.some((summary) => summary.skipped > 0)
        ? 1
        : 0;
    } finally {
      connection.close();
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      code: error instanceof OperationError ? error.code : "input_error",
    }),
  );
  process.exitCode = 2;
}
