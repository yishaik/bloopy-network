import { createRequire } from "node:module";

// Read rather than duplicated: the version reported by /health is the gate the production release
// checklist verifies, so it must not be able to drift from the package that was actually built.
// `createRequire` resolves ../package.json identically from src/ and from dist/.
const require = createRequire(import.meta.url);

export const SERVICE_VERSION: string = (require("../package.json") as { version: string }).version;
export const SERVICE_NAME = "bloopy-network";
