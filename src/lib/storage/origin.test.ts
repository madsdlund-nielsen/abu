import { describe, expect, it } from "vitest";
import { directUploadOrigin } from "./origin";

describe("origin for direkte upload (CSP connect-src / CORS)", () => {
  it("path-style bruger endpointet, virtual-hosted bucket-subdomænet", () => {
    expect(directUploadOrigin({ endpoint: "https://fsn1.your-objectstorage.com", bucket: "abu-prod", forcePathStyle: true })).toBe("https://fsn1.your-objectstorage.com");
    expect(directUploadOrigin({ endpoint: "https://fsn1.your-objectstorage.com/", bucket: "abu-prod", forcePathStyle: false })).toBe("https://abu-prod.fsn1.your-objectstorage.com");
    expect(directUploadOrigin({ endpoint: "", bucket: "x", forcePathStyle: true })).toBeNull();
  });
});
