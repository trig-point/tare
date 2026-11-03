import { openDatabase } from "../../src/db.ts";
import { importFiles } from "../../src/import/files.ts";

const path = process.argv[2];
if (!path) throw new Error("Missing database path");
const connection = openDatabase(path);
try {
  process.send?.("ready");
  process.on("message", async (message) => {
    if (typeof message === "string") {
      process.send?.("attempting");
      const result = await importFiles(connection.database, "example", {
        weight: message,
      });
      process.send?.(result);
    } else {
      process.send?.(
        connection.database
          .prepare("SELECT COUNT(*) AS count FROM weights")
          .get(),
      );
    }
    connection.close();
    process.disconnect();
  });
} catch (error) {
  connection.close();
  throw error;
}
