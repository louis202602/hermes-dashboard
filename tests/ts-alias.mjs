// Test-only module resolver: maps the app's "@/..." path alias to the repo root so
// pure modules that import siblings via "@/lib/..." (e.g. lib/dashboard/profiles.ts)
// can be loaded directly by `node --test`, which has no tsconfig path resolution.
// Only "@/" specifiers are rewritten; everything else uses default resolution, so the
// existing relative-".ts" test imports are untouched. No transform, no bundler.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      let p = path.join(ROOT, specifier.slice(2));
      if (!existsSync(p) && existsSync(p + ".ts")) p += ".ts";
      return { url: pathToFileURL(p).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
