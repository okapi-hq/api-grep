import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("google-auth-oauthlib", () => {
  const oauth = scanFixture("python/sdk/oauthlib");

  it("reports a flow's token exchange at the token_uri of its client configuration", async () => {
    const r = await oauth;
    const token = { provider: "google", method: "POST", authScheme: "basic", sdk: { package: "google-auth-oauthlib" } };
    // a client secrets file of the repository, by its literal path
    expect(at(r, "desktop.py", 18)).toMatchObject({ ...token, urlTemplate: "https://oauth2.googleapis.com/token", sdk: { chain: "run_local_server" } });
    // a configuration dict of the code
    expect(at(r, "desktop.py", 23)).toMatchObject({ ...token, urlTemplate: "https://accounts.google.com/o/oauth2/token", sdk: { chain: "run_console" } });
    // get_user_credentials writes Google's token endpoint into its own configuration
    expect(at(r, "desktop.py", 27)).toMatchObject({ ...token, urlTemplate: "https://oauth2.googleapis.com/token" });
    // a secrets file named at run time: the library has no default endpoint, so the host stays unknown
    expect(at(r, "web.py", 17)).toMatchObject({ ...token, host: "{tokenEndpoint}", sdk: { chain: "fetch_token" } });
  });

  it("leaves authorization_url() out: it only builds the URL a browser opens", async () => {
    const r = await oauth;
    expect(r.calls.map((c) => `${c.location.file}:${c.location.line}`)).toEqual(["desktop.py:18", "desktop.py:23", "desktop.py:27", "web.py:17"]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["google-auth-oauthlib", "ok"]]);
  });
});

describe("aiobotocore, botocore and aioboto3", () => {
  it("reads their clients with boto3's operations, each call naming its own package", async () => {
    const r = await scanFixture("python/sdk-aws-botocore");
    expect(at(r, "archive.py", 9)).toMatchObject({ provider: "aws", method: "PUT", host: "s3.{region}.amazonaws.com", pathTemplate: "/{Bucket}/{Key}", operationId: "PutObject", sdk: { package: "aiobotocore", chain: "put_object" } });
    expect(at(r, "archive.py", 10)).toMatchObject({ method: "GET", operationId: "GetObject" });
    // a client entered through an AsyncExitStack
    expect(at(r, "archive.py", 16)).toMatchObject({ host: "dynamodb.{region}.amazonaws.com", operationId: "PutItem", sdk: { package: "aiobotocore" } });
    // endpoint_url replaces the host
    expect(at(r, "archive.py", 22)).toMatchObject({ host: "localhost:9000", pathTemplate: "/{Bucket}/{Key}" });
    expect(at(r, "queue.py", 8)).toMatchObject({ host: "sqs.{region}.amazonaws.com", operationId: "SendMessage", sdk: { package: "botocore" } });
    expect(at(r, "queue.py", 15)).toMatchObject({ host: "email.{region}.amazonaws.com", operationId: "SendEmail", bodyEncoding: "form", sdk: { package: "botocore" } });
    expect(at(r, "thumbs.py", 7)).toMatchObject({ operationId: "PutObject", sdk: { package: "aioboto3" } });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["aioboto3", "ok"],
      ["aiobotocore", "ok"],
      ["botocore", "ok"],
    ]);
  });
});
