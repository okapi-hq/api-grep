import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("java: a mixed Kotlin and Java Android project", () => {
  it("reads both languages into one index, leaves tests out and lists each Maven package once", async () => {
    const r = await scanFixture("java/android", { exclude: [] });
    expect(r).toMatchSnapshot();
    const api = "app/src/main/java/com/example/trips/api/TripsApi.java";
    expect(r.calls.map((c) => [c.location.file.split("/").pop(), c.location.line, c.location.language, c.client, c.provider, c.method, c.pathTemplate])).toEqual([
      ["TripsApi.java", 12, "java", "retrofit", "api.example-trips.com", "GET", "/v1/trips"],
      ["TripsApi.java", 15, "java", "retrofit", "api.example-trips.com", "POST", "/v1/trips"],
      ["TripsRepository.kt", 25, "kotlin", "sdk", "posthog", "POST", "/batch"],
      ["WeatherActivity.java", 20, "java", "sdk", "posthog", "POST", "/batch"],
      ["WeatherActivity.java", 21, "java", "okhttp", "open-meteo", "GET", "/v1/forecast"],
    ]);
    // a Java interface created by a Kotlin Retrofit builder, its base URL from BuildConfig, its query from a Java constant
    expect(at(r, api, 12)).toMatchObject({ urlTemplate: "{env:TRIPS_URL}/v1/trips", queryShape: { properties: { limit: { enum: ["25"] } } } });
    expect(at(r, api, 15).body).toMatchObject({ properties: { destination_code: { type: "string" }, nights: { type: "integer" } }, fromType: "Trip" });
    // a Java class reading a Kotlin object's constant
    expect(at(r, "app/src/main/java/com/example/trips/ui/WeatherActivity.java", 21)).toMatchObject({ query: ["latitude", "longitude"] });
    expect(r.diagnostics).toMatchObject({ filesSeen: 5, filesScanned: 5, skipped: [], languages: { kotlin: { filesSeen: 1, filesScanned: 1 }, java: { filesSeen: 4, filesScanned: 4 } } });
    expect(r.stats.byLanguage).toEqual({ java: 4, kotlin: 1 });
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.status, s.importSites, s.calls])).toEqual([
      ["com.posthog:posthog", "maven", "ok", 2, 2],
      ["io.sentry:sentry-android", "maven", "declared-not-imported", 0, 0],
    ]);
  });

  it("reads only the languages asked for", async () => {
    const java = await scanFixture("java/android", { exclude: [], languages: ["java"] });
    expect(Object.keys(java.diagnostics?.languages ?? {})).toEqual(["java"]);
    expect(java.calls.every((c) => c.location.language === "java")).toBe(true);
    const kotlin = await scanFixture("java/android", { exclude: [], languages: ["kotlin"] });
    expect(Object.keys(kotlin.diagnostics?.languages ?? {})).toEqual(["kotlin"]);
    expect(kotlin.calls.map((c) => c.location.line)).toEqual([25]);
  });
});

describe("java: HTTP clients", () => {
  it("reads OkHttp request builders, bodies, URL builders and interceptors (classes, lambdas, anonymous classes)", async () => {
    const r = await scanFixture("java/okhttp");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "java" && c.client === "okhttp")).toBe(true);
    expect(at(r, "Interceptors.java", 38)).toMatchObject({ query: ["city", "apikey"], authScheme: "apikey", clientParts: [{ where: "query", name: "apikey", from: "interceptor" }] });
    expect(at(r, "Interceptors.java", 43)).toMatchObject({ headers: ["authorization"], authScheme: "bearer" });
    expect(at(r, "Interceptors.java", 53)).toMatchObject({ method: "DELETE", pathTemplate: "/user/starred/{owner}/{repo}", headerValues: { "x-github-api-version": "2022-11-28" } });
    expect(at(r, "Messages.java", 31)).toMatchObject({ bodyEncoding: "form", body: { properties: { to: { type: "string" }, text: { type: "string" } } } });
    expect(at(r, "Messages.java", 36)).toMatchObject({ bodyEncoding: "multipart", body: { properties: { upload_preset: { enum: ["avatars"] } } } });
    expect(at(r, "Messages.java", 46)).toMatchObject({ provider: "unsplash", pathTemplate: "/search/photos", query: ["query"], via: "wrapper:Messages.execute" });
    // a request made by a method of the class, and a copy of a request with one more header
    expect(at(r, "Podcasts.java", 17)).toMatchObject({ pathTemplate: "/v1/search", query: ["q"], headers: ["x-auth-key"] });
    expect(at(r, "Podcasts.java", 34)).toMatchObject({ method: "POST", pathTemplate: "/v1/login", headers: ["authorization"] });
    expect(at(r, "Messages.java", 59)).toMatchObject({ bodyEncoding: "json", body: { properties: { method: { enum: ["getBalance"] }, address: { type: "string" } } }, headers: ["x-api-key"] });
  });

  it("reads java.net.http requests and HttpURLConnection with what is written to its output stream", async () => {
    const r = await scanFixture("java/java-http");
    expect(r).toMatchSnapshot();
    expect(r.calls.map((c) => [c.location.line, c.method, c.pathTemplate])).toEqual([
      [28, "POST", "/v1/items"],
      [37, "GET", "/incidents"],
      [44, "PUT", "/incidents/{id}"],
      [51, "POST", "/v2/enqueue"],
      [62, "POST", "/v1/ping"],
      [71, "GET", "/v1/status"],
    ]);
    expect(at(r, "Notifier.java", 51)).toMatchObject({ headers: ["content-type"], body: { type: "string" } });
    expect(at(r, "Notifier.java", 62).body).toMatchObject({ type: "string" });
  });

});

describe("java: Spring, Feign and Retrofit", () => {
  it("reads RestTemplate, RestClient and WebClient, and leaves server endpoints out", async () => {
    const r = await scanFixture("java/spring");
    expect(r).toMatchSnapshot();
    expect(at(r, "Payments.java", 42)).toMatchObject({ method: "POST", authScheme: "bearer", headers: ["authorization", "content-type"], body: { fromType: "Item" } });
    expect(at(r, "Payments.java", 48)).toMatchObject({ provider: "stripe", bodyEncoding: "form" });
    expect(at(r, "Payments.java", 56)).toMatchObject({ pathTemplate: "/v1/search", query: ["q"] });
    // a HashMap filled entry by entry
    expect(at(r, "Payments.java", 63).body).toMatchObject({ properties: { sku: { type: "string" }, currency: { enum: ["EUR"] } } });
    expect(at(r, "Payments.java", 86)).toMatchObject({ client: "spring-webclient", query: ["expand"], bodyEncoding: "form", authScheme: "bearer" });
    expect(at(r, "Payments.java", 98)).toMatchObject({ authScheme: "basic" });
    expect(r.calls.some((c) => c.location.line > 100)).toBe(false);
  });

  it("reports each mapped method of a Feign interface at its declaration", async () => {
    const r = await scanFixture("java/feign");
    expect(r).toMatchSnapshot();
    expect(at(r, "Clients.java", 31)).toMatchObject({ urlTemplate: "{env:orders.url}/v2/orders", query: ["dryRun"], headers: ["idempotency-key"], body: { fromType: "Order" } });
    expect(at(r, "Clients.java", 34)).toMatchObject({ method: "DELETE" });
    expect(at(r, "Clients.java", 37)).toMatchObject({ query: ["status", "page"] });
    expect(at(r, "Clients.java", 46)).toMatchObject({ provider: "github", headers: ["accept", "content-type"] });
  });

  it("reports each Retrofit method with the base URL, client and converter of the builder that creates the interface", async () => {
    const r = await scanFixture("java/retrofit");
    expect(r).toMatchSnapshot();
    expect(at(r, "BookApi.java", 24)).toMatchObject({ urlTemplate: "https://api.example-books.com/v2/books", queryShape: { properties: { page: { enum: [1] }, size: { enum: [20] } } } });
    expect(at(r, "BookApi.java", 30)).toMatchObject({ headers: ["accept", "x-client", "authorization", "x-api-key"], body: { properties: { star_rating: { type: "integer" } } } });
    expect(at(r, "BookApi.java", 34)).toMatchObject({ bodyEncoding: "form", body: { properties: { grant_type: { type: "string" } } } });
    expect(at(r, "BookApi.java", 38)).toMatchObject({ bodyEncoding: "multipart" });
    expect(at(r, "BookApi.java", 24).clientParts).toEqual([{ where: "header", name: "x-api-key", from: "interceptor" }]);
  });
});

describe("java: SDK registries", () => {
  it("reads JVM SDK clients, builders as bodies and enum models, and Maven coverage from pom.xml", async () => {
    const r = await scanFixture("java/sdk");
    expect(r).toMatchSnapshot();
    expect(at(r, "Chat.java", 25)).toMatchObject({ provider: "openai", model: { values: ["gpt-4.1-mini"] }, body: { properties: { max_completion_tokens: { enum: [300] } } } });
    expect(at(r, "Chat.java", 29)).toMatchObject({ provider: "anthropic", model: { values: ["claude-sonnet-4-5"] } });
    expect(at(r, "Billing.java", 32).body).toMatchObject({ properties: { amount: { type: "integer" }, currency: { enum: ["eur"] }, customer: { type: "string" } } });
    expect(at(r, "Billing.java", 42)).toMatchObject({ provider: "aws", method: "PUT", pathTemplate: "/{Bucket}/{Key}" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["com.anthropic:anthropic-java", "ok"],
      ["com.openai:openai-java", "ok"],
      ["com.stripe:stripe-java", "ok"],
      ["com.twilio.sdk:twilio", "declared-not-imported"],
      ["software.amazon.awssdk:s3", "ok"],
    ]);
  });
});
