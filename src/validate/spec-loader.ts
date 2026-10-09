import { existsSync } from "node:fs";
import path from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import fg from "fast-glob";
import type { OpenAPI, OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { isInside, realPath } from "../files.js";

export interface SpecOperation {
  method: string;
  pathKey: string;
  operationId?: string;
  requestSchema?: Record<string, unknown>;
  ref: string;
}

export interface LoadedSpec {
  provider: string;
  source: string;
  basePaths: string[];
  paths: Map<string, Record<string, SpecOperation>>;
}

/** provider -> directory under APIs-guru `APIs/` */
const GURU_DIRS: Record<string, string[]> = {
  stripe: ["stripe.com"],
  openai: ["openai.com"],
  github: ["github.com/api.github.com"],
  slack: ["slack.com"],
  twilio: ["twilio.com/api"],
  aws: ["amazonaws.com/s3"],
  sendgrid: ["sendgrid.com"],
  twitter: ["twitter.com/current"],
};

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

function requestSchema(op: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject): Record<string, unknown> | undefined {
  const v3 = op as OpenAPIV3.OperationObject;
  const body = v3.requestBody as OpenAPIV3.RequestBodyObject | undefined;
  if (body?.content) {
    const ct = Object.keys(body.content).find((k) => /json|form-urlencoded|multipart/.test(k)) ?? Object.keys(body.content)[0];
    const schema = ct ? body.content[ct]?.schema : undefined;
    if (schema) return schema as Record<string, unknown>;
  }
  const params = (op.parameters ?? []) as (OpenAPIV2.Parameter | OpenAPIV3.ParameterObject)[];
  const inBody = params.find((p) => (p as OpenAPIV2.InBodyParameterObject).in === "body") as OpenAPIV2.InBodyParameterObject | undefined;
  if (inBody?.schema) return inBody.schema as Record<string, unknown>;
  const form = params.filter((p) => (p as OpenAPIV2.GeneralParameterObject).in === "formData") as OpenAPIV2.GeneralParameterObject[];
  if (form.length > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of form) {
      properties[f.name] = { type: f.type, enum: f.enum, description: f.description };
      if (f.required) required.push(f.name);
    }
    return { type: "object", properties, required };
  }
  return undefined;
}

function indexSpec(provider: string, source: string, doc: OpenAPI.Document): LoadedSpec {
  const paths = new Map<string, Record<string, SpecOperation>>();
  const basePaths = new Set<string>([""]);
  const v3 = doc as OpenAPIV3.Document;
  for (const s of v3.servers ?? []) {
    try {
      basePaths.add(new URL(s.url.replace(/\{[^}]+\}/g, "x")).pathname.replace(/\/$/, ""));
    } catch {
      basePaths.add(s.url.replace(/\/$/, ""));
    }
  }
  const v2 = doc as OpenAPIV2.Document;
  if (v2.basePath) basePaths.add(v2.basePath.replace(/\/$/, ""));
  for (const [pathKey, item] of Object.entries(doc.paths ?? {})) {
    const ops: Record<string, SpecOperation> = {};
    for (const m of METHODS) {
      const op = (item as Record<string, OpenAPIV3.OperationObject | undefined>)[m];
      if (!op) continue;
      ops[m.toUpperCase()] = { method: m.toUpperCase(), pathKey, operationId: op.operationId, requestSchema: requestSchema(op), ref: `${source}#/paths/${pathKey}/${m}` };
    }
    paths.set(pathKey, ops);
  }
  return { provider, source, basePaths: [...basePaths], paths };
}

/** Provider ids name files: `stripe`, `api.example.com`. Anything with a path separator or `..` names no spec. */
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function findSpecFile(dir: string, provider: string): string | undefined {
  if (!PROVIDER_ID_RE.test(provider) || provider.includes("..")) return undefined;
  for (const ext of ["json", "yaml", "yml"]) {
    const f = path.join(dir, `${provider}.${ext}`);
    if (existsSync(f)) return f;
  }
  const apisDir = path.join(dir, "APIs");
  if (!existsSync(apisDir)) return undefined;
  for (const sub of Object.hasOwn(GURU_DIRS, provider) ? GURU_DIRS[provider]! : [`${provider}.com`]) {
    const matches = fg.sync(["**/openapi.yaml", "**/openapi.json", "**/swagger.yaml", "**/swagger.json"], { cwd: path.join(apisDir, sub), absolute: true });
    if (matches.length > 0) return matches.sort().at(-1);
  }
  return undefined;
}

/**
 * `$ref`s resolve next to the spec (or inside the specs directory) only: a spec cannot make the scan read other files of
 * the machine. The spec itself may be a symlink into an APIs-guru checkout kept elsewhere.
 */
function refReader(dir: string, entry: string): (file: { url: string }) => boolean {
  const roots = [realPath(path.resolve(dir)), path.dirname(realPath(entry))];
  return (file) => {
    try {
      const target = path.resolve(decodeURI(file.url.replace(/^file:\/\//i, "")));
      if (target === path.resolve(entry)) return true;
      const real = realPath(target);
      return roots.some((root) => isInside(root, real));
    } catch {
      return false;
    }
  };
}

export class SpecStore {
  private cache = new Map<string, Promise<LoadedSpec | undefined>>();

  /** `onWarning` receives one line per spec that cannot be read; calls to that provider are then left unmatched. */
  constructor(
    private readonly dir: string,
    private readonly onWarning?: (message: string) => void,
  ) {}

  load(provider: string): Promise<LoadedSpec | undefined> {
    let p = this.cache.get(provider);
    if (!p) {
      p = this.loadUncached(provider);
      this.cache.set(provider, p);
    }
    return p;
  }

  private async loadUncached(provider: string): Promise<LoadedSpec | undefined> {
    const file = findSpecFile(this.dir, provider);
    if (!file) return undefined;
    try {
      // the scan never opens connections: a remote `$ref` is an error, not a download
      const doc = await SwaggerParser.dereference(file, { resolve: { http: false, file: { canRead: refReader(this.dir, file) } } });
      return indexSpec(provider, path.relative(this.dir, file), doc);
    } catch (err) {
      this.onWarning?.(`cannot read spec ${path.relative(this.dir, file)}: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
      return undefined;
    }
  }
}
