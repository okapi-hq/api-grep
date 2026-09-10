import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: "eu-west-1" });

export async function put(key: string, body: Buffer) {
  await s3.send(new PutObjectCommand({ Bucket: "my-bucket", Key: key, Body: body, ContentType: "image/png" }));
}

export async function get(key: string) {
  const cmd = new GetObjectCommand({ Bucket: process.env.BUCKET, Key: key });
  return s3.send(cmd);
}
