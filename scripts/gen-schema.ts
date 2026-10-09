/**
 * Writes schema/report.v1.json, the JSON Schema of `api-grep scan --json`, from src/report/schema.ts.
 * `tests/schema.test.ts` fails when the committed file is out of date.
 *
 * Run: pnpm gen:schema
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportJsonSchema } from "../src/report/json-schema.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "report.v1.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(reportJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${path.relative(process.cwd(), out)}\n`);
