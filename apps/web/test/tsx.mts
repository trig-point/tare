import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "virtual:pwa-register/react")
      return next(specifier, context);
    const source =
      "export const useRegisterSW = (options) => globalThis.registerStub(options);";
    return {
      url: `data:text/javascript,${encodeURIComponent(source)}`,
      shortCircuit: true,
    };
  },
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
