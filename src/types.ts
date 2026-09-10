import type { CallExpression, Expression, NewExpression, Node, ParameterDeclaration } from "ts-morph";

export type DynamicOrigin = "param" | "call" | "env" | "unknown";

/** A fragment of an evaluated string expression. */
export type Part =
  | { kind: "static"; text: string; viaConst?: boolean }
  | { kind: "env"; name: string }
  | { kind: "dynamic"; name: string; origin: DynamicOrigin; shape?: Shape };

/** Substitution map used for one-hop wrapper expansion. */
export type Subst = Map<ParameterDeclaration, Expression>;

export interface EvalCtx {
  subst?: Subst;
  envHints?: Record<string, string>;
}

export type ClientKind = "fetch" | "axios" | "got" | "ky" | "node-http" | "sdk" | "framework";

export interface InstanceInfo {
  /** "call" for axios.create(cfg) / got.extend(cfg), "new" for new Stripe(key). */
  kind: "call" | "new";
  chain: string[];
  args: Expression[];
}

export interface Callee {
  package?: string;
  importedName?: string;
  global?: string;
  chain: string[];
  instance?: InstanceInfo;
  localDecl?: Node;
  viaType?: boolean;
  /** Chain hangs off `this` and could not be tied to a package or a class member. */
  thisRoot?: boolean;
}

export interface RawCall {
  node: CallExpression | NewExpression;
  client: ClientKind;
  urlExpr?: Expression;
  baseUrlExpr?: Expression;
  optionsExpr?: Expression;
  methodExpr?: Expression;
  impliedMethod?: string;
  bodyExpr?: Expression;
  bodyKey?: "body" | "json" | "form" | "data" | "input";
  queryExpr?: Expression;
  headersExpr?: Expression;
  instanceHeadersExpr?: Expression;
  /** Options object present but not resolvable to a literal (method/body may be wrong). */
  optionsOpaque?: boolean;
  nodeOpts?: { scheme: string; hostExpr?: Expression; portExpr?: Expression; pathExpr?: Expression };
  sdk?: SdkMatch;
  /** Framework helper name (n8n, activepieces, ...) when detected through the frameworks registry. */
  framework?: string;
  /** Encoding forced by the detector (multipart helpers); wins over bodyKey-based defaults. */
  encoding?: BodyEncoding;
  /** Auth scheme declared in a helper's options object (`authentication: { type }`). */
  authHint?: AuthScheme;
  via?: string;
  /** Parameter substitutions when this call was expanded through a wrapper. */
  subst?: Subst;
}

export interface MethodSpec {
  method: string;
  path: string;
  operationId?: string;
  bodyArg?: number;
  queryArg?: number;
  pathArgs?: number[];
  pathFromBody?: string[];
  routeArg?: number;
  urlFromInstanceArg?: number;
  encoding?: BodyEncoding;
}

export interface RegistryEntry {
  package: string;
  aliases?: string[];
  provider: string;
  host: string;
  auth?: AuthScheme;
  generatedFrom: string;
  instance?: { names: string[] };
  methods?: Record<string, MethodSpec>;
  commands?: Record<string, MethodSpec>;
}

export interface FrameworkKeys {
  method?: string;
  url?: string[];
  baseUrl?: string[];
  body?: string[];
  query?: string[];
  headers?: string[];
  auth?: string;
}

export interface FrameworkEntry {
  name: string;
  match: { package?: string; this?: boolean; chain: string[]; packages?: string[] };
  optionsArg: number;
  method?: string;
  keys?: FrameworkKeys;
  encoding?: BodyEncoding;
}

export interface SdkMatch {
  package: string;
  provider: string;
  host: string;
  chain: string;
  spec: MethodSpec;
  auth?: AuthScheme;
  args: Expression[];
}

export type Shape =
  | { type: "object"; properties: Record<string, Shape>; required: string[]; dynamicKeys?: boolean; fromType?: string }
  | { type: "array"; items: Shape; fromType?: string }
  | { type: "string" | "number" | "integer" | "boolean" | "null"; enum?: (string | number | boolean)[]; fromType?: string; hint?: string }
  | { type: "union"; anyOf: Shape[]; fromType?: string }
  | { type: "dynamic"; origin: DynamicOrigin; hint?: string }
  | { type: "unknown" };

export type HostKind = "literal" | "const" | "env" | "relative" | "unknown";

export interface DynamicPart {
  where: "path" | "query" | "body" | "method" | "host";
  name: string;
  origin: string;
  /** Checker-derived shape of the value, when known (path / query / host parts only). */
  shape?: Shape;
}

export interface UrlShape {
  hostKind: HostKind;
  host?: string;
  envName?: string;
  scheme?: string;
  pathTemplate: string;
  query: string[];
  /** Per-parameter shapes for query keys (literal values become single-value enums). */
  queryShape: Record<string, Shape>;
  dynamic: DynamicPart[];
  raw: string;
}

export interface Finding {
  rule: "unknown-property" | "missing-required" | "type-mismatch" | "deprecated" | "enum-mismatch";
  severity: "high" | "medium" | "low";
  property: string;
  message: string;
  specRef?: string;
}

export type AuthScheme = "bearer" | "apikey" | "basic" | "none" | "unknown";
export type BodyEncoding = "json" | "form" | "multipart" | "raw" | "none";
