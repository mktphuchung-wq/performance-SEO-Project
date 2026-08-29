// Resolves the tsconfig "@/..." path alias for scripts that import the app's own
// modules directly in Node. Next.js and tsc understand the alias; plain Node does
// not, so a verification script that touches anything above the pure-function
// layer cannot load it without this.
//
// Used as: node --import ./scripts/alias-loader.mjs scripts/whatever.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";

if (!process.env.__ALIAS_LOADER_REGISTERED) {
  process.env.__ALIAS_LOADER_REGISTERED = "1";
  register("./alias-hooks.mjs", pathToFileURL(`${import.meta.dirname}/`));
}
