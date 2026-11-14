import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";

let client: S3Client | null = null;

/** Neon Object Storage uses AWS-compatible names; legacy S3_* names remain supported. */
function storageConfig() {
  return {
    bucket: process.env.S3_BUCKET,
    endpoint: process.env.AWS_ENDPOINT_URL_S3 || process.env.S3_ENDPOINT || undefined,
    region: process.env.AWS_REGION || process.env.S3_REGION || "auto",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY
  };
}

function s3() {
  const config = storageConfig();
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) return null;
  client ??= new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });
  return client;
}

/** Offline mode: when LOCAL_STORAGE_DIR is set (desktop app) originals are kept on this PC's disk. */
function localPath(key: string) {
  const root = process.env.LOCAL_STORAGE_DIR;
  if (!root) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Invalid storage key");
  return full;
}

function requireProductionObjectStorage() {
  const config = storageConfig();
  if (process.env.NODE_ENV === "production" && (!config.bucket || !config.accessKeyId || !config.secretAccessKey || !config.endpoint)) {
    throw new Error("Shared object storage is not configured. Set S3_BUCKET, AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or the supported S3_* equivalents) before uploading or restoring original files.");
  }
}

export async function storeObject(key: string, body: Buffer, contentType: string) {
  requireProductionObjectStorage();
  const config = storageConfig();
  const api = s3();
  if (config.bucket && api) {
    await api.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }
  const file = localPath(key);
  if (!file) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return key;
}

export async function readObject(key: string) {
  requireProductionObjectStorage();
  const config = storageConfig();
  const api = s3();
  if (api && config.bucket) {
    const result = await api.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    if (!result.Body) throw new Error("Stored object has no body");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  const file = localPath(key);
  if (!file) throw new Error("Object storage is not configured");
  return fs.readFile(file);
}

export async function deleteObject(key: string) {
  requireProductionObjectStorage();
  const config = storageConfig();
  const api = s3();
  if (api && config.bucket) {
    await api.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return;
  }
  const file = localPath(key);
  if (file) await fs.rm(file, { force: true });
}
