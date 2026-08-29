import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");

/** The extensions the app's own modules actually use, in the order tsc tries them. */
function firstExisting(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, base, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) return candidate;
  }
  return null;
}

/**
 * Node resolves neither the tsconfig "@/" alias nor TypeScript's extensionless
 * relative imports. Both are everywhere in this codebase, so a verification
 * script that loads anything above the pure-function layer needs both mapped.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = firstExisting(path.join(projectRoot, specifier.slice(2)));
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!path.extname(base)) {
      const resolved = firstExisting(base);
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    }
  }
  return nextResolve(specifier, context);
}
