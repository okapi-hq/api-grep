import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** The properties of a call's object body. */
const props = (c: Call | undefined): Record<string, unknown> => (c?.body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};

describe("dart: package:http", () => {
  it("reads verb functions, a Client's methods, request objects, Uri.https URLs, env reads and wrappers", async () => {
    const r = await scanFixture("dart/http");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "dart")).toBe(true);
    // a static constant of a class in another file; a JSON body, a Map body sent as a form
    expect(at(r, "auth.dart", 9)).toMatchObject({ client: "dart-http", method: "POST", hostKind: "const", urlTemplate: "https://api.tideplanner.example/v2/auth/sign-in", bodyEncoding: "json" });
    expect(Object.keys(props(at(r, "auth.dart", 9)))).toEqual(["email", "password"]);
    expect(at(r, "auth.dart", 19)).toMatchObject({ pathTemplate: "/v2/auth/register", bodyEncoding: "form" });
    expect(at(r, "auth.dart", 26)).toMatchObject({ method: "GET", authScheme: "bearer", headers: ["authorization"] });
    // a top-level `http.Client()`, `json.encode`, a `String.fromEnvironment` key
    expect(at(r, "chat.dart", 11)).toMatchObject({ provider: "openai", authScheme: "bearer", model: { values: ["gpt-4o-mini"] } });
    // an import without a prefix; `Uri.https(host, path, query)`
    expect(at(r, "weather.dart", 7)).toMatchObject({ urlTemplate: "https://marine.example-weather.org/v1/forecast?harbor={harbor}&days={days}", query: ["harbor", "days"] });
    // `dotenv.env['X'] ?? 'default'`, through a wrapper method
    expect(at(r, "weather.dart", 15)).toMatchObject({ hostKind: "env", envName: "CHARTS_URL", pathTemplate: "/stations/{id}", via: "wrapper:ChartsApi._get" });
    // a MultipartRequest's headers, fields and files; a Request's headers and body
    expect(at(r, "uploads.dart", 8)).toMatchObject({ method: "POST", bodyEncoding: "multipart", authScheme: "bearer" });
    expect(Object.keys(props(at(r, "uploads.dart", 8)))).toEqual(["harbor", "logbook"]);
    expect(at(r, "uploads.dart", 17)).toMatchObject({ method: "PUT", bodyEncoding: "json", headers: ["content-type"] });
  });

  it("reads supabase_flutter: tables, auth, storage and rpc, with the URL of Supabase.initialize", async () => {
    const r = await scanFixture("dart/http");
    const supabase = r.calls.filter((c) => c.provider === "supabase");
    expect(supabase.map((c) => [c.location.line, c.method, c.urlTemplate])).toEqual([
      [15, "GET", "https://tideplanner-demo.supabase.co/rest/v1/logbook_entries"],
      [19, "POST", "https://tideplanner-demo.supabase.co/rest/v1/logbook_entries"],
      [23, "POST", "https://tideplanner-demo.supabase.co/auth/v1/token?grant_type=password"],
      [27, "POST", "https://tideplanner-demo.supabase.co/storage/v1/object/logbook-photos/{path}"],
      [30, "POST", "https://tideplanner-demo.supabase.co/rest/v1/rpc/tide_stats"],
    ]);
    expect(Object.keys(props(at(r, "logbook_store.dart", 23)))).toEqual(["email", "password"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.status])).toEqual([["supabase_flutter", "pub", "ok"]]);
    expect(at(r, "logbook_store.dart", 19).sdk).toMatchObject({ package: "supabase_flutter", version: "^2.5.0" });
  });
});

describe("dart: Dio", () => {
  it("reads BaseOptions, per-call Options, FormData, and the options and interceptors set after the instance is built", async () => {
    const r = await scanFixture("dart/dio");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.client === "dio")).toBe(true);
    expect(at(r, "api_client.dart", 15)).toMatchObject({ method: "GET", urlTemplate: "https://api.parcelhub.example/v1/parcels/{code}", query: ["lang"], authScheme: "bearer" });
    expect(at(r, "api_client.dart", 20).headers).toEqual(["x-request-source", "authorization", "accept"]);
    // `request(path, options: Options(method: 'DELETE'))`
    expect(at(r, "api_client.dart", 27)).toMatchObject({ method: "DELETE" });
    // a constructor's parameter given at the class's one construction, from a Riverpod provider; a get_it lookup
    expect(at(r, "locators.dart", 15)).toMatchObject({ urlTemplate: "https://depots.parcelhub.example/api/depots" });
    expect(at(r, "locators.dart", 27)).toMatchObject({ method: "POST", urlTemplate: "https://routes.parcelhub.example/optimize" });
    expect(at(r, "uploads.dart", 7)).toMatchObject({ bodyEncoding: "multipart" });
    expect(Object.keys(props(at(r, "uploads.dart", 7)))).toEqual(["file", "kind"]);
    // `_dio.options.baseUrl = ...` in the constructor, a default header, two interceptors (one in a branch)
    const couriers = at(r, "courier_service.dart", 23);
    expect(couriers).toMatchObject({ urlTemplate: "https://couriers.parcelhub.example/api/couriers", query: ["active"] });
    expect(couriers.clientParts).toEqual([
      { where: "header", name: "accept-language", from: "default" },
      { where: "header", name: "authorization", from: "interceptor", optional: true },
      { where: "header", name: "x-device", from: "interceptor" },
    ]);
  });
});

describe("dart: a package laid out in lib/", () => {
  it("follows package: and relative imports, barrel exports, parts, other packages of the repository and wrappers", async () => {
    const r = await scanFixture("dart/project", { exclude: [] });
    expect(r.calls.map((c) => `${c.location.file}:${c.location.line} ${c.provider} ${c.method} ${c.urlTemplate}${c.via ? ` (${c.via})` : ""}`)).toEqual([
      "lib/api/notes_repository_helpers.dart:5 notes.fieldnotes.example HEAD https://notes.fieldnotes.example/ping",
      "lib/api/notes_repository.dart:8 notes.fieldnotes.example GET https://notes.fieldnotes.example/api/notes/{id}",
      "lib/main.dart:7 notes.fieldnotes.example GET https://notes.fieldnotes.example/api/notes/welcome (wrapper:NotesRepository.fetch)",
      "lib/main.dart:8 shared.fieldnotes.example GET https://shared.fieldnotes.example/status",
      "tool/seed.dart:7 notes.fieldnotes.example POST https://notes.fieldnotes.example/api/seed",
    ]);
    // a part's function, read from its library through the headers helper
    expect(at(r, "lib/api/notes_repository.dart", 8).headerValues).toEqual({ "x-client": "field-notes" });
    // tests, `.dart_tool/` and generated `*.g.dart` files are out of scope
    expect(r.diagnostics?.languages).toEqual({ dart: { filesSeen: 7, filesScanned: 7 } });
  });
});

describe("dart: SDKs whose requests the native SDKs send", () => {
  const rows = (r: Awaited<ReturnType<typeof scanFixture>>, provider: string): string[] =>
    r.calls.filter((c) => c.provider === provider).map((c) => `${c.location.line} ${c.method} ${c.urlTemplate} ${c.authScheme}`);

  it("reads posthog_flutter with the host set on the config, purchases_flutter and flutter_stripe", async () => {
    const r = await scanFixture("dart/mobile-sdks");
    // `..host = h` on the config given to `setup`; flag reads and `reset` are local
    expect(rows(r, "posthog")).toEqual([12, 14, 17, 18, 19].map((l) => `${l} POST https://eu.i.posthog.com/batch none`).concat("23 POST https://eu.i.posthog.com/flags/?v=2 none"));
    expect(Object.keys(props(at(r, "analytics.dart", 12)))).toEqual(["eventName", "properties"]);
    // `configure`, `logOut` and `getProducts` send nothing the code names
    expect(rows(r, "revenuecat")).toEqual([
      "8 GET https://api.revenuecat.com/v1/subscribers/{app_user_id}/offerings bearer",
      "10 GET https://api.revenuecat.com/v1/subscribers/{app_user_id} bearer",
      "13 POST https://api.revenuecat.com/v1/receipts bearer",
      "17 POST https://api.revenuecat.com/v1/receipts bearer",
      "20 POST https://api.revenuecat.com/v1/receipts bearer",
      "22 POST https://api.revenuecat.com/v1/subscribers/identify bearer",
    ]);
    // the intent id is inside the client secret: a placeholder; `initPaymentSheet` is configuration
    expect(rows(r, "stripe")).toEqual([
      "12 POST https://api.stripe.com/v1/payment_intents/{intent}/confirm bearer",
      "15 POST https://api.stripe.com/v1/payment_methods bearer",
      "17 POST https://api.stripe.com/v1/payment_intents/{intent}/confirm bearer",
      "19 POST https://api.stripe.com/v1/tokens bearer",
      "21 POST https://api.stripe.com/v1/setup_intents/{intent}/confirm bearer",
      "23 GET https://api.stripe.com/v1/payment_intents/{intent} bearer",
      "25 GET https://api.stripe.com/v1/payment_intents/{intent} bearer",
    ]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["flutter_stripe", "ok"], ["posthog_flutter", "ok"], ["purchases_flutter", "ok"]]);
  });

  it("reads a host set on the config variable, and the SetupIntent a payment sheet is given", async () => {
    const r = await scanFixture("dart/mobile-sdks-setup");
    expect(r.calls.map((c) => `${c.location.line} ${c.method} ${c.urlTemplate}`)).toEqual([
      "14 POST https://api.stripe.com/v1/setup_intents/{intent}/confirm",
      "15 POST https://analytics.kilnclub.example/batch",
    ]);
  });
});
