import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
let client: S3Client | null = null;
function s3() {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) return null;
  client ??= new S3Client({ region: process.env.S3_REGION || "auto", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.S3_ENDPOINT), credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  return client;
}
/** Offline mode: when LOCAL_STORAGE_DIR is set (desktop app) originals are kept on this PC's disk. */
function localPath(key: string) {
  const root = process.env.LOCAL_STORAGE_DIR; if (!root) return null;
  const base = path.resolve(root); const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Invalid storage key");
  return full;
}
export async function storeObject(key: string, body: Buffer, contentType: string) {
  const bucket = process.env.S3_BUCKET; const api = s3();
  if (bucket && api) { await api.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })); return key; }
  const file = localPath(key); if (!file) return null;
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); return key;
}
export async function readObject(key: string) {
  const api = s3();
  if (api && process.env.S3_BUCKET) {
    const result = await api.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    if (!result.Body) throw new Error("Stored object has no body");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  const file = localPath(key); if (!file) throw new Error("Object storage is not configured");
  return fs.readFile(file);
}
export async function deleteObject(key: string) {
  const api = s3();
  if (api && process.env.S3_BUCKET) { await api.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })); return; }
  const file = localPath(key); if (file) await fs.rm(file, { force: true });
}
