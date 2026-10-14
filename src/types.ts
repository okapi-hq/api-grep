import type { ClientValues } from "./detect/client-cache.js";
import type { CallExpression, Expression, JsxOpeningElement, JsxSelfClosingElement, NewExpression, Node, ParameterDeclaration, VariableDeclaration } from "ts-morph";

/** A JSX element that sends a request as it renders (Relay's `<QueryRenderer>`). */
export type JsxOpeningLikeElement = JsxOpeningElement | JsxSelfClosingElement;

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
  /** The client came from a cache a helper fills (`getProvider(chainId)`, #85): every construction it may hold. */
  cached?: ClientValues;
}

export interface RawCall {
  node: CallExpression | NewExpression | JsxOpeningLikeElement;
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
  /** The variable holding the record a `record` method is called on, with the properties set on it before the call. */
  record?: { decl: VariableDeclaration };
}

export interface MethodSpec {
  method: string;
  path: string;
  operationId?: string;
  bodyArg?: number;
  /** Argument holding a GraphQL document, or an object with its `query` (Octokit `graphql(query, variables)`). */
  documentArg?: number;
  /** The document is this property of the document argument (Shopify `client.query({ data })`). */
  documentProp?: string;
  /** The GraphQL document the library sends itself (Hydrogen's `cart.addLines(lines)`, #92). */
  document?: string;
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
  /** The library sends the body under this key (`shopify.product.create(fields)` sends `{ product: fields }`). */
  bodyWrap?: string;
  /** A JSX component's (`components` of a registry): the props read as the method's arguments, in order. */
  props?: string[];
  /**
   * The path when argument `arg` is given, `path` otherwise: pyactiveresource's `Product.find(id)` reads one record,
   * `Product.find()` lists them.
   */
  argPath?: { arg: number; path: string };
  /** Other paths the library picks by the ids it is given (#92): the one most placeholders of which have a value. */
  paths?: string[];
  /**
   * Called on a record (`product.save()`, #92; key `<Class>#<method>`): `record:<name>` params read what the code sets
   * on it (`product.id = 1`), `body` sends those properties; `withId` is the request once its `key` (`id`) is set.
   */
  record?: { body?: boolean; withId?: { method: string; path: string; paths?: string[]; key?: string } };
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
  /**
   * The function at this position sends the requests (Relay's `Network.create(fetchFn)`): the URL and headers of the one
   * `fetch` it makes, also through the functions it calls.
   */
  fetchIn?: string;
}

/**
 * A node vendor's client (ethers `InfuraProvider`, #78): the library builds the URL from a network name, as its own
 * table says. `hosts` by network name or chain id; `host` for any other (`{network}.infura.io`), so the vendor is
 * still known; `path` after it (`/v3/{projectId}`).
 */
export interface VendorSource {
  /** Where the client takes the network (`0`), and the network it uses when given none. */
  network: string;
  default: string;
  hosts: Record<string, string>;
  host: string;
  path: string;
}

/** How a client construction gives its endpoint, beside the URL and headers of `EndpointSource`. */
export interface ClientSource {
  /** Where it takes its transports (`0.transport`; `|` separates places tried in turn). */
  transport?: string;
  /**
   * The transports are read through the options as code builds them (wagmi's `createConfig`, #85): object literals
   * (one transport per chain), functions returning a client (`client({ chain })`), spreads and reassigned variables.
   */
  deep?: boolean;
  /** No transport given means the library's default HTTP one, to a URL the code does not say (RainbowKit). */
  defaultHttp?: boolean;
  /**
   * The client is the one of a config (wagmi's `usePublicClient({ config })`, #85): where the config is given, the
   * project's one config otherwise.
   */
  config?: string;
  /**
   * The client is handed down by a React context whose provider component builds it from its props (`useConnection()`
   * under `<ConnectionProvider endpoint={url}>`, #85): the component, and the props holding the URL and headers.
   */
  component?: { name: string; url: string; headers?: string };
  vendor?: VendorSource;
  urlOrNetwork?: boolean;
}

/**
 * GraphQL clients (#54) talk to whatever URL the code gives them. `clients` are their constructors and factories
 * (`new ApolloClient({ uri })`), with the option holding a transport built apart (`link`); `transports` are the
 * constructors of those (`new HttpLink({ uri })`). Python writes the positions as `kw:url|0`.
 */
export interface EndpointSpec {
  clients: Record<string, EndpointSource & ClientSource>;
  transports?: Record<string, EndpointSource>;
  /**
   * JSON-RPC clients (#52) also talk to browser wallets and sockets: with this list, a call is reported only when its
   * client reads as HTTP. It names the constructions that do not (`BrowserProvider`, viem's `custom`, `WebsocketProvider`).
   */
  nonHttp?: string[];
  /** Types a client of the library is declared with (`JsonRpcProvider`, `PublicClient`): a call on another type is not one. */
  types?: string[];
  /** The package the clients come from when it is another one (`@solana/spl-token` helpers take a `@solana/web3.js` Connection). */
  clientPackage?: string;
  /**
   * Signers a contract can be built with (ethers, #78): where one takes its provider (`Wallet`: `1`; none: the receiver,
   * `provider.getSigner()`), and who signs its transactions, the app (`local`: `eth_sendRawTransaction`) or the node
   * (`node`: `eth_sendTransaction`).
   */
  signers?: Record<string, { provider?: string; signs: "local" | "node" }>;
  /**
   * A contract's methods that give the same contract on another runner or at another address (ethers, #85): the
   * position of the construction their first argument replaces (`connect(signer)`: `2`, `attach(address)`: `0`).
   */
  rebind?: Record<string, string>;
  /** Types a contract is declared with (`token: Contract`, #85): its functions are the ABI's, on a runner not known. */
  contractTypes?: string[];
  /**
   * The client a call is given comes from the app's context (Relay's environment, from `useRelayEnvironment()` or a
   * prop): one the scan cannot read is the project's one client, as for a call that names none.
   */
  contextClient?: boolean;
  /**
   * The component that hands the app's client down to its hooks (`<WagmiProvider config={config}>`, #85): a call that
   * names no client uses the ones the project gives it, when it renders it.
   */
  contextProvider?: { name: string; prop: string };
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
  /** JSX components that send a request as they render (Relay's `<QueryRenderer query={...} />`), by export name. */
  components?: Record<string, MethodSpec>;
  /** The library picks the provider from the model name (LangChain's `initChatModel`): the call goes where it routes. */
  routeByModel?: boolean;
  /** A client of any API of a protocol (GraphQL): the endpoint, headers and provider come from the code. */
  endpoint?: EndpointSpec;
  /** Members of a contract object (`connect`, `interface`): a `*` in a method key, a function of its ABI, is never one of them (#78). */
  notFunctions?: string[];
  /**
   * Method names too common to stand for this SDK by themselves (`order.list`): a call on an untyped parameter is this
   * SDK's when its callers pass one of its clients, never because the manifests declare the package.
   */
  callersOnly?: boolean;
  /**
   * Clients a framework hands to request handlers in their context, by name (Hydrogen's `context.storefront`): in a
   * project whose manifests declare the package, `<name>.<method>` on a value of that name read from a parameter or
   * the context is the key `<name>.<method>` of this registry.
   */
  contextClients?: string[];
  /** Key prefixes the code may write for the registry's (`admin.rest.resources.` for `rest.`, #92). */
  keyAliases?: Record<string, string>;
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
