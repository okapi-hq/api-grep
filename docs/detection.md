# What api-grep detects

The HTTP clients, SDKs and code patterns each language front end reads, how a call is resolved, and the known
limits. Which SDKs have a registry in which language: [sdk-support.md](sdk-support.md). How the front ends are built:
[languages.md](languages.md).

## TypeScript and JavaScript

JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`) is read by the same type checker as TypeScript, so
everything below applies to both, with CommonJS (`require`, `module.exports`, `require("stripe")(key)`)
and `jsconfig.json` path aliases. Minified, bundled and vendored files are build output and are
not scanned, nor are `.ts` files that are not TypeScript (Qt translations, video streams).

| client | patterns |
|---|---|
| fetch | global `fetch`, `node-fetch`, `undici.fetch`, `cross-fetch`, `fetch(new Request(...))` |
| axios | `axios.<verb>()`, `axios(cfg)`, `axios.request(cfg)`, instances from `axios.create({ baseURL })`, aliased and `require`d imports |
| got / ky | `got(url, opts)`, `got.<verb>()`, `got.extend({ prefixUrl })`, `ky.create({ prefixUrl })`, `json` / `form` / `body` / `searchParams` |
| node http | `https.request(opts)`, `https.get(url)` |
| SDKs | registry-driven: `stripe`, `openai` (also pointed elsewhere by `baseURL`), `@anthropic-ai/sdk`, `@google/genai`, `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime`, `@octokit/rest`, `@slack/web-api`, `twilio`, `resend`, `@lemonsqueezy/lemonsqueezy.js`, RevenueCat (`react-native-purchases`, `@revenuecat/purchases-js`), `posthog-js`, `posthog-node`, `convex`, `@modelcontextprotocol/sdk`, `@aws-sdk/client-s3`, `aws-sdk` v2, `@supabase/supabase-js` (and `@supabase/ssr`), `firebase` modular (Firestore, Auth, Storage), `@sentry/*`; GraphQL clients `@apollo/client`, `urql`, `graphql-request` (endpoint from the client or its link), Relay (`react-relay`, `relay-runtime`: endpoint from the `fetch` of its network layer), Shopify (`@shopify/shopify-api` and its app packages, `@shopify/admin-api-client`, `@shopify/storefront-api-client`, `shopify-api-node`, GraphQL and REST; Hydrogen's context clients); messaging bots: node-telegram-bot-api, telegraf and grammY (also the handler context, `ctx.reply(...)`), discord.js (the client's managers, the `interaction`, `message` and `channel` events hand over, REST `Routes`); `@huggingface/inference`; JSON-RPC clients `@solana/web3.js`, `@solana/kit`, `@solana/wallet-adapter-react`, `viem`, `wagmi`, `ethers`, `web3` (endpoint from the client or its HTTP transport, the wagmi config or the `<ConnectionProvider>`) |
| AI SDK | `generateText` / `streamText` / `generateObject` / `streamObject` / `embed` / ... from `ai`: the provider, host and path come from the model (`openai("gpt-4o")`, `anthropic(...)`, `google(...)`, `vertex(...)`, `openrouter(...)`, `createOpenAI({ baseURL })(...)`, a `"provider/model"` string for the AI Gateway); a model the scan cannot trace is still a call, with provider `unknown` |
| jQuery | `$.ajax({ url, type, data, contentType, headers })`, `$.ajax(url, settings)`, `$.get` / `$.getJSON(url, data)` (data as query), `$.post(url, data)` (form body, JSON with `contentType`) |
| XMLHttpRequest | `xhr.open(method, url)`, `setRequestHeader(...)`, reported at `xhr.send(body)` |
| frameworks | options-object helpers: n8n `this.helpers.httpRequest` / `request` / `*WithAuthentication.call(this, cred, options)`, activepieces `httpClient.sendRequest`, ai-sdk `postJsonToApi` / `postToApi` / `postFormDataToApi` / `getFromApi` |

Callees are identified by declaration through the type checker, never by name: a shadowed
`fetch` is ignored and `import http from "axios"` is still axios. SDK instances are followed
through `new Stripe()`, exported instances in other files, class properties (`this.stripe`),
local factories (also lazy singletons: `let client; ... client ??= new OpenAI(); return client`, the construction
a `let` declared without a value is given in its file) and typed parameters (`stripe: Stripe`, `ctx.db` with `db: SupabaseClient`);
without the package's types installed, the written annotation is traced to its import.

Builder SDKs report one call per request: `supabase.from("tasks").select().eq("id", id).single()`
is a `GET /rest/v1/tasks` at the start of the chain (filters and `.single()` are not extra calls),
with the host taken from the URL given to `createClient`. Firebase paths are read from the
reference (`getDoc(doc(db, "users", uid))` is `.../documents/users/{uid}`); `signOut` and
`Sentry.init` send nothing and are not reported.

A client constructed with its own base URL (`new OpenAI({ baseURL: "https://openrouter.ai/api/v1" })`,
`new PostHog(key, { host })`, `new ConvexHttpClient(url)`) sends its calls there, and the provider
follows the URL when it names another known service (OpenRouter, Groq, `localhost:11434` for
Ollama). A base URL the scan cannot read (a parameter, a settings object) leaves the host `unknown`
rather than the SDK's default; `baseURL: undefined` (`base_url=None`) keeps the default. MCP clients
get the server URL from the HTTP transport built in the same file.

Libraries loaded with a `<script>` tag are used as globals the checker cannot see: `axios`, `$` /
`jQuery`, `supabase`, `Sentry` and `posthog` are read as their npm packages. Imports from a CDN
(`https://esm.sh/stripe`, `https://cdn.jsdelivr.net/npm/...`) and Deno `npm:` specifiers name their
package too.

## HTML

| source | what is reported |
|---|---|
| inline `<script>` | everything in the TypeScript / JavaScript table, at its line and column in the page; JSON, templates and import maps are skipped, old `<!-- //-->` wrappers are read |
| `<form action>` | a request to the action URL with its method; the named fields are the body (`multipart` / `form` from `enctype`) or, for a GET, the query; `email` / `number` / `hidden` fields are typed |
| `<script src>` from a CDN | an import of the npm package, for the SDK coverage |

Server-side template tags in scripts (Jinja / Django `{{ x }}`, `{% url %}`, EJS `<%= %>`, PHP
`<?= ?>`) are read as dynamic values: `fetch("{{ api_url }}/items")` is `{api_url}/items`. Forms
whose action is a template, an anchor or a `mailto:` are not requests.

## Python

| client | patterns |
|---|---|
| requests | `requests.get/post/...(url, json=, data=, files=, params=, headers=, auth=)`, `requests.request(method, url)`, `Session()` objects (also `with requests.Session() as s`) |
| httpx | module functions, `request`, `stream`, `Client` / `AsyncClient` with `base_url` and `headers`, also through `async with` |
| aiohttp | `ClientSession(base_url)` and its verbs, `request(method, url)` |
| urllib | `urllib.request.urlopen(url, data)`, `urlopen(Request(url, data, headers, method=...))` (POST when there is data), `urllib3.PoolManager().request(...)` |
| SDKs | registry-driven, see [sdk-support.md](sdk-support.md): OpenAI (also Azure, and other services through `base_url`), Anthropic (also Bedrock and Vertex clients), Google Gen AI, Google Generative AI, Stripe (`StripeClient` and the classic `stripe.Customer.create`), Supabase, Firebase Admin, Firestore, Sentry, boto3 (S3, Bedrock runtime), Twilio, Slack, Resend, PostHog, Mistral, Groq, Cohere, ElevenLabs, Convex, huggingface_hub (`InferenceClient`, Hub downloads); Telegram bots (python-telegram-bot with `context.bot` and `update.message.reply_text`, aiogram with `message.answer`, pyTelegramBotAPI), discord.py and its forks (`interaction.response.send_message`, `message.channel.send`, `tree.sync()`); the GraphQL clients `gql` (endpoint from its transport) and `sgqlc` (endpoint from its `HTTPEndpoint`, documents built with `Operation` read), ShopifyAPI (`GraphQL().execute` and the REST resources, `shopify.Product.find()`); the JSON-RPC clients web3.py and solana-py (endpoint from the provider or client) |

Python keyword arguments are SDK bodies (`client.chat.completions.create(model=..., messages=...)`).
Clients are followed through module variables and imports, `self.client = OpenAI()` in any method,
annotated parameters and locals (`client: OpenAI`, `db: Client = ctx.db`), factories that return a
client (one of several SDKs' clients, also a field set to either: the one with the method called), names an
`except ImportError:` fallback sets to `None`, `@property` / `@cached_property` clients,
dataclass `default_factory` fields, FastAPI `Depends(...)` parameters, `x or OpenAI()` defaults and subclasses of a
client class; `asyncio.to_thread(client.messages.create, ...)`, `run_in_executor` with `functools.partial` and a literal
`getattr(obj, "create")` read as the call they make, and `executor.submit(fn, client, ...)` as a call of `fn`. The builder and base URL rules
above apply too: `supabase.table("tasks").select("*").eq(...).execute()` is one `GET /rest/v1/tasks`,
`OpenAI(base_url="https://openrouter.ai/api/v1")` sends to OpenRouter. How the Python front end
works, and how to add a language: [languages.md](languages.md).

## PHP

| client | patterns |
|---|---|
| Guzzle | `new Client(['base_uri' => ..., 'headers' => ...])`, verbs and `*Async`, `request($method, $uri, $options)`, options `json`, `form_params`, `multipart`, `body`, `query`, `headers`, `auth`; also `ClientInterface` parameters and `\Drupal::httpClient()` |
| Laravel `Http` | `Http::post($url, $data)` / `get($url, $query)` / `send(...)` with fluent `withToken`, `withBasicAuth`, `withHeaders`, `asForm`, `asMultipart`, `baseUrl`, `withQueryParameters`, `withOptions`; `config('services.x.url')` is read from `config/services.php` |
| Symfony HttpClient | `HttpClient::create([...])`, `createForBaseUri($url)`, `HttpClientInterface` injection, `request($method, $url, ['json' => ..., 'query' => ..., 'auth_bearer' => ...])` |
| curl | `curl_init($url)` + `curl_setopt` / `curl_setopt_array` (`CURLOPT_URL`, `CUSTOMREQUEST`, `POST`, `POSTFIELDS`, `HTTPHEADER`, `USERPWD`), reported at `curl_exec` |
| PSR-7 / PSR-18 | `$client->send(new Request(...))`, `sendRequest(...)`, also through a helper that builds the request |
| streams | `file_get_contents` / `fopen` on an `http(s)` URL or with a `stream_context_create(['http' => ...])` context (file reads are not calls) |
| WordPress | `wp_remote_get`, `wp_remote_post`, `wp_remote_request` (and `wp_safe_*`) |
| SDKs | registry-driven, see [sdk-support.md](sdk-support.md): Stripe (`StripeClient`, static `\Stripe\Customer::create`), openai-php (client, factory with `withBaseUri`, Laravel facade), Anthropic (official, named arguments; mozex), Gemini, AWS (S3, Bedrock runtime), Twilio, Firebase (kreait, Firestore), Sentry, Resend, PostHog, SendGrid, Mailgun, Slack, Telegram (irazasyed/telegram-bot-sdk: `$telegram->sendMessage([...])`, the Laravel facade) |

Names resolve through namespaces and `use` (classes, functions, constants), `self::` / `static::`,
class constants, `define()` / `const`, promoted and typed properties, `$this->x` set in any
method, closures with `use (...)`, `env('X', 'default')`, `getenv()`, `$_ENV` and `$_SERVER`.

## Kotlin and Java

Kotlin and Java files are read by one front end into one index: a Java class and a Kotlin file of
the same package see each other, imports resolve across the two, and each call keeps its file's
language. The clients and SDK registries below apply to both; in Java, `new X(...)` is a call of `X`
and `Api.class` a class reference.

A client injected by a DI container keeps its base URL, interceptors and default headers: Dagger / Hilt `@Provides`
and `@Binds`, `@Inject` constructors and fields, Spring `@Bean` methods and stereotypes (`@Primary`, bean names), Koin
definitions and lookups (`single { ... }`, `singleOf(::Repo)`, `get()`, `by inject()`), selected by `@Named` and
`@Qualifier` annotations. When several bindings fit and nothing tells them apart, none is attached.

| client | patterns |
|---|---|
| OkHttp | `client.newCall(Request.Builder().url(...).header(...).post(body).build())`, also built over several statements and sent through a wrapper; `HttpUrl` builders (`toHttpUrl().newBuilder().addQueryParameter(...)`), bodies from `toRequestBody(mediaType)` / `RequestBody.create`, `FormBody.Builder`, `MultipartBody.Builder`; builder steps inside `apply { }`; the headers and query parameters of the client's interceptors (`addInterceptor { ... }`, an interceptor class, one wrapping another, lists of them built with `buildList` or `add`) on every call it makes, `optional` in `clientParts` when set in a branch or after an early return |
| `java.net.http` | `HttpRequest.newBuilder(uri)` / `.uri(...)` with `GET()` / `POST(...)` / `method(...)`, `header` / `headers`, `BodyPublishers.ofString`, sent by `send` / `sendAsync`; `HttpURLConnection` (`URL(u).openConnection()` with `requestMethod`, `setRequestProperty`, a written body, also in a helper the connection is passed to) |
| Ktor client | `client.get/post/put/patch/delete/request(url) { parameter(...); header(...); setBody(...); contentType(...); bearerAuth(...); url { ... } }`, `method = HttpMethod.X`, `submitForm(url, formParameters = parameters { ... })`, `FormDataContent`, `MultiPartFormDataContent(formData { ... })`, kotlinx `buildJsonObject { ... }` bodies; the client's `defaultRequest { url(...); header(...) }` and `install(Auth) { bearer { ... } }` |
| Spring | `RestTemplate` (`getForObject`, `postForObject`, `exchange` with `HttpMethod` and an `HttpEntity` or a `RequestEntity`, `UriComponentsBuilder` URLs, the headers of its interceptors), `WebClient` and `RestClient` chains (`post().uri(...).bodyValue(...).retrieve()`) with the `baseUrl`, `defaultHeader`, `defaultHeaders { }` and filters of their builder; `BodyInserters.fromFormData(...)` |
| OpenFeign | `@FeignClient(url = "\${x:default}")` interfaces with `@GetMapping` / `@PostMapping` / `@RequestMapping`, `@RequestParam`, `@RequestHeader`, `@RequestBody`, `@SpringQueryMap`; Feign `@RequestLine` / `@Headers` interfaces given to `Feign.builder().target(...)`; one call per method, at its declaration |
| Retrofit | service interfaces (`@GET` ... `@OPTIONS`, `@HTTP`, `@Path`, `@Query`, `@QueryMap`, `@Header`, `@HeaderMap`, `@Headers`, `@Body`, `@FormUrlEncoded` with `@Field` / `@FieldMap`, `@Multipart` with `@Part` / `@PartMap`, `@Url`), one call per method at its declaration, resolved against the `baseUrl(...)` of the `Retrofit.Builder()` whose `create(Api::class.java)` / `create<Api>()` made it (one call per base URL), as Retrofit resolves it (a leading `/` replaces the base path, the base's query string is dropped); the interceptors of `.client(okHttp)`; the converters choose the body encoding |
| Apache HttpClient 4 and 5 | `client.execute(new HttpPost(url))` with `setHeader` / `addHeader` / `setEntity` on the request (also over several statements and through a wrapper), `RequestBuilder` / `ClassicRequestBuilder` / `SimpleRequestBuilder` chains (`addParameter` is a form body for a POST, a query otherwise), the async client's `execute(request, callback)`, the fluent `Request.Post(url).bodyString(...).execute()`; `StringEntity` (with its `ContentType`), `UrlEncodedFormEntity` of `BasicNameValuePair`s, `MultipartEntityBuilder`, `URIBuilder` URLs; `execute(new HttpHost(...), request)`; the client's `setDefaultHeaders(...)` and request interceptors |
| JAX-RS client | `client.target(url).path(...).queryParam(...).request(...).header(...).post(Entity.json(body))`, `get()`, `method("PATCH", entity)`, `buildPost(entity).invoke()`, `async()`, through `WebTarget` and `Invocation.Builder` variables; `Entity.json` / `form` / `entity(x, type)`, `Form().param(...)`; the headers of `ClientRequestFilter`s registered on the client or target; JAX-RS resources (`@Path` classes) are endpoints, not calls |
| AsyncHttpClient | `client.preparePost(url).setHeader(...).addQueryParam(...).setBody(...).execute()`, `addFormParam`, `executeRequest(new RequestBuilder("POST").setUrl(...).build())` |
| Unirest | `Unirest.post(url).header(...).queryString(...).body(...).asJson()` (every `as*` call), `field(k, v)` form bodies, `basicAuth`; `Unirest.config().defaultBaseUrl(...)` and default headers; `routeParam` placeholders stay in the path |
| Vert.x `WebClient` | `client.post(port, host, uri)` / `get(host, uri)` / `getAbs(url)` with `putHeader`, `addQueryParam`, `bearerTokenAuthentication`, `authentication(credentials)`, sent by `send`, `sendJson`, `sendJsonObject`, `sendForm`, `sendMultipartForm` (also the RxJava and Mutiny variants); the default host, port and TLS of the client's `WebClientOptions` |

JSON bodies come from `JSONObject().put(...)` chains, `mapOf(...)` serialized by Gson, Moshi,
Jackson or kotlinx, and data classes; form bodies from `FormBody`, `LinkedMultiValueMap` and the
content type; a `HashMap` or `mutableMapOf()` filled with `map["k"] = v` in Kotlin; in Java also `Map.of(...)`, a
`HashMap` filled with `put`, POJOs, records and Lombok `@Builder` chains (`Payload.builder().name(n).build()`, under
the fields' JSON names, with `@Singular` adders and `toBuilder()` copies), and Lombok getters read as their fields. A
request started in the branches of a `when` / `switch` is one call per start, up to four; a request factory with
several `return`s is one call, as a helper is; an overloaded method is the one its arguments fit. The Gradle
and Maven manifests are read, so `coverage.sdks` lists the JVM SDKs a project declares
(`ecosystem: "maven"`).

SDK calls are detected through the JVM registries (`src/lang/jvm/registry/`): the official OpenAI and Anthropic Java SDKs, Stripe,
AWS (S3, the S3 Transfer Manager, DynamoDB and its enhanced client, SQS, SNS, SES, SES v2 and Bedrock Runtime from the
AWS SDK for Java 2.x and the AWS SDK for Kotlin; S3 from the AWS SDK for Java 1.x), Google Gen AI, Firestore and
Firebase Admin, Twilio, Slack, Sentry and PostHog, the community openai-kotlin client, Azure OpenAI, LangChain4j model
clients, Firebase for Android (Auth, Realtime Database, Storage, Functions), supabase-kt, SendGrid, Resend, Mailgun and
Spring AI's OpenAI, Anthropic, Mistral AI, Ollama, Azure OpenAI, Bedrock Converse, Google GenAI and DeepSeek models,
with the provider of the declared starter (or the bean a qualifier, `spring.ai.model.chat` or a bean name selects) and
the model and base URL of `application.yml` / `application.properties` (with its active profile and imported files),
else the starter's default model for the declared release ([sdk-support.md](sdk-support.md)). Parameters given as builders
(`MessageCreateParams.builder().model(Model.CLAUDE_SONNET_4_5).maxTokens(1024).build()`, also built
in steps or filled by a lambda, and the AWS SDK for Kotlin's `PutObjectRequest { bucket = b }`) are read as the
request body, and enum constants as the model ids they stand for.

Values are resolved through string templates, `+`, `buildString`, `String.format`,
`const val` and other top-level properties (also from other files of the package and through
imports), `object` and `companion object` members, constructor properties, `by lazy`, getters,
`init` blocks, parameter defaults and named arguments, `System.getenv("X") ?: "default"`,
`System.getProperty`, Android `BuildConfig.X` (with the literal of `buildConfigField` in the
module's Gradle file as its default) and Spring `@Value("\${x:default}")`. Data classes give body
shapes, with `@SerializedName`, `@Json(name = ...)`, `@SerialName` and `@JsonProperty` names.
Gradle build scripts (`*.gradle.kts`), `buildSrc/`, `build-logic/` and test source sets are out of
scope.

Java values resolve the same way: `static final` constants (also through `import static` and from
Kotlin `object`s), fields set in constructors, `+`, `String.format`, `"...".formatted(...)`,
`String.join`, `StringBuilder` chains and appends, text blocks, `System.getenv`,
`System.getProperty`, Spring `@Value("${x:default}")` and `Environment.getProperty("x", "d")`,
`Optional.ofNullable(x).orElse(d)` and `BuildConfig.X`; POJO fields and records give body shapes
under their `@SerializedName` / `@JsonProperty` names (`transient` aside). Maven `target/`, test
source sets and `*Test.java` / `*IT.java` are out of scope.

## Go

Go files are read through tree-sitter into the shared engine. The files of one directory are one package: their
types, functions and package-level `const` / `var` see each other, and a type declared in one file gets the methods
other files declare on it. Packages of the module (`go.mod`'s `module` path) resolve through their import paths, with
or without an alias; a method's receiver (`c` in `func (c *Client) Do()`) reads as the object, its fields typed by the
struct declaration and given values by the struct literals of the project (`&Client{baseURL: u}` in a constructor
function).

| client | patterns |
|---|---|
| `net/http` | `http.Get(url)`, `http.Head(url)`, `http.Post(url, contentType, body)`, `http.PostForm(url, values)`, the same methods of a `http.Client` (`&http.Client{}`, `http.DefaultClient`, a field or parameter of type `*http.Client`); `http.NewRequest(method, url, body)` / `http.NewRequestWithContext(ctx, ...)`, reported where the request is built (any client may send it: `client.Do(req)`), with the `req.Header.Set` / `Add`, `req.SetBasicAuth` and `q := req.URL.Query(); q.Set(...)` calls that follow it in the function; method constants (`http.MethodPost`); the content type of a literal `Content-Type` header gives the body encoding |
| go-retryablehttp, fhttp | the same as `net/http`: `retryablehttp.NewRequest(...)`, `retryablehttp.Get(url)`, the fhttp fork imported as `http` |
| Resty (v2 and v3) | `resty.New()` with `SetBaseURL`, `SetHeader(s)`, `SetAuthToken`, `SetBasicAuth`, then `R()` with `SetHeader`, `SetBody`, `SetQueryParam(s)`, `SetFormData`, sent by `Get` / `Post` / `Put` / `Patch` / `Delete` / `Head` / `Options` / `Execute(method, url)`; also on a client kept in a variable or a field |

Bodies come from `json.Marshal(x)` (`xml.Marshal` for XML) behind `bytes.NewBuffer`, `bytes.NewReader` or
`strings.NewReader`: map literals (with keys added by `m["k"] = v`), struct literals under their fields' `json` tag
names (a struct passed as a parameter: its declared fields, `omitempty` ones optional, unexported and `json:"-"` ones
left out), anonymous structs, and `url.Values` built literally or with `Set` / `Add` for forms.

SDK calls are detected through the Go registries (`src/lang/go/registry/`): sashabaranov/go-openai
(`openai.NewClient(token)`, `openai.NewClientWithConfig(cfg)` with `cfg := openai.DefaultConfig(token); cfg.BaseURL =
...` for another OpenAI-compatible provider), the official openai-go (`client.Chat.Completions.New(ctx, params)`,
`option.WithBaseURL(u)`), anthropic-sdk-go (`client.Messages.New(ctx, params)`) and google.golang.org/genai
(`client.Models.GenerateContent(ctx, "gemini-2.5-flash", ...)`, the model in the path; `client.Chats.Create(...)` then
`SendMessage`) ([sdk-support.md](sdk-support.md)). Request structs are read as the JSON they send (`MaxTokens` ->
`max_tokens`), with the fields set on their variable afterwards (`req.Stream = true`); the SDKs' value helpers
(`openai.Int(512)`, `anthropic.String(s)`, `openai.UserMessage(m)`, `anthropic.NewUserMessage(anthropic.NewTextBlock(t))`,
`genai.Text(p)`) as what they build, and their model constants (`openai.GPT4o`, `openai.ChatModelGPT4o`,
`anthropic.ModelClaudeSonnet4_5`) as the model ids they stand for.

Values are resolved through string literals (raw and interpreted), `+`, `fmt.Sprintf` (`%s`, `%d`, `%v`, `%q`),
`path.Join`, `url.JoinPath`, `strings.Join` of a slice literal, `strings.TrimSuffix` / `TrimSpace`, `url.PathEscape`,
package-level and local constants and variables (also of other files and packages), struct fields, function parameters
(their callers' values, #39) and `os.Getenv("X")` / `os.LookupEnv("X")`. `go.mod` is read, so `coverage.sdks` lists the
Go SDK modules a module requires (`ecosystem: "go"`, `// indirect` requirements aside). `_test.go` files, `vendor/` and
`testdata/` are out of scope.

## Shell

Shell scripts (`.sh`, `.bash`, `.zsh`, and files with no extension whose first line is a `sh`, `bash`, `zsh` or `dash`
`#!` line) are parsed with the bash grammar of tree-sitter and their command lines read directly. A command is read
wherever it runs (pipelines, conditions, functions, `$(...)`, backticks); `echo "curl ..."`, comments, heredocs and
aliases are text, not commands.

| client | patterns |
|---|---|
| curl | URL (non-option arguments, `--url`), `-X` / `--request`, `-d` / `--data*` / `--json` / `-F` / `--form` (POST unless `-X` or `-G`), `-G` (data in the query), `-I` / `--head` (HEAD), `-T` (PUT), `-H` / `--header`, `-u` / `--user` (basic), `--oauth2-bearer`, `--url-query`, multi-line commands joined by `\` |
| wget | URL, `--method`, `--post-data` / `--post-file` (POST), `--body-data` / `--body-file`, `--header`, `--user` / `--http-user` (basic) |
| HTTPie | `http` / `https [METHOD] URL`, `Header:value`, `name==value` (query), `field=value` / `field:=json` (JSON body), `--form`, `--multipart`, `field@file`, `-a` with `-A bearer` / `basic` |

Values: a variable assigned in the file (`BASE=...`, `export`, `readonly`, `local`, `declare`, arrays) is a constant; a
variable the file does not assign is an env var (`hostKind: "env"`), `${VAR:-https://default}` an env var whose default
gives the host; `$(...)` is a value read at run time, named after the variable it is assigned to. Files a script sources
by a path the scan can read (`source ./config.sh`) give it their top-level values. JSON written in the script (with shell
values spliced in: `'{"text": "'"$MSG"'"}'`) is read as the body's shape, `a=1&b=2` as form data, `-F` fields as
multipart, `-d @file.json` as the JSON file next to the script. A function whose request reads its arguments is reported
at each of its calls in the file with `via: "wrapper:<name>"` (one level), taking the `case` / `if` branch the call's
arguments select. Details: [languages.md](languages.md#shell).
## Rust

Rust files are read through tree-sitter into the shared engine. A file's module is its path in its crate (`src/lib.rs`
and `src/main.rs` are the crate, `src/llm/client.rs` or `src/llm/client/mod.rs` is `<crate>::llm::client`, the crate's
name from the nearest `Cargo.toml`); `crate::`, `self::` and `super::` paths, `use` declarations (aliases, lists,
`self`, globs, `pub use` re-exports) and the crates of a workspace resolve through those names. An inline `mod x { ...
}` is read like a type of its file, so `x::API` and `crate::m::x::API` find its constants and functions. `impl` blocks
give a struct its methods and associated constants (`Self::BASE`), also from another file; `self` reads as the object,
its fields typed by the struct declaration and given values by the project's struct literals (`Self { base_url: u }`
in a constructor, `Settings { .. }` in an `impl Default`).

| client | patterns |
|---|---|
| reqwest (async and `reqwest::blocking`) | `reqwest::get(url)`; a `Client` (`Client::new()`, `Client::builder()...build()?`, a field or parameter of type `Client`, `Arc<Client>`) and its `get` / `post` / `put` / `patch` / `delete` / `head` / `request(Method::POST, url)`, then `header(k, v)`, `headers(map)`, `bearer_auth`, `basic_auth`, `query(&[(k, v)])` (several calls add up), `json(&body)`, `form(&[...])`, `multipart`, `body`, sent by `send()` (or reqwest-eventsource's `eventsource()`) and reported there; steps through variables, `match` / `if` branches (one request: headers only some branches set are optional), fields and the project's functions returning a builder; the client builder's `default_headers(map)` and `user_agent(ua)` are the client's parts (`clientParts`) |
| ureq (2 and 3) | `ureq::get(url)` / `post` / ... and an agent's (`ureq::agent()`, `AgentBuilder::new()...build()`, `Agent::config_builder()...`), `set(k, v)` / `header(k, v)`, `query(k, v)`, `query_pairs(...)`, sent by `call()`, `send_json(body)`, `send_form(&[...])`, `send_string(s)`, `send_bytes(b)`, `send(body)` |
| awc | a client's verb calls, `insert_header((k, v))`, `bearer_auth`, `basic_auth`, `query(&q)`, sent by `send()`, `send_json(&b)`, `send_form(&f)`, `send_body(b)` |
| surf | `surf::get(url)` / `post` / ..., `header`, `body_json` / `body_form` / `body_string`, `query`, sent by `send()` or `recv_json()` / `recv_string()` / `recv_bytes()` (a request only awaited is not read) |
| isahc | `isahc::get(url)`, `isahc::post(url, body)`, `put`, `delete`, `head` and their `_async` forms |

Bodies come from `serde_json::json!({...})` (objects, arrays and literals read from the macro's tokens, Rust code in
it parsed as an expression; keys added afterwards with `body["k"] = v`), `HashMap` / `serde_json::Map` / `HeaderMap`
values filled with `insert`, `HashMap::from([(k, v), ...])`, arrays of `(k, v)` tuples for forms and queries,
`serde_json::to_string` / `to_vec`, and struct literals under the names serde serializes them to (`#[serde(rename =
"...")]`, the container's `rename_all`, `skip` fields left out, `Option<T>` and `skip_serializing_if` fields optional);
the header name constants of the `http` crate (`header::AUTHORIZATION`, `CONTENT_TYPE`) and `Method::POST` are read as
their values, and a literal `Content-Type` header gives a raw body its encoding.

SDK calls are detected through the Rust registries (`src/lang/rust/registry/`): async-openai (`Client::new()`,
`Client::with_config(OpenAIConfig::new().with_api_base(u))` for another OpenAI-compatible provider, a client whose
type is `Client<AzureConfig>` read from its callers; `client.chat().create(request)` and the other resources, the
request built with `CreateChatCompletionRequestArgs::default().model("gpt-4o").messages([...]).build()?` read as the
JSON its setters give, a message builder or `ChatCompletionRequestUserMessage::from(text)` as a message with its role,
a request struct literal as written), openai-api-rs (`OpenAIClient::builder().with_endpoint(u)...build()?`,
`client.chat_completion(ChatCompletionRequest::new(GPT4_O.to_string(), messages))`, the fields set on the request
afterwards, its model constants), teloxide (`Bot::new(token)`, `Bot::from_env()` or a handler's `bot: Bot`;
`bot.send_message(chat_id, text)` and the other Bot API methods, `POST api.telegram.org/bot{token}/sendMessage` with
the positional arguments as the body) and serenity (`msg.channel_id.say(&ctx.http, text)`, `msg.reply(&ctx, text)`,
`ChannelId::new(id).say(...)`: `POST discord.com/api/v10/channels/{channel_id}/messages`) ([sdk-support.md](sdk-support.md)).

Values are resolved through string literals (raw strings too), `const` and `static` items (also of other modules and
crates, of `impl` blocks and inline modules), `format!` with positional, named (`{name}`, `name = v`) and captured
(`{base}`) arguments, `concat!`, `+`, `String::from` / `.to_string()` / `.into()` / `&` / `?` / `.unwrap()` /
`.expect(..)` (the same value), `s.push_str(x)`, `[a, b].join("/")`, `Url::parse(base)?.join(p)`, `std::env::var("X")`
/ `dotenvy::var("X")` / `env!("X")` / `option_env!("X")` with the default of `.unwrap_or("...")` /
`.unwrap_or_else(|_| "...".into())`, `Lazy::new(|| ...)`, `LazyLock`, `lazy_static!`, `match` and `if` values (`Some(x)
=> x` binds `x`), struct fields, function parameters (their callers' values, #39) and closures. `Cargo.toml` is read
(`[dependencies]`, per-target dependencies, `x.workspace = true` against the workspace's `[workspace.dependencies]`;
dev and build dependencies aside), so `coverage.sdks` lists the crates a crate depends on (`ecosystem: "cargo"`).
`target/`, `vendor/`, `tests/`, `benches/`, `build.rs`, `tests.rs` / `*_tests.rs` / `*_test.rs`, `#[cfg(test)]`
modules (inline, or the file a `#[cfg(test)] mod x;` declares) and `#[test]` functions are out of scope.

## How a call is resolved

The pipeline is `detect → resolve → normalize → validate → emit`. Detection and resolution
are per language (TypeScript, JavaScript and HTML scripts through the type checker; Python, PHP, Kotlin, Java and Go
through tree-sitter and a shared engine; shell command lines through tree-sitter, read directly, see
[languages.md](languages.md)); everything
are per language (TypeScript, JavaScript and HTML scripts through the type checker; Python, PHP, Kotlin, Java, Go and
Rust through tree-sitter and a shared engine, see [languages.md](languages.md)); everything
after that is shared, so a call is
described and checked the same way whatever its language. The rules below are given for
TypeScript; Python follows the same ones with its own syntax (f-strings, `%` and `.format()`,
`os.getenv("X", "https://...")`, `os.environ[...]`, dataclass / TypedDict / pydantic bodies).

- **URL**: string and template literals, `+` concatenation, `new URL(path, base)`, same-file
  and imported constants, `as const` config objects, enums, `process.env.X` (with hints
  from `.env.example`), helpers that return a URL (`apiUrl("sendMessage")`, local or imported,
  arguments substituted), `this.baseUrl` set in the constructor, as a parameter property default
  or by a getter, parameter defaults, and `.replace("{id}", id)` on a literal pattern (a regex
  pattern is never run: the string stays as it is). Unresolvable segments become `{name}`
  placeholders and are listed under `dynamic` with their origin (`param`, `call`, `env`,
  `unknown`).
- **Body**: object literals first (literal values become `enum`), spreads merged, computed keys
  flagged, keys set or deleted later in the same function kept (optional when set in a branch,
  [#38](languages.md#keys-added-after-a-dict-is-built-38)), a parameter read as the literals its callers pass
  and its default ([#39](languages.md#a-parameters-values-39)); anything else goes through the checker's declared type. `JSON.stringify`,
  `URLSearchParams`, `FormData`, `qs.stringify` and form-encoded template strings are
  unwrapped. `any` degrades to `dynamic`.
- **Provider**: from the SDK registry, else the host through
  [`src/normalize/providers.json`](../src/normalize/providers.json) (`id`, `name`, `hosts`,
  `packages`; an exact host wins over the longest matching suffix). An env URL with a literal
  default (`process.env.X ?? "https://api.langdock.com/v1"`) keeps `envName` and takes the
  default's host and base path; with no value at all, the env var's name is used
  (`OPENROUTER_BASE_URL` gives `openrouter`). A
  host that still holds a placeholder never becomes a provider: it is `internal` (localhost),
  `env:<NAME>` or `unknown`, except a templated subdomain: of a provider listed by suffix it is
  that provider (`{instance}.my.salesforce.com` is `salesforce`), of any other domain the vendor's
  domain (`{subdomain}.zendesk.com` is `zendesk.com`). `internal` (relative URLs, localhost, a
  path prefix such as `${process.env.NEXT_PUBLIC_BASE_PATH}/api/...`) is the repo's own backend.
  `api-grep providers` prints the table as JSON so other tools can share the same names.
- **Headers**: names only. Literal values are kept unless they look like credentials, and the
  auth scheme is inferred (`Bearer `, `Basic `, `x-api-key`).
- **Wrappers** (up to four deep): a local function or method whose body performs an HTTP call *and*
  whose parameters flow into its request (URL, method, query, body; for an SDK call, the
  arguments its registry reads) is treated as a client. Calls to it are reported at the call
  site with `via: "wrapper:<name>"` and the caller's arguments substituted, including
  `fn.call(this, …)` and destructured `options`. A function that passes its parameters to such a
  wrapper is one too (`latest()` -> `tlsFetch(url)` -> `doFetch(url)` -> `fetch` is reported at
  `latest()` with `via: "wrapper:tlsFetch>doFetch"`). An object argument is followed into its
  properties (`send({ base, path })` reading `call.base + call.path`; in Python and PHP an object
  built in the project: a dataclass, `Call(base=...)`, `new Call(base: ...)`). `reportError(err)` ->
  `Sentry.captureException(err)` is not a client: every caller sends the same request, so only
  the call inside it is reported. A wrapper that sends the same request twice (a retry) gives one
  call per call site; different requests from one call site get distinct `id`s.
- **Host tables**: a base URL picked at run time from a table the code writes is reported once per
  candidate host, each copy with its own `host`, `provider` and `id`, and every candidate listed in
  `hostAlternatives`. A table is an object, dict or map read with a key known at run time only
  (``fetch(`${PROVIDERS[name].baseUrl}/models`)``, `new OpenAI({ baseURL: PROVIDERS[name].baseUrl })`,
  `PROVIDERS[name]["base_url"]`, `PROVIDERS.get(name)`, Go `baseURLs[name]`; `Object.freeze`, `as const` and
  `Record<...>` annotations aside), the element a search of a list returns (`LIST.find((p) => p.key === id)`,
  `Object.values(T).find(...)`, Python `next(d for d in DEFAULTS if d.name == name)` or `[d for d in L if ...][0]`, Rust
  `PROVIDERS.iter().find(|p| ...)`, Kotlin `PROVIDERS.first { ... }`; a list of dataclass, NamedTuple or struct
  instances read by field), one of a helper's several returns (an env var with a default in each:
  `process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT` / `process.env.OPENAI_BASE_URL ?? "https://..."`; a Go `switch`), or
  an arm of a Rust `match` a method returns (`fn base_url(&self) -> &str { match self { ... } }`). The table must be
  the value the call's URL reads: a table shown on a page, or one of paths or models, makes no call. A key the code
  fixes (a literal, a `const`, an enum member, a wrapper's argument) reads its one entry, and a helper given only such
  values (or a condition between them: `baseUrlFor(pass ? "a" : "b")`) is no table: it reads as before, since the
  scan does not tell which return the value selects.
  What the call reads elsewhere from the same entry reads that entry too: a preset pairing a URL with a model gives
  each host its own model (`{ chat: "https://api.deepseek.com/v1", chatModel: "deepseek-chat" }`). An entry the scan
  cannot read a host from is left out; copies that differ by model only are one call naming every model. At most 20
  candidates: a larger table leaves the call as the scan reads it without the table (an unknown host for a table of
  objects, the first entry with a literal host for a table of URLs) and a `host-table-limit` entry in
  `diagnostics.unfollowed`.

## Limitations

- A conditional (`prod ? A : B`) resolves to its first branch when both are static, else to the
  branch with a literal host (`cloud ? "https://api..." : selfHostedUrl`): the other value is not
  listed. A variable assigned in branches reads the same way. A helper with several `return`s, a table and a Rust
  `match` are host tables (above): one call per host.
- Wrapper expansion stops at four wrappers; the definition-site call is still reported and
  deeper call sites are listed in `diagnostics.unfollowed` (`wrapper-depth`).
- Host tables: only the first table a call's URL reads that tells hosts apart is listed (of the first three it meets);
  a table nested in another entry reads as before. A table built by code (a loop filling a map, `dict(zip(...))`, a
  Python `for` returning the matching element, Rust `find_map`), read through a class registry, a factory map of
  clients or a configuration saved and read back (a settings file, a database row), a Kotlin `when` / Java `switch`,
  or a Rust `match` on a variant the code fixes (`Upstream::Groq.base_url()` lists every arm) is not read as one;
  neither are entries spread from another table (`{ ...BASE }`). A helper called with values the code fixes keeps its
  first return with a literal host (a `switch` on its argument is not evaluated).
- `data:` / `blob:` URLs (`canvas.toDataURL()`, `URL.createObjectURL()`) and calls forwarded by
  a `window.fetch = ...` override are not requests and are not reported.
- SDK detection only covers the packages with a registry ([sdk-support.md](sdk-support.md)).
- Python has no type checker: an HTTP client received as an untyped parameter is listed as
  `injected-client` (an SDK client is followed to its callers, `clientFrom`), and SDK methods passed as callbacks (`retry(stripe.Customer.create, ...)`),
  `getattr` calls and module-level configuration (`openai.base_url = ...`) are not followed. See
  [languages.md](languages.md#python) for the full list.
- PHP has no type checker either: untyped properties and parameters used as HTTP clients are listed as
  `injected-client` (SDK clients are followed as in Python); Saloon connectors, Laravel `Mail` / `Storage` drivers and AWS command objects
  are not followed ([languages.md](languages.md#php)).
- Kotlin: the JVM SDKs without a registry ([sdk-support.md](sdk-support.md)) are listed in `coverage.sdks` only;
  Spring AI calls through a shared interface in a project with two model starters and nothing selecting one are not
  listed, rather than guessed ([languages.md](languages.md#kotlin)); a client default header set under a
  condition is listed as always added. The
  Kotlin grammar marks a class body closed on its member's line (`companion object { const val
  X = 1 }`) as an error; such files are repaired before they are read, without moving a position.
  Java: DI-provided clients are followed as in Kotlin; Lombok builders and getters are read from the class's annotations, other annotation
  processors are not run ([languages.md](languages.md#java)).
- Go: interfaces are not followed (a client behind an interface field has no known implementation), nor are generics,
  goroutine channels or values a function returns from several `return`s outside a URL (a URL helper's are a host
  table). Headers set on
  a request outside the function that built it (a helper given `req`) are not read. Resty path parameters
  (`SetPathParam`) stay as placeholders. go-openai's Azure configuration and genai's Vertex AI backend and
  `HTTPOptions.BaseURL` are not modelled. A struct's JSON names come from its `json` tags; a field read through a
  struct literal whose tag renames it (`json:"base_url"`) is not found by its Go name. Package names are the import
  path's last element (a table lists the exceptions: `tgbotapi`, `anthropic`), so a library whose package name differs
  and is imported without an alias is not recognised.
- Shell: nothing is run, so `eval`, `bash -c "..."`, `xargs curl`, heredocs fed to a shell and curl `-K` config files are
  not read; wrapper functions are expanded one level, within their file; a variable assigned in several places reads
  as one of them. Scripts the bash grammar mostly cannot read (zsh-only syntax) are listed as `parse-error`
  ([languages.md](languages.md#shell)).
- Rust: traits are not followed (a client behind `dyn Trait` or a generic `T: Trait` has no known implementation),
  nor are macros other than the ones listed (a `macro_rules!` that builds a request), requests kept in data
  structures and sent by shared code (a `RequestData { url, body }` sent elsewhere), values a function returns from
  several `return`s, or configuration a crate deserializes (`config.url` read from a file: unknown, even with a
  `#[serde(default = "...")]`). A renamed dependency (`openai = { package = "async-openai" }`) is counted under its
  crate but its code name is not matched. async-openai's `AzureConfig` deployment paths, other Anthropic and Gemini
  crates (none dominates: listed in `coverage.sdks` only) and setters chained after a teloxide method
  (`.parse_mode(...)`) are not read; path ids from the gateway (serenity's `channel_id`) stay placeholders.
- HTML: scripts of other template formats (`.vue`, `.svelte`, `.ejs`, `.hbs`) and JavaScript in
  event-handler attributes (`onclick="fetch(...)"`) are not read; classic scripts of one page share
  globals, scripts of different pages do not.
- Twilio and Octokit path parameters that come from the client instance stay as placeholders.
