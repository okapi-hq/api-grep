import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("kotlin: the AWS SDK for Kotlin and more AWS SDK for Java 2.x services (#49)", () => {
  it("reads requests built by lambdas that assign properties, configuration lambdas and nested builders", async () => {
    const r = await scanFixture("kotlin/sdk/aws");
    expect(r.calls.every((c) => c.client === "sdk" && c.location.language === "kotlin")).toBe(true);
    // a request object built by a lambda, sent from `use { ddb -> ... }` on a client built by `fromEnvironment { ... }`
    expect(at(r, "Orders.kt", 29)).toMatchObject({
      provider: "aws",
      host: "dynamodb.{region}.amazonaws.com",
      method: "POST",
      pathTemplate: "/",
      operationId: "PutItem",
      sdk: { package: "aws.sdk.kotlin:dynamodb", version: "1.5.40", chain: "putItem" },
      body: { properties: { TableName: { enum: ["shop-orders"] }, Item: { required: ["id", "total"] } } },
    });
    expect(at(r, "Orders.kt", 34)).toMatchObject({ operationId: "GetItem", body: { properties: { TableName: { enum: ["shop-orders"] }, Key: { type: "object" } } } });
    // the method's own lambda; SQS speaks JSON
    expect(at(r, "Orders.kt", 38)).toMatchObject({ host: "sqs.{region}.amazonaws.com", operationId: "SendMessage", bodyEncoding: "json", body: { properties: { QueueUrl: { type: "string" }, DelaySeconds: { enum: [5] } } } });
    // `endpointUrl` of the client's configuration lambda; `this.key = key` is the request's
    expect(at(r, "Orders.kt", 46)).toMatchObject({ method: "PUT", pathTemplate: "/{Bucket}/{Key}", envName: "S3_ENDPOINT", body: { properties: { Bucket: { enum: ["shop-archive"] }, Key: { type: "string" } } } });
    // SNS speaks the Query protocol: the action in the query, the members as a form
    expect(at(r, "Orders.kt", 50)).toMatchObject({ urlTemplate: "https://sns.{region}.amazonaws.com/?Action=Publish", bodyEncoding: "form", body: { properties: { TopicArn: { type: "string" }, Message: { type: "string" } } } });
    expect(at(r, "Summaries.kt", 20)).toMatchObject({
      provider: "aws-bedrock",
      pathTemplate: "/model/{modelId}/converse",
      model: { values: ["anthropic.claude-3-haiku-20240307-v1:0"] },
      body: { properties: { messages: { type: "array" }, inferenceConfig: { properties: { maxTokens: { enum: [512] }, temperature: { enum: [0.2] } } } } },
    });
  });

  it("reads SES, SES v2, typed SNS clients and the S3 Transfer Manager; a presigner sends nothing", async () => {
    const r = await scanFixture("kotlin/sdk/aws");
    expect(at(r, "Mailer.kt", 19)).toMatchObject({ sdk: { package: "software.amazon.awssdk:sns" }, operationId: "Publish", body: { properties: { TopicArn: { type: "string" } } } });
    // nested lambdas fill nested members
    expect(at(r, "Mailer.kt", 21)).toMatchObject({ host: "email.{region}.amazonaws.com", urlTemplate: "https://email.{region}.amazonaws.com/?Action=SendEmail", body: { properties: { Source: { enum: ["hello@example.com"] }, Destination: { properties: { ToAddresses: { type: "string" } } } } } });
    expect(at(r, "Mailer.kt", 23)).toMatchObject({ pathTemplate: "/v2/email/outbound-emails", bodyEncoding: "json", body: { properties: { FromEmailAddress: { enum: ["billing@example.com"] } } } });
    expect(at(r, "Mailer.kt", 25)).toMatchObject({ method: "GET", pathTemplate: "/v2/email/identities/{EmailIdentity}" });
    // the S3 request the transfer wraps is the body
    expect(at(r, "Mailer.kt", 28)).toMatchObject({ method: "PUT", pathTemplate: "/{Bucket}/{Key}", operationId: "PutObject", body: { properties: { Bucket: { enum: ["shop-media"] }, Key: { type: "string" } } } });
    expect(r.calls.some((c) => c.location.file === "Mailer.kt" && c.location.line === 31)).toBe(false);
  });
});

describe("java: more AWS SDK for Java 2.x services and the AWS SDK for Java 1.x (#49)", () => {
  it("reads DynamoDB, the enhanced client, SQS, and S3 v1 positional arguments", async () => {
    const r = await scanFixture("java/aws");
    expect(at(r, "Inventory.java", 25)).toMatchObject({
      operationId: "PutItem",
      body: { properties: { TableName: { enum: ["warehouse-stock"] }, Item: { properties: { sku: { properties: { S: { type: "string" } } } } } } },
    });
    expect(at(r, "Inventory.java", 32)).toMatchObject({ operationId: "Query", body: { properties: { KeyConditionExpression: { enum: ["sku = :sku"] } } } });
    // the enhanced client's table, held in a field: the operation, not the mapped item
    expect(at(r, "Inventory.java", 36)).toMatchObject({ sdk: { package: "software.amazon.awssdk:dynamodb-enhanced", chain: "table.putItem" }, operationId: "PutItem", bodyEncoding: "none" });
    expect(at(r, "Inventory.java", 40)).toMatchObject({ operationId: "GetItem" });
    expect(at(r, "Dispatch.java", 23)).toMatchObject({ operationId: "SendMessage", body: { properties: { QueueUrl: { type: "string" }, DelaySeconds: { enum: [10] } } } });
    // v1: the bucket and key are positional arguments
    expect(at(r, "Dispatch.java", 31)).toMatchObject({ sdk: { package: "com.amazonaws:aws-java-sdk-s3", version: "1.12.780" }, method: "PUT", pathTemplate: "/{Bucket}/{Key}", dynamic: [{ where: "path", name: "Key" }] });
    expect(at(r, "Dispatch.java", 35)).toMatchObject({ method: "GET", operationId: "GetObject" });
    expect(at(r, "Dispatch.java", 40)).toMatchObject({ method: "PUT", sdk: { chain: "upload" } });
    // `generatePresignedUrl` signs locally
    expect(r.calls.some((c) => c.location.file === "Dispatch.java" && c.location.line === 45)).toBe(false);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status, s.calls])).toEqual([
      ["com.amazonaws:aws-java-sdk-s3", "ok", 3],
      ["software.amazon.awssdk:dynamodb", "ok", 3],
      ["software.amazon.awssdk:dynamodb-enhanced", "ok", 2],
      ["software.amazon.awssdk:sqs", "ok", 2],
    ]);
  });
});
