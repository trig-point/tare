import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import ts from "typescript";
import { test } from "./support/hang-ceiling.ts";

test("intake writes use one query through the intake insert function", () => {
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: "utf8" });
  const inserts = (text: string) =>
    /\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+["`[]?intake_entries\b/i.test(
      text.replace(/\s+/g, " "),
    );
  const queries = files.filter(
    (file) =>
      file.endsWith(".sql") &&
      inserts(readFileSync(new URL(file, root), "utf8")),
  );
  assert.deepEqual(queries, ["queries/insert-intake-entry.sql"]);
  for (const file of files.filter((file) => file.endsWith(".ts"))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(new URL(file, root), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        queries.some(
          (query) =>
            basename(query, ".sql") ===
            basename((node.moduleSpecifier as ts.StringLiteral).text, ".ts"),
        )
      )
        assert.equal(
          file,
          "logging/intake.ts",
          `unauthorized importer: ${file}`,
        );
      if (!files.includes(file.replace(/\.ts$/, ".sql"))) {
        const literal =
          ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
            ? node.text
            : ts.isTemplateExpression(node)
              ? node.head.text +
                node.templateSpans.map((span) => span.literal.text).join(" ")
              : "";
        assert.equal(inserts(literal), false, `direct intake SQL: ${file}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
