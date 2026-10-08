import type { ClientKind, Ecosystem, Language } from "../../report/schema.js";
import type { AuthScheme, BodyEncoding, MethodSpec, RegistryEntry } from "../../types.js";
import type { SyntaxNode } from "../tree-sitter.js";
import type { Chain } from "./chain.js";
import type { CallExpr, Expr, FunctionDef, ModuleModel } from "./model.js";
import type { IrCtx, IrRaw } from "./raw.js";

/** An expression with the function it is written in: names are looked up there. */
export interface Scoped {
  expr: Expr;
  fn: FunctionDef;
}

/** Registry method of a tree-sitter language: the TypeScript `MethodSpec`, plus keyword arguments. */
export interface IrMethodSpec extends MethodSpec {
  /** Every keyword argument is a body property (`client.chat.completions.create(model=..., messages=...)`). */
  bodyKwargs?: boolean;
  /** One keyword argument holds the body (`client.customers.create(params={...})`). */
  bodyKw?: string;
  /** Every keyword argument is a query parameter (`client.files.list(purpose=...)`). */
  queryKwargs?: boolean;
}

/**
 * SDK registry of a tree-sitter language: the TypeScript `RegistryEntry` format with the import roots the SDK is reached
 * through, keyword-argument bodies and builder segments. `package` is the name a manifest declares (PyPI distribution).
 * Params sources add `kw:<name>`, `seg:<segment>:<N>` (argument N of a named call in the chain) and
 * `chain:<a>,<b>` (argument 0 of those calls joined with `/`: Firestore references).
 */
export interface IrRegistryEntry extends Omit<RegistryEntry, "instance" | "methods" | "commands" | "urlFromFile"> {
  /** Dotted import roots: Python modules (`openai`, `google.genai`), PHP namespaces (`Stripe`, `OpenAI`). */
  imports: string[];
  instance?: {
    /** Constructors, factories and builder calls that return a client, by name. */
    names: string[];
    /** Call name -> where it takes the base URL: `"0"` (argument 0), `"kw:base_url"`, `"0.base_uri"` (key of argument 0). */
    urlArg?: Record<string, string>;
    /** A factory shared by several services (`boto3.client("s3")`): the instance is this SDK's only for these values. */
    select?: { arg?: number; kw?: string; equals: string[] };
  };
  /** Calls that only narrow a request (`collection`, `document`): left out of method keys. */
  builders?: string[];
  methods: Record<string, IrMethodSpec>;
}

/** What an option of an HTTP client call carries (`json=` -> `body:json`, `params=` -> `query`). */
export type OptionRole =
  | "url"
  | "baseUrl"
  | "method"
  | "query"
  | "headers"
  | "auth"
  | "auth:bearer"
  | "auth:basic"
  | "body"
  | "body:json"
  | "body:form"
  | "body:multipart"
  | "body:raw";

export interface ClientFunction {
  /** HTTP method of a verb function (`get`, `post`). */
  method?: string;
  /** Position of the method argument (`request("POST", url)`). */
  methodArg?: number;
  /** Position of the URL (default 0). */
  urlArg?: number;
  /** Position of a body argument (`Http::post($url, $data)`). */
  bodyArg?: number;
  bodyRole?: OptionRole;
  /** Position of a query argument (`Http::get($url, $query)`). */
  queryArg?: number;
  /** Position of the options array (PHP); keyword arguments otherwise. */
  optionsArg?: number;
}

export interface ClientModifier {
  auth?: AuthScheme;
  encoding?: BodyEncoding;
  headersArg?: number;
  baseUrlArg?: number;
  queryArg?: number;
  optionsArg?: number;
}

/**
 * A table-driven HTTP client: module-level functions and methods of client objects, with the options that carry the
 * URL, method, body, query and headers. Both sides of `requests.get(url)` and `requests.Session().get(url)` read it.
 */
export interface ClientSpec {
  client: ClientKind;
  imports: string[];
  /** The functions are global functions (`wp_remote_post($url, $args)`), not reached through an import. */
  global?: boolean;
  /** Constructors of client objects; their options give the base URL, headers and auth of every call. */
  instances?: { names: string[]; optionsArg?: number; baseUrlArg?: number };
  functions: Record<string, ClientFunction>;
  /** Fluent calls before the request (`Http::withToken($t)->asForm()->post(...)`). */
  modifiers?: Record<string, ClientModifier>;
  keys: Record<string, OptionRole>;
}

/** Manifests of the language's ecosystem: what a repository declares and at which version. */
export interface Manifests {
  /** Packages declared in the manifests of these directories, as `normalizePackage` writes them. */
  declared(dirs: Set<string>): Set<string>;
  version(file: string, pkg: string, rootDir: string): string | undefined;
}

/** A language read through tree-sitter and the shared engine. */
export interface IrLanguage {
  id: Language;
  ecosystem: Ecosystem;
  /** Grammar package name after `tree-sitter-` (`python`, `php`). */
  grammar: string;
  extensions: string[];
  /** Out of scope by default: tests, virtualenvs, vendored code, build output. */
  excludes: string[];
  lower(root: SyntaxNode, file: string, rootDir: string): ModuleModel;
  /** Functions read module-level variables (Python globals); otherwise only module constants (PHP). */
  moduleVarsVisible: boolean;
  /** Module-level constants and functions of one file are visible in every file (PHP), not only through imports. */
  sharedGlobals: boolean;
  registry: IrRegistryEntry[];
  clients: ClientSpec[];
  /** Detectors for calls that tables cannot describe (`urlopen(Request(...))`, curl handles). */
  detectors?: IrDetector[];
  /** A call that stands for another expression of the project (Laravel `config('services.x.url')`: an entry of `config/services.php`). */
  resolveCall?: (call: CallExpr, fn: FunctionDef, ctx: IrCtx) => Scoped | undefined;
  /** Calls whose value, for a URL, is their first argument (`quote(x)`) or their receiver (`x.strip()`). */
  passthrough: { functions: Set<string>; methods: Set<string> };
  /** Calls that serialize a body, by name: `json.dumps` -> json, `urlencode` -> form. */
  serializers: Record<string, BodyEncoding>;
  manifests: Manifests;
  /** Dotted import roots of a package (`google-genai` -> `google.genai`). */
  importRoots(pkg: string): string[];
  /** The ecosystem's canonical spelling of a package name (PyPI: lower case, `-` for `_` and `.`). */
  normalizePackage(name: string): string;
}

/** A detector for one language's own patterns; it sees the call, its scope and what the callee resolved to. */
export type IrDetector = (call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain) => IrRaw | undefined;
