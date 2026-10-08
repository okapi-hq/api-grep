/** Writes docs/sdk-support.md, the SDK support matrix by language (`pnpm gen:support`). */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supportMarkdown } from "./support-table.js";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "sdk-support.md");
writeFileSync(file, supportMarkdown());
process.stdout.write(`${path.relative(process.cwd(), file)} written\n`);
