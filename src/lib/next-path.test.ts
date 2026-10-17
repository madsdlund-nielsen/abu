import { describe, expect, it } from "vitest";
import { loginUrlFor, safeNextPath } from "./consent";

describe("next efter login (plan #21)", () => {
  it("bevarer interne dybe links med forespørgsel", () => {
    expect(safeNextPath("/meetings/cm123")).toBe("/meetings/cm123");
    expect(safeNextPath("/book?uge=2026-11-02")).toBe("/book?uge=2026-11-02");
    expect(loginUrlFor("/meetings/cm123")).toBe("/login?next=%2Fmeetings%2Fcm123");
    expect(loginUrlFor("/")).toBe("/login");
    expect(loginUrlFor(null)).toBe("/login");
  });
  it("afviser open redirects og løkker", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil", "/%0d%0aSet-Cookie:x", "/x\nLocation: //evil", "javascript:alert(1)", "evil", "/login?next=/admin", "/api/account/export", ""]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
    // Procent-kodede tegn er stadig en lokal sti
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
    expect(safeNextPath("/" + "a".repeat(3000))).toBeNull();
  });
});
