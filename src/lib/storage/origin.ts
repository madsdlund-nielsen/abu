/**
 * Origin, som browseren uploader direkte til (presigned POST) – til CSP'ens connect-src og bucketens CORS-regel.
 * Path-style: endpointets origin. Virtual-hosted: `<bucket>.<endpoint-host>`.
 */
export function directUploadOrigin(cfg: { endpoint: string; bucket: string; forcePathStyle: boolean }): string | null {
  try {
    const u = new URL(cfg.endpoint);
    if (!cfg.forcePathStyle && cfg.bucket) u.hostname = `${cfg.bucket}.${u.hostname}`;
    return u.origin;
  } catch {
    return null;
  }
}
