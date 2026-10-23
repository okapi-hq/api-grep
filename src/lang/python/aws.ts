import type { IrRegistryEntry } from "../ir/language.js";
import boto3Bedrock from "./registry/boto3-bedrock.json" with { type: "json" };
import boto3DynamoDb from "./registry/boto3-dynamodb.json" with { type: "json" };
import boto3S3 from "./registry/boto3-s3.json" with { type: "json" };
import boto3Ses from "./registry/boto3-ses.json" with { type: "json" };
import boto3SesV2 from "./registry/boto3-sesv2.json" with { type: "json" };
import boto3Sns from "./registry/boto3-sns.json" with { type: "json" };
import boto3Sqs from "./registry/boto3-sqs.json" with { type: "json" };

const BOTO3 = [boto3S3, boto3Bedrock, boto3DynamoDb, boto3Ses, boto3SesV2, boto3Sqs, boto3Sns] as unknown as IrRegistryEntry[];

/**
 * The clients of aiobotocore and botocore are boto3's (boto3 builds its clients with botocore): the same operations
 * under the same names, built by `session.create_client("s3", endpoint_url=...)` on a session from `get_session()` or
 * the session class (aiobotocore's as an async context manager: `async with ... as client`). aioboto3's `Session` is
 * boto3's. Each is an entry of its own so that a call names the package the code uses.
 */
const VARIANTS: { package: string; imports: string[]; sessions?: string[] }[] = [
  { package: "aioboto3", imports: ["aioboto3"] },
  { package: "aiobotocore", imports: ["aiobotocore"], sessions: ["session.get_session", "session.AioSession"] },
  { package: "botocore", imports: ["botocore"], sessions: ["session.get_session", "session.Session"] },
];

function variant(entry: IrRegistryEntry, v: (typeof VARIANTS)[number]): IrRegistryEntry {
  if (!v.sessions) return { ...entry, package: v.package, imports: v.imports };
  const names = v.sessions.map((s) => `${s}.create_client`);
  const urlArg = Object.fromEntries(names.map((n) => [n, "kw:endpoint_url|5"]));
  return { ...entry, package: v.package, imports: v.imports, instance: { ...entry.instance, names, urlArg } };
}

/** boto3's registries, then the same services for each package whose clients are boto3's. */
export const AWS_REGISTRY: IrRegistryEntry[] = [...BOTO3, ...VARIANTS.flatMap((v) => BOTO3.map((e) => variant(e, v)))];
