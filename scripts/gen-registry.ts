/**
 * Generates SDK registries from vendor OpenAPI specs (best effort, review the diff before committing).
 *
 *   pnpm gen:registry stripe [path-or-url-to-spec3.json]
 *   pnpm gen:registry openai [path-or-url-to-openapi.yaml]
 *
 * Stripe: uses `x-stripeOperations` on each resource schema (method_name + path) and derives the
 * stripe-node service name from `x-resourceId` (payment_intent -> paymentIntents, checkout.session -> checkout.sessions).
 * OpenAI: the SDK is generated from the spec, so `/chat/completions` POST becomes `chat.completions.create`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import type { MethodSpec, RegistryEntry } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const registryDir = path.join(here, "..", "src", "detect", "registry");

const SOURCES: Record<string, string> = {
  stripe: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  openai: "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml",
};

function camel(s: string): string {
  return s.replace(/[_-]([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function plural(s: string): string {
  if (/(?:s|x|ch|sh)$/.test(s)) return `${s}es`;
  if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
  return `${s}s`;
}

function encodingOf(op: OpenAPIV3.OperationObject): MethodSpec["encoding"] | undefined {
  const ct = Object.keys((op.requestBody as OpenAPIV3.RequestBodyObject | undefined)?.content ?? {})[0];
  if (!ct) return undefined;
  if (ct.includes("form-urlencoded")) return "form";
  if (ct.includes("multipart")) return "multipart";
  return "json";
}

function methodSpec(method: string, p: string, op: OpenAPIV3.OperationObject): MethodSpec {
  const params = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  const spec: MethodSpec = { method: method.toUpperCase(), path: p, operationId: op.operationId };
  if (params.length > 0) spec.pathArgs = params.map((_, i) => i);
  const hasBody = !!op.requestBody;
  if (hasBody) {
    spec.bodyArg = params.length;
    const enc = encodingOf(op);
    if (enc && enc !== "json") spec.encoding = enc;
  } else if (method === "get") spec.queryArg = params.length;
  return spec;
}

interface StripeOp {
  method_name: string;
  method_on: string;
  operation: string;
  path: string;
}

function genStripe(doc: OpenAPIV3.Document): Record<string, MethodSpec> {
  const methods: Record<string, MethodSpec> = {};
  for (const schema of Object.values(doc.components?.schemas ?? {})) {
    const s = schema as OpenAPIV3.SchemaObject & { "x-resourceId"?: string; "x-stripeOperations"?: StripeOp[] };
    const resource = s["x-resourceId"];
    const ops = s["x-stripeOperations"];
    if (!resource || !ops) continue;
    const service = resource
      .split(".")
      .map((part, i, all) => (i === all.length - 1 ? camel(plural(part)) : camel(part)))
      .join(".");
    for (const o of ops) {
      if (o.method_on !== "service") continue;
      const item = doc.paths[o.path]?.[o.operation as OpenAPIV3.HttpMethods];
      if (!item) continue;
      methods[`${service}.${o.method_name}`] = methodSpec(o.operation, o.path, item);
    }
  }
  return methods;
}

function genByPath(doc: OpenAPIV3.Document, prefix: string): Record<string, MethodSpec> {
  const methods: Record<string, MethodSpec> = {};
  for (const [p, item] of Object.entries(doc.paths)) {
    if (!item) continue;
    const segs = p.split("/").filter(Boolean);
    const lastIsParam = segs.at(-1)?.startsWith("{");
    const resource = segs.filter((s) => !s.startsWith("{")).map(camel).join(".");
    for (const method of ["get", "post", "delete", "patch", "put"] as const) {
      const op = item[method];
      if (!op) continue;
      const verb = method === "get" ? (lastIsParam ? "retrieve" : "list") : method === "delete" ? "del" : method === "post" ? (lastIsParam ? "update" : "create") : method;
      methods[`${resource}.${verb}`] = methodSpec(method, `${prefix}${p}`, op);
    }
  }
  return methods;
}

async function main(): Promise<void> {
  const [vendor, source] = process.argv.slice(2);
  if (!vendor || !(vendor in SOURCES)) throw new Error(`usage: gen-registry <${Object.keys(SOURCES).join("|")}> [spec]`);
  const doc = (await SwaggerParser.dereference(source ?? SOURCES[vendor]!)) as OpenAPIV3.Document;
  const file = path.join(registryDir, `${vendor}.json`);
  const existing = JSON.parse(readFileSync(file, "utf8")) as RegistryEntry;
  const methods = vendor === "stripe" ? genStripe(doc) : genByPath(doc, "/v1");
  const merged: RegistryEntry = { ...existing, generatedFrom: `${vendor}-openapi ${new Date().toISOString().slice(0, 10)}`, methods: { ...existing.methods, ...methods } };
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  process.stdout.write(`${vendor}: ${Object.keys(methods).length} generated, ${Object.keys(merged.methods ?? {}).length} total -> ${path.relative(process.cwd(), file)}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
