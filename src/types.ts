import type { CallExpression, Expression, NewExpression, Node, ParameterDeclaration } from "ts-morph";

export type DynamicOrigin = "param" | "call" | "env" | "unknown";

/** A fragment of an evaluated string expression. */
export type Part =
  | { kind: "static"; text: string; viaConst?: boolean }
  | { kind: "env"; name: string; /** Literal default (`process.env.X ?? "https://..."`), used when no .env.example value exists. */ fallback?: string }
  | { kind: "dynamic"; name: string; origin: DynamicOrigin; shape?: Shape };

/** Substitution map used for one-hop wrapper expansion. */
export type Subst = Map<ParameterDeclaration, Expression>;

export interface EvalCtx {
  subst?: Subst;
  envHints?: Record<string, string>;
  /** Reading a caller's argument for a parameter's values (`resolve/param-values.ts`): its own parameters are not followed up. */
  callerLevel?: boolean;
}

export type ClientKind = "fetch" | "axios" | "got" | "ky" | "node-http" | "jquery" | "xhr" | "sdk" | "framework";

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
  /** First construction when the chain went through several (`createClient(url).from(table)`: `createClient`). */
  rootInstance?: InstanceInfo;
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
  /** Headers set one by one (`xhr.setRequestHeader(name, value)`). */
  headerPairs?: [Expression, Expression][];
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
  /** The model when the request carries it outside the body (`openai("gpt-4o")` in an AI SDK call, an agent's model). */
  modelExpr?: Expression;
  /** The client is an untyped parameter: known from the callers, or from the one SDK the manifests declare with that method. */
  clientFrom?: "caller" | "manifest";
}

export interface MethodSpec {
  method: string;
  path: string;
  operationId?: string;
  bodyArg?: number;
  /** Argument holding a GraphQL document, or an object with its `query` (Octokit `graphql(query, variables)`). */
  documentArg?: number;
  queryArg?: number;
  pathArgs?: number[];
  pathFromBody?: string[];
  routeArg?: number;
  urlFromInstanceArg?: number;
  encoding?: BodyEncoding;
  /** Host of this method when it differs from the registry's (Firebase: Firestore, Identity Toolkit, Storage). */
  host?: string;
  auth?: AuthScheme;
  /** The body is a property of the body argument (`functions.invoke(name, { body })`). */
  bodyProp?: string;
  /**
   * Path placeholder -> where its value comes from: `arg:N` (call argument), `instance:N` (argument of the builder the
   * method is called on, `from(table)`), `ref:N` (a Firebase reference: `doc(db, "users", id)` gives `users/{id}`) or
   * `fn:N` (a Convex function reference: `api.tasks.get` gives `tasks/get`). `arg:N.model` reads a property of it.
   */
  params?: Record<string, string>;
  /**
   * A model client or an agent built here (`new ChatOpenAI({ model })`, `Agent("openai:gpt-4o")`): where its model is
   * when it is not a body property, argument N (Python adds a keyword) or a property of it.
   */
  modelArg?: number;
  modelProp?: string;
  /** Properties of the body argument that set the client's base URL (`configuration.baseURL`), the first given wins. */
  baseUrlProp?: string[];
  /** The settings mix the client's (keys, callbacks, retries) with the request's: only the request's are body. */
  clientKwargs?: boolean;
  /** Argument holding per-request headers (graphql-request `client.request(document, variables, headers)`). */
  headersArg?: number;
  /**
   * Called as the package's own function rather than on a client (graphql-request `request(url, document)`), the call
   * takes the endpoint first and the method's arguments after it, or one object with its `url`.
   */
  endpointFirst?: boolean;
  /** A property of an argument naming the client to use (`useQuery(DOC, { client })`): `1.client`. */
  clientArg?: string;
  /** Sent over the client's subscription transport (often a WebSocket of its own): its endpoint is not the client's URL. */
  subscription?: boolean;
  /**
   * JSON-RPC client libraries (#52): the RPC method the client method sends (`getParsedTransaction` sends
   * `getTransaction`); a list when the library picks one of several (a block by number or by hash).
   */
  rpc?: string | string[];
  /** Where a generic transport method takes the RPC method: `0` (`send(method, params)`), `0.method` (`request({ method })`). */
  rpcArg?: string;
  /** Called as the package's own function (viem/actions `getBalance(client, args)`), the call takes the client first. */
  clientFirst?: boolean;
  /** An attribute read rather than a call (web3.py `w3.eth.block_number` sends `eth_blockNumber`, #78). */
  property?: boolean;
  /**
   * A function of a contract object (#78), which the contract's ABI names (`*` in the key): `auto` sends `eth_call` for
   * a view and a transaction otherwise, as the ABI and the runner tell (ethers `token.balanceOf(owner)`); `send` a
   * transaction, as the runner tells (ethers v6 `token.transfer.send(...)`).
   */
  contract?: "auto" | "send";
  /** Where the contract's construction takes its runner or client: `2` (ethers `new Contract(address, abi, runner)`), `0.client.public|0.client`. */
  runnerArg?: string;
  /** Where the contract's construction takes its ABI: `1` (ethers). */
  abiArg?: string;
}

/** Where a GraphQL client or one of its transports takes its URL and headers: `0`, `0.uri`, `1.headers` (TypeScript). */
export interface EndpointSource {
  url?: string;
  headers?: string;
}

/**
 * GraphQL clients (#54) talk to whatever URL the code gives them. `clients` are their constructors and factories
 * (`new ApolloClient({ uri })`), with the option holding a transport built apart (`link`); `transports` are the
 * constructors of those (`new HttpLink({ uri })`). Python writes the positions as `kw:url|0`.
 */
export interface EndpointSpec {
  clients: Record<string, EndpointSource & { transport?: string }>;
  transports?: Record<string, EndpointSource>;
  /**
   * JSON-RPC clients (#52) also talk to browser wallets and sockets: with this list, a call is reported only when its
   * client reads as HTTP. It names the constructions that do not (`BrowserProvider`, viem's `custom`, `WebsocketProvider`).
   */
  nonHttp?: string[];
  /** Types a client of the library is declared with (`JsonRpcProvider`, `PublicClient`): a call on another type is not one. */
  types?: string[];
}

export interface RegistryEntry {
  package: string;
  aliases?: string[];
  provider: string;
  host: string;
  auth?: AuthScheme;
  generatedFrom: string;
  /**
   * Constructor / factory names; `urlArg` gives where the base URL is: an argument index (`createClient(url, key)`: 0)
   * or a property of one (`new OpenAI({ baseURL })`: "0.baseURL").
   */
  instance?: { names: string[]; urlArg?: Record<string, number | string> };
  /** Path prefix the default base URL already carries (`/v1` for OpenAI), dropped when the code gives its own base URL. */
  basePath?: string;
  /** Base URL from the one `new <name>(url)` of the same file (MCP: the client's transport). */
  urlFromFile?: { new: string[]; arg: number };
  /** Literal path values are written into the path (`/rest/v1/todos`, not `/rest/v1/{table}`). */
  inlinePathLiterals?: boolean;
  methods?: Record<string, MethodSpec>;
  commands?: Record<string, MethodSpec>;
  /** The library picks the provider from the model name (LangChain's `initChatModel`): the call goes where it routes. */
  routeByModel?: boolean;
  /** A client of any API of a protocol (GraphQL): the endpoint, headers and provider come from the code. */
  endpoint?: EndpointSpec;
  /** Members of a contract object (`connect`, `interface`): a `*` in a method key, a function of its ABI, is never one of them (#78). */
  notFunctions?: string[];
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
  /** Arguments of the builder the method was called on (`from(table)`), for `instance:N` path params. */
  instanceArgs?: Expression[];
  inlinePath?: boolean;
  basePath?: string;
  routeByModel?: boolean;
  /** A GraphQL client (`endpoint` in the registry): its headers and auth come from the code too. */
  anyHost?: boolean;
}

export type Shape =
  | { type: "object"; properties: Record<string, Shape>; required: string[]; dynamicKeys?: boolean; fromType?: string }
  | { type: "array"; items: Shape; fromType?: string }
  | { type: "string" | "number" | "integer" | "boolean" | "null"; enum?: (string | number | boolean)[]; fromType?: string; hint?: string; env?: string }
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

export type AuthScheme = "bearer" | "apikey" | "basic" | "none" | "unknown";
export type BodyEncoding = "json" | "form" | "multipart" | "raw" | "xml" | "none";
