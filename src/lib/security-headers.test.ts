import { describe, expect, it } from "vitest";
import { buildCsp, buildPermissionsPolicy, makeNonce, securityHeaders } from "./security-headers";

const base = { nonce: "abc123", pathname: "/", videoProvider: "whereby", uploadOrigin: null, appOrigin: "https://abu.example.com", production: true, dev: false };

describe("sikkerhedsheaders (M-6)", () => {
  it("CSP: scripts kun med nonce, frame-src kun videoudbyderen", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-src https://*.whereby.com");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("img-src: ingen eksterne billedværter (rådgiverfotos serveres af /api/avatar)", () => {
    expect(buildCsp(base)).toMatch(/img-src 'self' data: blob:;/);
    expect(buildCsp(base)).not.toMatch(/img-src[^;]*https:/);
    // Kun lokalt med http-APP_URL: appens egen origin (logo i e-mail-forhåndsvisning)
    expect(buildCsp({ ...base, appOrigin: "http://localhost:3000", production: false })).toMatch(/img-src 'self' data: blob: http:\/\/localhost:3000;/);
  });

  it("mock-video: frame-src kun 'self'; dev tillader unsafe-eval; direkte upload til S3 i connect-src", () => {
    const csp = buildCsp({ ...base, videoProvider: "mock", production: false, dev: true, uploadOrigin: "https://fsn1.your-objectstorage.com" });
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' https://fsn1.your-objectstorage.com");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("Permissions-Policy åbner kun kamera/mikrofon/skærmdeling på mødesiden", () => {
    expect(buildPermissionsPolicy({ pathname: "/dashboard", videoProvider: "whereby" })).toMatch(/^camera=\(\), microphone=\(\), display-capture=\(\)/);
    expect(buildPermissionsPolicy({ pathname: "/meetings", videoProvider: "whereby" })).toMatch(/camera=\(\)/);
    const meeting = buildPermissionsPolicy({ pathname: "/meetings/cm123", videoProvider: "whereby" });
    expect(meeting).toContain('camera=(self "https://*.whereby.com")');
    expect(meeting).toContain('microphone=(self "https://*.whereby.com")');
    expect(meeting).toContain('display-capture=(self "https://*.whereby.com")');
    expect(buildPermissionsPolicy({ pathname: "/meetings/cm123", videoProvider: "mock" })).toContain("camera=(self)");
    expect(buildPermissionsPolicy({ pathname: "/admin/meetings/cm123", videoProvider: "whereby" })).toMatch(/^camera=\(\)/);
  });

  it("HSTS kun i produktion", () => {
    expect(securityHeaders(base)["Strict-Transport-Security"]).toMatch(/max-age=63072000/);
    expect(securityHeaders({ ...base, production: false })["Strict-Transport-Security"]).toBeUndefined();
  });

  it("nonce er tilfældig og 128 bit", () => {
    const a = makeNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });
});
