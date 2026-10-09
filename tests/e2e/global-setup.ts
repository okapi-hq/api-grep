import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CLI, ROOT } from "./helpers.js";

function newestSource(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSource(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/** The suite tests the build, so a missing or stale `dist/` would test the wrong code. */
export default function setup(): void {
  if (!existsSync(CLI)) throw new Error(`${CLI} not found: run \`pnpm build\` before \`pnpm test:e2e\``);
  if (process.env.APICALLS_E2E_CLI) return;
  if (statSync(CLI).mtimeMs < newestSource(path.join(ROOT, "src"))) throw new Error("dist/ is older than src/: run `pnpm build` first");
}
