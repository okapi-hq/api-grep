# Report format

`api-grep scan <dir> --json` writes one JSON document per scan. This page describes every part of it; the
[JSON Schema](../schema/report.v1.json) is the formal contract.

## A call, field by field

`--out report.json` writes the same document to a file. It states facts
about each call (what the code shows and where each part came from, such as `hostKind`,
`bodySource`, `optionsOpaque` and `dynamic`) and gives no score or verdict: any
judgement is left to the consumer. For the Stripe example of the [README](../README.md#example), with `--examples 1`, shown as YAML with
one comment per field and the second call left out:

```yaml
$schema: https://raw.githubusercontent.com/okapi-hq/api-grep/main/schema/report.v1.json
schemaVersion: 1.16.0           # report format version; readers check the major
tool: api-grep
version: 0.1.0                  # tool version
repo: shop                      # name of the scanned directory
commit: 9ae2b37…                # HEAD, when the directory is a git repository
calls:                          # one entry per call, sorted by file, line, column
  - id: 916d2bd1f6b1            # stable: hash of file, line, column (and operation.name)
    location:
      file: billing/stripe.ts   # relative to the scanned directory
      line: 6
      col: 10
      language: typescript      # typescript | javascript | html | python | php | kotlin | java | go | shell | rust | dart
    client: sdk                 # fetch | axios | got | ky | node-http | jquery | xhr | node-soap (TypeScript, JavaScript), html-form (HTML), requests | httpx | aiohttp | urllib | urllib3 | zeep (Python), guzzle | laravel-http | symfony-http | curl | psr-18 | php-stream | wordpress | php-soap (PHP), okhttp | java-http | ktor | spring-rest | spring-webclient | feign | retrofit | apache-httpclient | jaxrs-client | async-http-client | unirest | vertx-webclient (Kotlin, Java), net-http | resty (Go), curl | wget | httpie (shell), reqwest | ureq | awc | isahc | surf (Rust), dart-http | dio (Dart), sdk | framework
    sdk: { package: stripe, version: ^22.6.1, chain: customers.create }
    provider: stripe            # `api-grep providers` id, or internal | env:<NAME> | unknown
    host: api.stripe.com        # may hold placeholders: {project}.supabase.co
    hostKind: literal           # literal | const | env | relative | unknown
    scheme: https
    method: POST                # DYNAMIC when not known statically
    pathTemplate: /v1/customers # {name} marks a dynamic segment
    urlTemplate: https://api.stripe.com/v1/customers
    operationId: PostCustomers  # from the SDK registry
    query: []                   # query parameter names
    headers: []                 # header names
    headerValues: {}            # literal values only; null for credentials
    authScheme: bearer          # bearer | apikey | basic | none | unknown
    body:                       # shape: names and types, never data
      type: object
      properties:
        email: { type: string, hint: email }
        name: { type: string, enum: [Ada] }   # literal value from the code
        metadata: { type: object, properties: { userId: { type: string, hint: userId } }, required: [userId] }
      required: [email, name, metadata]
    bodyEncoding: form          # json | form | multipart | raw | xml | none
    dynamic:                    # what could not be known statically
      - { where: body, name: email, origin: param }
      - { where: body, name: userId, origin: param }
    optionsOpaque: false        # true: the options are a value the scan could not read (method, headers or body may be missing)
    bodySource: literal         # literal | type | unknown | none: where the body shape came from
    clientParts:                # query parameters and headers the client adds, not the call (absent when none)
      - { where: header, name: authorization, from: interceptor }   # interceptor (OkHttp) | default (Ktor defaultRequest, Spring defaultHeader)
      - { where: header, name: accept, from: interceptor, optional: true }   # added on some requests only (in a branch, after an early return)
    examples:                   # concrete requests with invented values
      - variant: minimal        # minimal | full | alt
        method: POST
        url: https://api.stripe.com/v1/customers
        headers: { authorization: Bearer <token>, content-type: application/x-www-form-urlencoded }
        query: {}
        body: { email: maya.ekwall@example.com, name: Ada, metadata: { userId: dw8ydaub } }
        bodyEncoding: form
stats:                          # counts over calls
  filesScanned: 1
  callsFound: 2
  byLanguage: { typescript: 2 }
  byClient: { sdk: 2 }
  byProvider: { stripe: 2 }
  byHostKind: { literal: 2 }
  withBodyShape: 1
  withDynamic: 2
  redacted: 0                   # secret-looking strings replaced with <redacted>
  durationMs: 1044
diagnostics:                    # what the scan could not read, see Diagnostics
  filesSeen: 1
  filesScanned: 1
  skipped: []
  skippedCounts: {}
  droppedCalls: []
  unfollowed: []
  languages: { typescript: { filesSeen: 1, filesScanned: 1 } }   # files per language
  complete: true                # false: partial scan, exit code 2
coverage:                       # API SDKs the repo uses, see SDK coverage
  sdks:
    - { package: stripe, ecosystem: npm, provider: stripe, supported: true, declared: true, imported: true, importSites: 1, calls: 2, status: ok }
  hosts: { named: 1, explained: 1, unexplained: [] }   # API hosts the code names, see Host coverage
```

## Model names

A call to a model API also carries `model`: the model names the code gives, read from an SDK argument
(`ChatOpenAI(model=...)`, `Agent("openai:gpt-4o")`), the body (`model`, `modelId`) or the path
(`/v1beta/models/gemini-2.0-flash:generateContent`). Names behind constants, env var defaults
(`os.getenv("MODEL", "gpt-4o")`, `process.env.MODEL ?? "gpt-4o"`), settings classes, function returns and
branches are followed, and so is a parameter of the enclosing function: the literals its callers pass and its default
([#39](languages.md#a-parameters-values-39)); `dynamic` says some branch could not be read. Body values and
header values read parameters the same way; a header that can take several values lists them in
`headerAlternatives` (`{ "x-api-version": ["2024-06-01", "2025-01-15"] }`).

A model chosen at run time is often written down where the scan can follow it ([#125](https://github.com/okapi-hq/api-grep/issues/125)),
and `values` lists those names too, `dynamic` staying true when some value is still unread:

- defaults the code gives: an env var's (`os.getenv`, `os.environ.get`, `process.env.X ?? "..."`), a fallback
  (`model or "gpt-4o"`, `opts.model ?? process.env.MODEL ?? "..."`, `d.get("model", "gpt-4o")`), a parameter's or a
  constructor's (`def __init__(self, model="gpt-4o")`, `constructor(private model = "gpt-4o")`), a settings or record
  class field's (pydantic and pydantic-settings, `Field("...")`, dataclasses, also built by a factory or a classmethod
  such as `Config.from_runnable_config(c)`), a zod env schema's `.default("...")` (`schema.parse(process.env)`, t3's
  `createEnv`), an argparse argument's `default=`;
- the value an example env file nearest the call documents for the env var the call reads (`.env.example`,
  `.env.sample`, `.env.template`, `.env.dist`, one of them with a middle part such as `.env.local.example`,
  `.env-example`, `env.example`, `example.env`), also as `envExample`: an assignment, else a commented-out one
  (`# OPENAI_MODEL=gpt-4o`) unless the file comments out several values for it; a placeholder (`your-model`,
  `my-deployment`, `changeme`) documents nothing. A pydantic-settings field is read from its env var (its
  `env_prefix`, upper case unless `case_sensitive`, or its `alias`);
- the keys of a JSON, YAML or TOML file the code loads by a literal path (`yaml.safe_load(open("config.yaml"))["llm"]["model"]`,
  `json.load(f)` after `with open("settings.json") as f`, `os.path.join(os.path.dirname(__file__), "x.toml")`,
  `import config from "./config.json"`, `require("./config.json")`, `JSON.parse(readFileSync("x.json", "utf8"))`),
  read from the scanned directory (next to the code, else at the scanned directory's root); a value the program fills in
  (`${MODEL:gpt-4o}`) is no name.

`sources` (schema 1.25) says where each name that is no literal of the code comes from, so a consumer can weigh a default or a
documented value below a literal: `default`, `env_example` (with its `file`) or `config_file` (with its `file` and
`key` path). A name the code also writes as a literal is listed as a literal.

```yaml
    model:
      values: [gpt-4o-mini, o3, gpt-4.1]  # every name a branch can give, as the provider receives it
      env: CHAT_MODEL            # the env var that can override them
      envExample: gpt-4.1        # what the nearest .env.example gives that var
      dynamic: false             # true: some value could not be read (hint: its name)
      sources:                   # the names that are no literal of the code (o3 is one)
        - { value: gpt-4o-mini, from: default }
        - { value: gpt-4.1, from: env_example, file: .env.example }
      from: body                 # argument | body | path
```

Libraries that pick the provider from the model name (LiteLLM, LangChain's `init_chat_model`, PydanticAI,
CrewAI, DSPy, smolagents, Mastra) are reported at the provider their first name routes to
(`anthropic/claude-sonnet-4` to Anthropic, `gpt-4o` to OpenAI), the prefix dropped from `values`; a name
that routes nowhere leaves the provider `unknown`. An example env file's name routes nothing.

## Operations: JSON-RPC, GraphQL, SOAP, action APIs

A call to an API that names the operation outside the URL (JSON-RPC, GraphQL, SOAP, action-style APIs such as
AWS Query) carries `operation`, and its `id` includes `operation.name`: two operations sent to one URL are two
calls. JSON-RPC is recognized in every language: a JSON body with `jsonrpc` and a `method` (or a 1.0-style
`method`, `params` and `id`) gives `protocol: json-rpc` with the method as `name`, also through a helper that builds
the envelope (`rpc("getBalance", [address])`). GraphQL is recognized from the document a request sends (`query` in
a JSON body, `?query=`, a batch array, Octokit's `graphql()`), written in a string, a `gql` tagged template, an
imported `.graphql` file or a codegen AST object (`{"kind":"Document","definitions":[...]}`, also through `print()`):
`protocol: graphql` with the operation's `name` (its root fields when anonymous), `type`, and
`fields`, the sorted leaf paths it selects with aliases resolved and fragments inlined, and `arguments`, the arguments
written on selected fields by field path ([#56](https://github.com/okapi-hq/api-grep/issues/56)): a literal as its
JSON value (an enum value its name), a variable `"$name"`, a computed part of a string `{name}`; a string or number
under a credential name (`password`, `apiKey`) is `<redacted>`; a path that aliases select with different arguments
has a list of them; absent when no selected field has any. A persisted query is named by its `operationName`. SOAP is recognized from a `SOAPAction` header, a SOAP 1.2 content type or an `Envelope` body:
`protocol: soap` with the action's last segment (`Track`), else the first element of the envelope's `Body`.
Action-style APIs name the operation in a query or form parameter that `providers.json` declares per provider
(`Action` for AWS Query, `method` for Flickr): `protocol: action`.

```yaml
    operation:
      protocol: graphql          # json-rpc | graphql | soap | action
      name: GetOrder             # null when no part of it is known
      type: query                # GraphQL only: query | mutation | subscription
      fields: [order.customer.email, order.id]   # GraphQL only: selected leaf paths, sorted, aliases resolved, fragments inlined
      arguments:                 # GraphQL only, when a selected field has some: by field path, sorted
        order: { id: $id }       # literals as JSON values (`first: 10`, `sortKey: CREATED_AT`), variables as "$name"
      dynamic: false             # true: part of the name is computed; name keeps the rest ({…} for the unknown part)
      from: document             # body | header | query | document
```

`alternatives` lists every name when a branch picks one (`name` is the first). A request that sends several
operations together (a JSON-RPC or GraphQL batch array) gives one call per operation at the same location, each with
`batch: true`; so does a GraphQL document of several operations with no `operationName` picking one (without
`batch`). `operationId` is unrelated: the OpenAPI id of an SDK method. The reasons are in
[languages.md](languages.md#operations-the-url-does-not-name-30).

### SOAP clients

SOAP client libraries ([#58](https://github.com/okapi-hq/api-grep/issues/58)) build the envelope from a WSDL, so the
call is the operation the code calls: PHP's `SoapClient` (`$client->Track($args)`, `__soapCall('Track', [$args])`,
`client: php-soap`), Python's zeep (`client.service.Track(Id=x)`, `client: zeep`) and node-soap
(`client.TrackAsync(args)`, `client.Track(args, cb)`, `client: node-soap`). Each is a `POST` with `operation: { protocol:
soap, name: Track, from: body }` and the arguments as an `xml` body. The URL is the address the code gives the client
(PHP's `location` option, node-soap's `endpoint`, zeep's `create_service`), else the address a WSDL file of the
repository declares (`soap:address`), else the WSDL URL without its `?wsdl` query (`https://ws.example.com/track?wsdl`
is `https://ws.example.com/track`). A WSDL given by URL is never fetched: a client whose WSDL the scan cannot read has
an unknown host. A method a WSDL file of the repository does not declare is not reported.

### JSON-RPC clients

JSON-RPC client libraries ([#52](https://github.com/okapi-hq/api-grep/issues/52)) are SDK calls whose operation is
the RPC method the client method sends, not the method's own name: `connection.getParsedTransaction(sig)` is
`getTransaction`, `client.readContract(...)` is `eth_call`; a generic transport method reads it from its argument
(`provider.send("eth_feeHistory", ...)`, `client.request({ method })`, `w3.provider.make_request(...)`). Covered:
`@solana/web3.js` (`Connection`, `sendAndConfirmTransaction`, `clusterApiUrl`) and `@solana/kit`
(`createSolanaRpc(url).getBalance(a).send()`), viem (public, wallet and test clients, `viem/actions`), ethers v5 and v6
(`JsonRpcProvider`, `StaticJsonRpcProvider`), web3.js, web3.py (`Web3(HTTPProvider(url))`, `AsyncWeb3`) and
solana-py (`Client`, `AsyncClient`). The endpoint is the URL the client or its HTTP transport is built with
(`http(url)`, also inside `fallback`), the method `POST`, and the provider the one that URL names. These libraries
also talk to a browser wallet (`new BrowserProvider(window.ethereum)`, viem `custom(window.ethereum)`, `new
Web3(window.ethereum)`) or over a WebSocket or IPC socket: those calls are not HTTP requests of the app and are not
reported, nor is a typed client (`provider: Provider`) in a project that builds one of them.

Since [#78](https://github.com/okapi-hq/api-grep/issues/78), also contract objects: ethers `new Contract(address, abi,
runner).balanceOf(owner)` (and `.staticCall()`, `.estimateGas()`, v5 `callStatic`), web3.js
`contract.methods.balanceOf(owner).call()` / `.send()`, viem `getContract({ client }).read.balanceOf([owner])` /
`.write`, web3.py `contract.functions.balanceOf(owner).call()` / `.transact()` / `.estimate_gas()`, `caller` and event
`get_logs`. They send `eth_call`, `eth_estimateGas` or a transaction; an ethers function called directly is a view or a
transaction as the ABI written in the code says, and its runner says who signs (`Wallet`: `eth_sendRawTransaction`,
`provider.getSigner()`: `eth_sendTransaction`); a contract on a wallet's signer is not reported. The function's name is
in `sdk.chain` (`Contract.balanceOf`). Also web3.py properties that send a request (`w3.eth.block_number`,
`w3.eth.chain_id`, `w3.eth.gas_price`), ethers' vendor providers (`InfuraProvider`, `AlchemyProvider`,
`QuickNodeProvider`: the host ethers builds from the network) and `getDefaultProvider`, and `@solana/spl-token` helpers
taking a connection (`getAccount`, `transfer`). Calls to Infura, Alchemy, QuickNode and Helius hosts are named by the
vendor (`infura`, ...), raw HTTP calls included.

Since [#85](https://github.com/okapi-hq/api-grep/issues/85), also clients reached in other ways. A client kept in a
cache that a helper fills (`getProvider(chainId)` returning `providers[chainId]`, or a `Map` entry) goes to one host
when every client the cache may hold agrees on it, else to an unknown host (never the first entry of a table of
URLs), and gives no call when one of them is a wallet. Also covered: a client held in a context object
(`services.rpc.getBlock(...)`), the connection of `@solana/wallet-adapter-react`'s `useConnection()` (the endpoint of
the app's `<ConnectionProvider>`), and wagmi actions and hooks (`readContract(config, {...})`, `useReadContract`,
`useBalance`, `usePublicClient()`), which send through the transports of the app's `createConfig`; wagmi writes go
through the connected wallet and are not reported. For contracts: TypeChain factories
(`Token__factory.connect(address, runner)`, also when the generated file is missing), `contract.connect(signer)` /
`attach(address)`, contracts typed as parameters (`token: Contract`), and ABIs imported from JSON files (also a Hardhat
artifact's `abi`), read to tell a view from a transaction. Calls to Solana's public clusters (`api.mainnet-beta.solana.com`,
`api.devnet.solana.com`, `api.testnet.solana.com`) are named `solana-public-rpc`.

Since [#98](https://github.com/okapi-hq/api-grep/issues/98), for any SDK client: a client handed down by the app's
own React context (`useContext(RpcContext)`, also through the app's own hook, reads the `value` of its
`<RpcContext.Provider>` elements: one host when they agree), a value memoized with `useMemo`, a client held in a
context object given as an untyped parameter (`settle(ctx)` then `ctx.provider.getBalance(...)`: the callers' object),
and a factory a constructor is handed (`constructor(private getProvider: (chainId) => Provider)`, then
`this.getProvider(id)`: what the functions passed by the class's `new` expressions return, often a cache). wagmi
configs memoized in a component, ConnectKit's `getDefaultConfig` (its transports, else wagmi's default HTTP ones) and a
config picked at build time (`isTest ? testConfig : appConfig`) are read too. In Python, a client kept in a module's
dict that a helper fills (`_clients[chain_id] = Web3(...)`) goes to one host only when every cached client agrees.

### GraphQL clients

GraphQL client libraries ([#54](https://github.com/okapi-hq/api-grep/issues/54)) are SDK calls (`client: sdk`) whose
operation comes from the document they are given: Apollo Client (`client.query` / `mutate` / `watchQuery` /
`subscribe`, `useQuery`, `useLazyQuery`, `useSuspenseQuery`, `useBackgroundQuery`, `useMutation`, `useSubscription`),
urql (`client.query` / `mutation` / `subscription`, `useQuery`, `useMutation`, `useSubscription`), graphql-request
(`GraphQLClient.request` / `rawRequest`, `request(url, document)`) and Python `gql` (`client.execute`, also through
`async with client as session`). The endpoint and headers are those the client is built with (`new ApolloClient({
uri })`, the one `HttpLink` of its `link`, `createClient({ url, fetchOptions })`, `new GraphQLClient(url, { headers
})`, `Client(transport=RequestsHTTPTransport(url=..., headers=...))`), and the provider is the one that URL names, as
for a plain HTTP call. A hook names no client: it uses the project's client when the project builds exactly one (or
the one its `client` option names), otherwise its host stays `unknown`, as does a subscription's (they usually go
over a WebSocket of their own).

Relay, Shopify's clients and Python `sgqlc` ([#67](https://github.com/okapi-hq/api-grep/issues/67)) are read the same
way. Relay (`useLazyLoadQuery`, `usePreloadedQuery`, `useMutation`, `commitMutation`, `fetchQuery`) sends to the URL of
the one `fetch` in the function its network layer is built with (`new Environment({ network: Network.create(fetchFn)
})`, also through the functions it calls), the project's one environment, else an `unknown` host; a compiled artifact
(`import Query from "./__generated__/Query.graphql"`) gives the text of its `params`, or the name and type of a
persisted query. Shopify's clients are calls to the `shopify` provider at `{shop}.myshopify.com`, path
`/admin/api/{version}/graphql.json` (`/api/{version}/graphql.json` for the Storefront API), the version written in when
the code gives it: `admin.graphql(...)` from `authenticate.admin(request)` (the Remix and React Router app packages),
`new shopify.clients.Graphql({ session }).request(...)` / `.query({ data })`, `createAdminApiClient(...)` and
`createStorefrontApiClient(...)` `.request(...)`, `shopify-api-node`'s `graphql(...)` and Python `shopify.GraphQL().execute(...)`.
`sgqlc` sends to its endpoint's URL (`HTTPEndpoint(url, headers)(document, variables)`), its document written as text
or built with `Operation(schema.Query)` and the selections the same function makes on it
(`op.repository(owner=o).issues(first=10).nodes.title()`).

[#83](https://github.com/okapi-hq/api-grep/issues/83) adds more of them. Plain HTTP calls to `{shop}.myshopify.com`
are the `shopify` provider too. Shopify clients a project factory returns inside an object
(`const { client } = await clientProvider.online.graphqlClient({ req, res })`) or a class keeps in a field set from its
constructor (`this.client.graphql(...)`, the client found where the class is built), Hydrogen's
`context.storefront.query(...)` / `mutate` and `context.customerAccount.query(...)` (in a project that declares
`@shopify/hydrogen`), and the REST resources of `shopify-api-node` (`shopify.product.list()`), `@shopify/shopify-api`
(`new shopify.clients.Rest({ session }).get({ path: "products" })`, `shopify.rest.Product.all({ session })`),
`createAdminRestApiClient` and Python `ShopifyAPI` (`shopify.Product.find()`), at `/admin/api/{version}/<resource>.json`.
Relay's `loadQuery(environment, query, variables)` (with a `require("./__generated__/Query.graphql")` artifact),
`<QueryRenderer query={...} />` and the refetch and pagination containers. `sgqlc` endpoints given as parameters (the
callers' endpoint, else an `unknown` host in a project that declares `sgqlc`) and selections made by a helper given the
`Operation`.

[#92](https://github.com/okapi-hq/api-grep/issues/92) goes on: Shopify REST records saved or changed through an
instance (`new shopify.rest.Product({ session })` then `product.save()`, a `POST`, or a `PUT` once the code sets its
`id`; `order.close()`; Python `shopify.Product(attributes).save()`, `shopify.Product.find(id).destroy()`),
`admin.rest.resources` of the app packages, resources whose path depends on an owner (`Metafield.all({ session,
product_id })`, Python `Variant.find(product_id=p)`), `shopify-api-node` methods whose body the library builds
(`customerAddress.create`), `shopify.auth.tokenExchange(...)` / `refreshToken` / `callback`
(`POST /admin/oauth/access_token`), `shopify.clients.graphqlProxy(...)`, Hydrogen's cart (`context.cart.addLines(lines)`
sends the `cartLinesAdd` mutation), Relay's `useQueryLoader(query)` and the refetch and pagination of fragments
(`usePaginationFragment`, `useRefetchableFragment`: the query generated for the fragment's `@refetchable(queryName)`,
read from its artifact when the scan has it), when the code keeps the function that sends.

[#102](https://github.com/okapi-hq/api-grep/issues/102) completes them: a Shopify record read with `find`
(`const product = await shopify.rest.Product.find({ session, id })`, then `product.title = t; await product.save()`)
is a `PUT` of what the code sets to the id `find` was given; Python records get the attributes set one by one
(`product.title = t`) in their body; `useQueryLoader` reports the variables its `loadQuery` is given in the component;
`shopify-api-node`'s `article.tags(blogId?, params)` picks the blog's path or every article's from the arguments;
ShopifyAPI's `Province` and `GiftCardAdjustment`; the delivery address and gift card methods of Hydrogen's cart
handler (2025.4 to 2026.4); and Hydrogen 2026.10's storefront client (`client.graphql(query, { variables })`, also
read from React Router's context), `getCart(...)` and `cartHandlers.get(...)`.

## XML bodies

An XML document sent as the body (a SOAP envelope, a template, a `format()` string, a heredoc) is
`bodyEncoding: xml`, its shape the element structure (root, then child elements, then the leaves' text); a body built
by an XML library or sent with an XML content type is `xml` with its value unread. HTML and SVG markup (`<p>...</p>`,
`<html>`, `<svg>`) is not an XML body.

## Where an SDK client came from

An SDK call made on an untyped parameter (`def ask(client, prompt): client.messages.create(...)`,
`(c: any) => c.chat.completions.create(...)`) carries `clientFrom`, which says where its client was found:

```yaml
    clientFrom: caller           # caller: what the function's callers pass (one call per distinct client)
                                 # manifest: no caller passes a known client; the one declared SDK with that method
```

A call whose client neither the callers nor the manifests settle is listed in `diagnostics.unfollowed` as
`receiver-unknown`. Details in [languages.md](languages.md#sdk-clients-passed-as-untyped-parameters-37).

## Hosts picked from a table

A call whose base URL the code picks at run time from a table it writes (`PROVIDERS[name].baseUrl`,
`LIST.find((p) => p.key === id).url`, `next(d for d in DEFAULTS if d.name == name).base_url`, a helper with several
returns, a Rust `match`; [detection.md](detection.md#how-a-call-is-resolved)) is reported once per candidate host
(schema 1.24). Each copy has its own `host`, `hostKind`, `provider` and `id` (the place's, then `#1`, `#2`… in table
order, as for the requests a wrapper sends from one place), and all of them carry `hostAlternatives`, every
candidate host in table order:

```yaml
  # const preset = PRESETS[kind]; fetch(`${preset.chat}/chat/completions`, { body: JSON.stringify({ model: preset.chatModel, ... }) })
  - id: 1d07404ef65e
    provider: deepseek
    host: api.deepseek.com
    hostKind: const
    hostAlternatives: [api.deepseek.com, api.siliconflow.cn, api.moonshot.cn]
    model: { values: [deepseek-chat], dynamic: false, from: body }   # the model the same entry names
  - id: 677142953cf2
    provider: api.siliconflow.cn
    host: api.siliconflow.cn
    hostKind: const
    hostAlternatives: [api.deepseek.com, api.siliconflow.cn, api.moonshot.cn]
    model: { values: [Qwen/Qwen2.5-7B-Instruct], dynamic: false, from: body }
```

The copies are one place in the code: count `hostAlternatives` groups, not calls, to count call sites. An entry the
scan reads no host from (a URL from user settings) is left out. A table of more than 20 entries is not listed: the
call is reported once, as read without the table, with a `host-table-limit` entry in `diagnostics.unfollowed`
(`"detail": "50 candidates (at most 20)"`).

## Contract

The format is specified by a JSON Schema (draft-07), [`schema/report.v1.json`](../schema/report.v1.json),
which describes every field. It is generated from [`src/report/schema.ts`](../src/report/schema.ts)
and a test fails when it is out of date, so it always matches what the CLI writes. Get it from
this repository, from `api-grep schema`, or in Node from `import schema from "api-grep/schema.json"`,
and validate reports with any JSON Schema validator (ajv, Python `jsonschema`, …).

`schemaVersion` is the version of the format, separate from the tool's `version`:

- **minor** (`1.1.0`): new fields or enum values, such as a new `client` or `language`. Readers
  ignore fields they do not know and treat unknown enum values as "other". Objects in the schema
  stay open, so a 1.0 reader still validates a 1.1 report.
- **major** (`2.0.0`): anything that can break a reader. The schema moves to `report.v2.json` and
  `report.v1.json` stays.

Each call names its file and language in `location`, `stats.byLanguage` counts calls per language
and `diagnostics.languages` files per language: `typescript`, `javascript`, `html` (inline scripts
and forms, at their line in the page), `python`, `php`, `kotlin`, `java`, `go`, `rust`, `dart` and `shell` share one format.
Coverage rows name their package `ecosystem` (`npm`, `pypi`, `composer`, `maven`, `go`, `cargo`, `pub`); shell scripts have no
packages and add no row.

## Example requests

Every call carries `examples`, concrete requests synthesized from what was resolved. Values
follow the checker's types and are chosen by name (`email` gets an address, `createdAt` an ISO
date, `per_page` a small integer), seeded by the call id so they are stable across runs.
`minimal` sends required properties, `full` adds optional ones, `alt` switches enum values,
union branches and booleans. Secret-looking keys and headers (`token`, `api_key`, `password`,
`authorization`, `cookie`) become `<name>` placeholders. Unresolved hosts stay visible as
`https://{baseUrl}/…` or `https://{env:API_URL}/…`.

## Diagnostics

`diagnostics` says what the scan could not read, so a partial report never looks complete:

```json
"diagnostics": {
  "filesSeen": 1840,
  "filesScanned": 1702,
  "skipped": [{ "file": "src/legacy/x.ts", "reason": "parse-error", "detail": "Expected the module specifier to be a string literal." }],
  "skippedCounts": { "parse-error": 1, "excluded": 137 },
  "droppedCalls": [{ "file": "lib/a.ts", "line": 120, "reason": "schema-invalid", "detail": "body.properties.config: Invalid input" }],
  "unfollowed": [
    { "file": "executors/x.ts", "line": 90, "reason": "injected-fetch", "expr": "this.fetchFn" },
    { "file": "executors/y.ts", "line": 31, "reason": "wrapper-depth", "via": "tlsFetch" },
    { "file": "src/catalog.ts", "line": 48, "reason": "graphql-limit", "detail": "fields" }
  ],
  "languages": { "typescript": { "filesSeen": 1840, "filesScanned": 1702 } },
  "complete": false
}
```

- `skipped`: `parse-error` (a syntax error, or an import whose module specifier is not a string
  literal) and `internal-error` (a detector threw) files are not scanned. Files left out by
  `--exclude` (`excluded`) or `--include` (`not-included`) are listed too, or only counted above
  200. Test files, mocks, declarations and build output are out of scope and not counted. Every
  source file under the directory is scanned, also outside the tsconfig `include`.
- `droppedCalls`: calls that failed the report schema (`schema-invalid`, with the zod path) or
  made the resolver throw (`internal-error`). The rest of the report is still written.
- `unfollowed`: a fetch function received from outside (`this.fetchFn(url)`, `deps.fetchUpstream(url)`),
  an HTTP client object received without a type that names it (`injected-client`: `self.session.post(url)`),
  an SDK method called on an untyped parameter whose client no caller and no single declared SDK settles
  (`receiver-unknown`: `client.chat.completions.create`), and calls to a wrapper three or more hops from its HTTP call (the inner call sites are
  reported, the outer one is not). A fetcher with a known default (`constructor(private fetchFn = fetch)`) or declared as
  `typeof fetch` is reported as a fetch call instead.
  `graphql-limit` (schema 1.19) is a call whose GraphQL document was read past a bound: the call is reported with
  the `name` and `type` the document's header gives, without `operation.fields` (past `operations`, without a name),
  and `detail` names the bound: `document-size` (100,000 characters), `document-parts` (built from 1,000 parts),
  `tokens` (50,000 parser tokens), `depth` (selection sets 32 deep), `fragment-expansion` (20,000 selection sets
  visited inlining fragments), `fields` (2,000 field paths), `operations` (50 operations in one request), `ast-size`,
  `ast-nodes`, `ast-nesting` (a document written as its AST: 4,000,000 characters, 200,000 values, 128 levels). One
  entry per location and bound; a document the code does not hold (a persisted query) is not one.
  `host-table-limit` (schema 1.24) is a call whose base URL is picked from a table of more than 20 entries
  ([Hosts picked from a table](#hosts-picked-from-a-table)): it is reported once, and `detail` gives the table's size.
- `complete` is false when something was lost that was not asked for: a skipped file (other than
  `--exclude` / `--include`), a dropped call, a call not followed, a GraphQL document not fully read or a host table
  too large to list.

The table ends with one line: `scanned 1702/1840 files, 3 skipped, 12 calls not followed, 1 GraphQL document not fully read`.
Skipped files and dropped calls are also printed to stderr as `warning:` lines.

## SDK coverage

`coverage.sdks` compares the API SDKs a repo uses with the calls found, so "0 Supabase calls"
never reads as "no Supabase". Each known SDK package (the `packages` of `providers.json`, by
ecosystem) that a covered manifest declares or a scanned file imports gets a row. The manifests are
`package.json` (`dependencies`, `peerDependencies`; type-only imports aside) for npm, and
`requirements*.txt`, `requirements/*.txt`, `pyproject.toml` (PEP 621 and Poetry), `Pipfile`,
`setup.cfg` and `setup.py` for PyPI (import names that differ from the package, like
`google-genai` / `google.genai`, are in [`src/lang/python/modules.json`](../src/lang/python/modules.json)),
the `require` of `composer.json` for Composer (namespaces per package in
[`src/lang/php/namespaces.json`](../src/lang/php/namespaces.json)), and for Maven the dependencies of
Gradle build scripts (Kotlin and Groovy DSL, version catalog accessors, test configurations aside)
and of `pom.xml` (test scope aside), as `group:artifact` (package roots that differ from the group in
[`src/lang/jvm/packages.json`](../src/lang/jvm/packages.json)), and for Go the `require` directives of `go.mod`
(`// indirect` ones aside), as module paths, a module counting for every import path under it, and for Cargo the
`[dependencies]` of `Cargo.toml` (per-target ones too, `x.workspace = true` read from the workspace; dev and build
dependencies aside), as crates.io names, a crate counting for the paths under its code name (`async_openai`):

```json
{ "package": "@notionhq/client", "ecosystem": "npm", "provider": "notion", "supported": false,
  "declared": true, "imported": true, "importSites": 41, "calls": 0, "status": "unsupported" }
```

`ok` (registry and calls), `unsupported` (imported, no registry: its calls are missed),
`imported-no-calls` (registry but no call: a wrapper, or a detection bug), `declared-not-imported`
(probably unused). The table prints one `⚠` line per `unsupported` and `imported-no-calls`
package. `--changed-since` scans have no coverage section.

## Host coverage

`coverage.hosts` (since 1.21.0) is a recall proxy: most API calls leave their host in the code
(`"https://api.openai.com/v1/..."`, `BASE = "https://api.telegram.org"`), so the API-looking hosts the scanned files
name, compared with the hosts of the calls found, show where calls are missed and why (a language, a client, a
pattern):

```json
"hosts": {
  "named": 23,
  "explained": 21,
  "unexplained": [
    { "host": "api.telegram.org", "files": 2, "literals": 3, "language": "python", "first": { "file": "bot/client.py", "line": 14 } }
  ]
}
```

- `named`: distinct hosts in the string literals of the scanned files (template strings, f-strings, heredocs and
  raw strings included; comments and Python docstrings are not literals). A literal counts for each `http(s)://` URL
  it holds, or as a whole when it is nothing but a host (`hostname: "api.acme.com"`, then only for a known provider
  host, an LLM gateway or an `api` label). Hosts are lower case, without port or user info, and never hold a
  placeholder (`https://${region}.acme.com` names none).
- A host is API-looking when it is a host of [`providers.json`](../src/normalize/providers.json), its first label is
  `api`, `api-*` or `*-api`, it is an LLM gateway without a provider entry (Azure AI services, Hugging Face
  endpoints, Cloudflare AI Gateway, …), or the URL's path looks like an API: a versioned segment (`/v1/`,
  `/v2beta/`, `/v1.1`), `/api`, `/graphql`, `/rest/` or a bot token (`/bot{token}/`). A bare domain (`acme.com`,
  `www.acme.com`) needs such a path; `github.com`, `gitlab.com`, `bitbucket.org` and `huggingface.co` count only
  for their API and OAuth paths, not for links to repositories or models.
- Never counted: single-label, loopback, private-network and reserved names (`backend`, `localhost`, `*.internal`,
  `*.local`, `*.test`, `example.com`), IP addresses, placeholders (`your-domain.com`), documentation and site pages
  (`docs.*`, `*-docs.*`, `developers.*`, `status.*`, `console.*`, `platform.*`), package registries' pages (npm,
  PyPI, crates.io, pkg.go.dev, Packagist, Maven), schemas and namespaces (`w3.org`, `json-schema.org`, `schema.org`),
  CDNs, fonts, images and badges, social and video sites, Wikipedia, and URLs to a page, an image, a script, a
  stylesheet or an archive (`.html`, `.png`, `.js`, …), by their path.
- Never counted either, since they name an API's host without calling it:
  - by their path: an OAuth authorization page, which the user's browser opens (`/authorize` alone or after an
    `oauth`, `oauth2`, `connect`, `auth` or `openidconnect` segment, `/o/oauth2/v2/auth`,
    `/protocol/openid-connect/auth`, any URL with `response_type=`), while the token, device and introspection endpoints, and a payment's
    `/orders/{id}/authorize`, still count; an OAuth scope written as a URL (`www.googleapis.com/auth/drive`,
    `graph.microsoft.com/User.Read`); a docs page by its first segment, after a locale (`/docs`, `/reference`,
    `/robots`, `/guides`, `/changelog`, …); on a generic cloud endpoint whose account or project is in the path
    (`*.amazonaws.com`, `*.googleapis.com`, Azure, Cloudflare), a segment to fill in (`your-account-id`,
    `YOUR_PROJECT`, `{your_key}`, `XXX`, `changeme`) or a sample's (`example`, `my-queue`, `123456789012`), as in a
    configuration default (`env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id')`); elsewhere a
    placeholder still counts, since such a URL is often the one a call sends
    (`https://hooks.slack.com/services/T000/B000/XXXX`);
  - by the text around them: a link in text for a person (`[label](url)`, `<url>`, Slack's `<url|label>`,
    `href="url"`);
  - by where the literal sits: an argument of a logging or printing call (`console.*`, `print`, `println!`,
    `eprintln!`, `log::info!`, `fmt.Print*`, `System.out.*`, `logger.*`, `log.*`, `logging.*`, Android's `Log.*`,
    `Log::info`, Laravel's `$this->info`, PHP's `echo`), also through formatting calls inside it
    (`console.log(chalk.green(...))`, `logger.info("{}".format(url))`), an error's message (`new Error(...)`,
    `raise ValueError(...)`, `fmt.Errorf`, `.expect(...)`), a URL handed to a browser (`res.redirect`,
    `window.open`, `webbrowser.open`); but a call inside them still counts (`console.log(await fetch(url))`);
  - the value of a key or variable naming a page, a redirect or a scope (`homepage`, `website`, `docs`,
    `documentation_url`, `href`, `link`, `redirect_uri`, `callback_url`, `authorizationURL`, `scope`), and the
    `url` or `uri` of a dict, object, array or struct with no request-like key beside it (`method`, `headers`,
    `body`, `params`, `baseURL`, `auth`, `token`, …), such as a list of bots (`{ name: "Slackbot", url:
    "https://api.slack.com/robots" }`), when its path has a docs segment anywhere (`/help`, `/docs`, `/wiki`, …);
  - test code inside a scanned file: Rust's `#[cfg(test)]` modules and `#[test]` / `#[tokio::test]` functions (the
    Rust front end reports no call from them either), Vitest's in-source `if (import.meta.vitest)` blocks.
- `explained`: named hosts that are the host of at least one call in `calls`, case and port aside; a call's host
  template (`{project}.supabase.co`) explains the hosts it matches, one with no literal domain (`{baseUrl}`) none.
  Each copy of a call picked from a host table explains its own host.
- `unexplained`: the others, most files first, then by host, at most 200 (`named - explained` counts them all).
  `first` is the first place the host is named by file path, then line, and `language` that file's.

What it does not measure: an SDK call to its default host leaves no literal, so a missed SDK call shows in
`coverage.sdks`, not here; a host built from parts (`f"https://{region}.api.acme.com"`), read from configuration or
the environment, or written in a language api-grep does not read (the scan never opens those files) is not named;
test files and other files out of the default file set are not read. An unexplained host is not always a missed call: a
URL can still be shown to a user, compared or opened in a browser in ways the rules above do not see. Files
over 2 MB are not read for hosts, only the first 64 KB of a literal is, and a scan keeps at most 50,000 host mentions.
The table prints `hosts named in code: 23, explained by a call: 21; not explained: api.telegram.org (2 files)`.
`--changed-since` scans have no coverage section.
