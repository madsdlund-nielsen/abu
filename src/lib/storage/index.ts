import { getEnv } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { StorageProvider } from "./types";

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!provider) {
    const env = getEnv();
    provider =
      env.STORAGE_PROVIDER === "s3"
        ? new S3Storage({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          })
        : new LocalStorage(env.UPLOAD_DIR);
  }
  return provider;
}
