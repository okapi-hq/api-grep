import type { GraphqlLimit } from "../../operation/limits.js";
import type { ClientKind, Ecosystem, Language } from "../../report/schema.js";
import type { AuthScheme, BodyEncoding, MethodSpec, RegistryEntry } from "../../types.js";
import type { SyntaxNode } from "../tree-sitter.js";
import type { Chain } from "./chain.js";
import type { TestRanges } from "./host-literals.js";
import type { CallExpr, ClassDef, Expr, FunctionDef, ModuleModel, Param } from "./model.js";
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
  /** The keyword argument holding the model of a model client or an agent (`ChatOpenAI(model=...)`). */
  modelKw?: string;
  /**
   * The calls of the chain (by name) whose argument 0 or `model=` is the model when the method is given none
   * (`InferenceClient(model="...").text_generation(prompt)`).
   */
  modelSeg?: string[];
  /** The keyword argument holding the GraphQL document, when it is not `document` (sgqlc and ShopifyAPI: `query`). */
  documentKw?: string;
  /** Keyword arguments that set the client's base URL (`base_url`, `api_base`), the first given wins. */
  baseUrlKw?: string[];
  /** The method sends to the URL given as this argument (Slack's `send(webhookUrl, payload)`). */
  urlArg?: number;
  /**
   * Body fields the SDK names itself: the positional arguments of a call of the chain (Twilio `Message.creator(to,
   * from, body)` -> `To`, `From`, `Body`; `""` skips a path argument) and the chain's setters with this prefix
   * (`setMediaUrl(u)` -> `MediaUrl`).
   */
  argFields?: { seg: string; fields: string[]; setters?: string };
  /** The call builds a model client whose settings are its requests' (LangChain4j `OpenAiChatModel.builder()...build()`): the built value is the body. */
  bodySelf?: boolean;
  /**
   * A `params` source holding the HTTP method the code sets (SendGrid's `request.setMethod(Method.GET)`: `arg:0.method`);
   * the registry's method when it sets none, `DYNAMIC` when it is not known.
   */
  methodFrom?: string;
}

/**
 * JVM SDKs take their parameters as builders (`MessageCreateParams.builder().maxTokens(1024).build()`): which classes
 * are built that way and how a setter names the field it sets. A built value reads as a dict of those fields.
 */
export interface SetterRules {
  /** Packages of the parameter classes (`com.anthropic.models`): `.builder() ... .build()` on a class there is a dict. */
  packages: string[];
  /** Field names: `snake` (`maxTokens` -> `max_tokens`), `camel` (as written), `pascal` (`bucket` -> `Bucket`). */
  case: "snake" | "camel" | "pascal";
  /**
   * Setter prefixes: `set` is dropped (`setEmail` -> `email`), `add` appends to a list field in the plural (`addTool`
   * -> `tools`), `put` sets a key of a map field (`putMetadata("k", v)` -> `metadata.k`).
   */
  prefixes?: ("set" | "add" | "put")[];
  /** Setters the rules above do not name: field (`addUserMessage` -> `messages:user`, an item with that role), `""` for none. */
  fields?: Record<string, string>;
  /** Setters adding one item to a list field, or one key to a map field when given two arguments (Lombok `@Singular`: `tag(t)` -> `tags`). */
  items?: Record<string, string>;
  /**
   * Enum classes of those packages whose constants are strings (`Model.CLAUDE_SONNET_4_5`), by class name or `*`;
   * `lower`: constants named in Pascal case (`ChatRole.User` -> `user`).
   */
  constants?: Record<string, "kebab" | "snake" | "lower">;
  /** Rewrites of a constant's string after its case (`gpt-4-1` -> `gpt-4.1`): pattern and replacement. */
  constantRewrites?: [string, string][];
  /**
   * Kotlin data classes of those packages are built by their constructor's named arguments, read as the fields they
   * set (`ChatCompletionRequest(model = m, maxTokens = 100)` -> `model`, `max_tokens`).
   */
  constructors?: boolean;
  /** Classes of those packages that stand for their one argument (`ModelId("gpt-4o")` -> `"gpt-4o"`). */
  wrappers?: string[];
  /** Bare calls of a filling lambda that set a key from their two arguments (supabase-kt `update({ set("done", true) })`). */
  putters?: string[];
}

/**
 * SDK registry of a tree-sitter language: the TypeScript `RegistryEntry` format with the import roots the SDK is reached
 * through, keyword-argument bodies and builder segments. `package` is the name a manifest declares (PyPI distribution).
 * Params sources add `kw:<name>`, `seg:<segment>:<N>` (argument N of a named call in the chain) and
 * `chain:<a>,<b>` (argument 0 of those calls joined with `/`: Firestore references).
 */
export interface IrRegistryEntry extends Omit<RegistryEntry, "instance" | "methods" | "commands" | "urlFromFile"> {
  /** Dotted import roots: Python modules (`openai`, `google.genai`), PHP namespaces (`Stripe`, `OpenAI`), JVM classes. */
  imports: string[];
  instance?: {
    /** Constructors, factories and builder calls that return a client, by name. */
    names: string[];
    /** Call name -> where it takes the base URL: `"0"` (argument 0), `"kw:base_url"`, `"0.base_uri"` (key of argument 0). */
    urlArg?: Record<string, string>;
    /** A factory shared by several services (`boto3.client("s3")`): the instance is this SDK's only for these values. */
    select?: { arg?: number; kw?: string; equals: string[] };
    /** The instance is a builder (`S3Client.builder().region(r).build()`): the client is what this call after it returns. */
    build?: string;
  };
  /** Calls that only narrow a request (`collection`, `document`): left out of method keys. `set*` matches a prefix. */
  builders?: string[];
  /** JVM: parameters given as builders, read as dicts (see `SetterRules`). */
  setters?: SetterRules;
  /**
   * Packages whose classes have the same names (the Android `firebase-messaging` has firebase-admin's
   * `com.google.firebase.messaging.FirebaseMessaging`): a file whose manifests declare one of them and not this
   * package calls theirs, so this entry does not match there.
   */
  sameClassesAs?: string[];
  /** The library picks the provider from the model name (LiteLLM, PydanticAI, DSPy): the call goes where it routes. */
  routeByModel?: boolean;
  /**
   * The host comes from a configuration call made once elsewhere (`PostHog.setup(PostHogConfig(key, host = h))`):
   * the calls by the end of their name, the position of the config argument (`-1`: the last), and where the config's
   * constructor takes the host (`kw:host|1`); without `arg`, where the setup call itself does (Dart's
   * `Supabase.initialize(url: u, anonKey: k)`). See `setup.ts`.
   */
  setupUrl?: { calls: string[]; arg?: number; host: string };
  /** A model client a framework configures from the build and its properties (Spring AI): see `ConfiguredClient`. */
  configured?: ConfiguredClient;
  methods: Record<string, IrMethodSpec>;
}

/**
 * A client a framework builds from the starter the build declares and from configuration properties (Spring AI): the
 * entries of one `family` share interfaces (`ChatClient`, `ChatModel`) bound to the one provider the manifests declare,
 * a chain through the provider's `own` packages (`OpenAiChatModel`) is that provider's, and the model and base URL are
 * properties the code does not name. The language's `refineSdk` reads it.
 */
export interface ConfiguredClient {
  family: string;
  /** Entries of one provider and kind (its artifacts) share it: `chat`, `embedding`. */
  kind: string;
  own: string[];
  /** The provider's model classes of this kind (`OpenAiChatModel`): built in the code, they ignore the properties. */
  classes: string[];
  /** Properties holding the model and the base URL, the first set wins. */
  model: string[];
  baseUrl: string[];
  /** The value of the property choosing the provider of a kind among several starters (`spring.ai.model.chat=openai`). */
  id?: string;
  /** The bean name of the provider's model of this kind (`openAiChatModel`), as a `@Qualifier` or a parameter names it. */
  bean?: string;
  /** A property that, when set, sends the requests elsewhere than the registry's host (Google GenAI on Vertex AI). */
  elsewhereIf?: string;
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
  /** One header from its name and value arguments (`defaultHeader("X", v)`), a default of every request. */
  headerArgs?: [number, number];
  baseUrlArg?: number;
  queryArg?: number;
  /** One query parameter from its name and value arguments (Resty `SetQueryParam("k", v)`). */
  queryArgs?: [number, number];
  /** The body, set before the verb call that sends it (Resty `R().SetBody(b).Post(url)`). */
  bodyArg?: number;
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
  /** Options holding more options, read after the call's own (Dio's `options: Options(headers: h, method: m)`). */
  nested?: string[];
}

/**
 * A value built entry by entry through calls: `JSONObject().put("a", 1)`, `FormBody.Builder().add("a", b)`,
 * `HttpHeaders().set("X", v)`, also on a variable (`val o = JSONObject(); o.put(...)`). It reads as a dict literal
 * (a list for `items`), so body, query and header shapes need nothing more.
 */
export interface FluentMapSpec {
  /** Constructors, as written or qualified (`JSONObject`, `FormBody.Builder`). */
  objects: string[];
  /** Methods adding an entry from their key and value arguments. */
  put?: string[];
  /** Methods adding an item from their argument (`JSONArray().put(x)`): the value is a list. */
  items?: string[];
  /** Methods setting the Authorization entry (`setBearerAuth(token)`). */
  auth?: Record<string, "bearer" | "basic">;
  /** Properties set on a variable holding the object (`headers.contentType = ...`): the entry each sets. */
  props?: Record<string, string>;
  /** Methods setting one entry from their argument (`request.setEndpoint("mail/send")` -> `endpoint`). */
  setters?: Record<string, string>;
  /**
   * Any other `setX(v)` sets the entry `x` in this case (Azure OpenAI options: `setMaxTokens(300)` -> `max_tokens`).
   */
  setterCase?: "snake";
  /** The constructor's positional arguments are these entries (`ChatCompletionsOptions(messages)` -> `messages`). */
  args?: string[];
  /** Methods that set no entry (`MultipartBody.Builder().setType(FORM)`). */
  skip?: string[];
  /** Methods adding every entry of their argument (`map.putAll(other)`). */
  spread?: string[];
  /** Methods removing the entry of their argument (`map.remove("k")`). */
  remove?: string[];
  /**
   * A general-purpose map (`HashMap`): a value only once entries are put on it (`put`, Kotlin's `body["k"] = v`). One
   * filled some other way stays a value the scan cannot read rather than an empty object.
   */
  filledOnly?: boolean;
  /** How a body built this way is sent. */
  encoding?: BodyEncoding;
}

/** Manifests of the language's ecosystem: what a repository declares and at which version. */
export interface Manifests {
  /** Packages declared in the manifests of these directories, as `normalizePackage` writes them. */
  declared(dirs: Set<string>, rootDir: string): Set<string>;
  version(file: string, pkg: string, rootDir: string): string | undefined;
  /** The version a BOM is declared or imported at (Maven `dependencyManagement`, a Gradle `platform`), when known. */
  bom?(file: string, pkg: string, rootDir: string): string | undefined;
}

/** A file's text as `IrSource.readText` gives it. */
export interface ReadText {
  text: string;
  /**
   * The text once the part holding a 1-based line is left out too (a notebook's cell that is no Python: a shell command
   * without `!`), so one bad part does not lose the file; `undefined` when no part holds it.
   */
  without?: (line: number) => string | undefined;
}

/** One source language of a front end: its grammar, its files and how a file lowers into the model. */
export interface IrSource {
  id: Language;
  /** Grammar name (`python`, `php`), a key of `GRAMMARS`. */
  grammar: string;
  /**
   * The grammar marks some valid code as repaired with a token it hides (Kotlin: the automatic semicolon before a `}`
   * on the same line): a tree with no ERROR or MISSING node to point at still lowers.
   */
  allowHiddenErrors?: boolean;
  /**
   * A rewrite of a file that does not parse as written, kept when it parses; it moves no position of the file: same
   * length (Kotlin: `;` before a `}`) or appended at its end (Go: a final newline).
   */
  repair?: (text: string) => string;
  extensions: string[];
  /**
   * The source of a file of another format the grammar reads (a notebook's code cells), every line where the file has
   * it; `undefined` when the file cannot be read that way (a `parse-error`). Files without it are read as written.
   */
  readText?: (file: string, text: string) => ReadText | undefined;
  /** Out of scope by default: tests, virtualenvs, vendored code, build output. */
  excludes: string[];
  lower(root: SyntaxNode, file: string, rootDir: string): ModuleModel;
  /** The file's own test code (Rust's `#[cfg(test)]` and `#[test]` items), whose literals `coverage.hosts` does not read. */
  testCode?: (root: SyntaxNode) => TestRanges;
}

/** A language read through tree-sitter and the shared engine. */
export interface IrLanguage extends IrSource {
  ecosystem: Ecosystem;
  /**
   * Other languages lowered into the same modules and `ProjectIndex` (Java with Kotlin): names resolve across them,
   * each call keeps its file's language, and the ecosystem's coverage is computed once for all of them.
   */
  alsoReads?: IrSource[];
  /** Functions read module-level variables (Python globals); otherwise only module constants (PHP). */
  moduleVarsVisible: boolean;
  /** Module-level constants and functions of one file are visible in every file (PHP), not only through imports. */
  sharedGlobals: boolean;
  /** Files of one package (the same module name) see each other's top-level declarations without an import (Kotlin). */
  packageScope?: boolean;
  /** Parameters declare their type (Kotlin): one whose type names no client is never listed as `injected-client`. */
  typedParams?: boolean;
  /** `a[k]` on a library object calls this method (Kotlin `operator fun get`: `postgrest["table"]` is `postgrest.get("table")`). */
  indexOperator?: string;
  /** Methods are overloaded (Java, Kotlin): a call runs the one of its name its arguments fit (`overloads.ts`). */
  overloads?: boolean;
  registry: IrRegistryEntry[];
  clients: ClientSpec[];
  /** Detectors for calls that tables cannot describe (`urlopen(Request(...))`, curl handles). */
  detectors?: IrDetector[];
  /**
   * Runs once every file is lowered, before the index is built: what one file's lowering cannot see alone (Go: a type
   * declared in one file of a package and given methods in another, the struct literals giving its fields values).
   */
  link?: (modules: ModuleModel[]) => void;
  /** Detectors for requests a declaration describes rather than a call (an annotated interface method: Feign, Retrofit). */
  declarations?: IrDeclarationDetector[];
  /** Values built entry by entry (`JSONObject().put(...)`), read as dicts and lists. */
  fluentMaps?: FluentMapSpec[];
  /** Library classes a wildcard import can stand for (`io.ktor.client.HttpClient` under `import io.ktor.client.*`). */
  wildcardTypes?: Set<string>;
  /** Library constants with a known string value (`MediaType.APPLICATION_JSON`), by the end of their dotted name. */
  constants?: Record<string, string>;
  /** A call that stands for another expression of the project (Laravel `config('services.x.url')`: an entry of `config/services.php`). */
  resolveCall?: (call: CallExpr, fn: FunctionDef, ctx: IrCtx) => Scoped | undefined;
  /** Values a DI container gives (JVM: Dagger / Hilt, Spring, Koin), for parameters and fields nothing else sets. */
  injection?: IrInjection;
  /**
   * The last say on an SDK call a registry entry matched, with the whole chain (Spring AI: whether a shared interface
   * is the entry's provider, the model and base URL its configuration gives); undefined when the entry does not apply.
   */
  refineSdk?: (raw: IrRaw, chain: Chain, ctx: IrCtx) => IrRaw | undefined;
  /**
   * A call that returns an instance of a project class it names (`retrofit.create(Api::class.java)`,
   * `create<Api>()`): the value's members are that class's methods, so their callers are known.
   */
  instanceOf?: (call: CallExpr, fn: FunctionDef, ctx: IrCtx, depth: number) => ClassDef | undefined;
  /** The env var a field of a settings class is read from (pydantic-settings' `BaseSettings`): `object-fields.ts`. */
  fieldEnv?: (cls: ClassDef, name: string, ctx: IrCtx) => string | undefined;
  /** The default a library object's attribute gets (argparse: `args.model` is `add_argument("--model", default=...)`). */
  attrDefault?: (e: Expr & { k: "attr" }, fn: FunctionDef, ctx: IrCtx) => Scoped | undefined;
  /**
   * GraphQL documents a library builds as objects (sgqlc's `Operation`): the text the object at `arg` sends, and the
   * bound past which its selections were not read (#55).
   */
  documentOf?: (arg: Scoped, ctx: IrCtx) => { text: string; limit?: GraphqlLimit } | undefined;
  /** Calls whose value, for a URL, is their first argument (`quote(x)`) or their receiver (`x.strip()`). */
  passthrough: { functions: Set<string>; methods: Set<string> };
  /** Calls that serialize a body, by name: `json.dumps` -> json, `urlencode` -> form. */
  serializers: Record<string, BodyEncoding>;
  manifests: Manifests;
  /** Dotted import roots of a package (`google-genai` -> `google.genai`); `declared` when the manifests declare it. */
  importRoots(pkg: string, declared?: boolean): string[];
  /** The ecosystem's canonical spelling of a package name (PyPI: lower case, `-` for `_` and `.`). */
  normalizePackage(name: string): string;
}

/**
 * What a dependency injection container gives: a parameter no wrapper expansion substituted (a provider's, a managed
 * constructor's), a field only an annotation sets, a container lookup (`get<Api>()`). Undefined when not injected, or
 * when the binding cannot be told (several providers).
 */
export interface IrInjection {
  param(p: Param, fn: FunctionDef, ctx: IrCtx): Scoped | undefined;
  field(cls: ClassDef, name: string, ctx: IrCtx): Scoped | undefined;
  call(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Scoped | undefined;
  /** A container lookup no project binding answers (Spring's `ref<ChatClient>()`): the type it returns. */
  lookupType?(call: CallExpr, fn: FunctionDef, ctx: IrCtx): Expr | undefined;
}

/** A detector for one language's own patterns; it sees the call, its scope and what the callee resolved to. */
export type IrDetector = (call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain) => IrRaw | undefined;

/** The languages a front end reads: its own, then the ones it reads alongside. */
export const sourcesOf = (lang: IrLanguage): IrSource[] => [lang, ...(lang.alsoReads ?? [])];

/** Requests a module declares (one per annotated method), located at the declaration. */
export type IrDeclarationDetector = (mod: ModuleModel, ctx: IrCtx) => IrRaw[];
