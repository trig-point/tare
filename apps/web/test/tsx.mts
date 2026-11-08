import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "virtual:pwa-register/react"
      ? {
          url: "data:text/javascript,export const useRegisterSW = (options) => globalThis.registerStub(options)",
          shortCircuit: true,
        }
      : next(specifier, context),
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    };
  },
});
