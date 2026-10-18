import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbPasswordProblem, scramSha256Verifier } from "./db-roles";

describe("db:roles: adgangskoder og SCRAM-SHA-256", () => {
  it("adgangskoder skal være lange og URL-sikre (de sættes direkte ind i postgresql://-URL'er)", () => {
    expect(dbPasswordProblem("X", "a".repeat(24))).toBeNull();
    expect(dbPasswordProblem("X", "0123456789abcdef0123456789abcdef")).toBeNull();
    expect(dbPasswordProblem("X", "kort")).toMatch(/mindst 24 tegn/);
    expect(dbPasswordProblem("X", "a".repeat(30) + "/")).toMatch(/URL/);
    expect(dbPasswordProblem("X", "a".repeat(30) + "@")).not.toBeNull();
  });

  it("verifikatoren følger RFC 7677 (testvektor: «pencil») og Postgres' format", () => {
    const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
    const v = scramSha256Verifier("pencil", salt, 4096);
    const m = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(v);
    expect(m?.[1]).toBe("W22ZaJ0SNY7soEsUEjb6gQ==");
    const storedKey = Buffer.from(m![2], "base64");
    const serverKey = Buffer.from(m![3], "base64");
    // RFC 7677 afsnit 3: ServerSignature = HMAC(ServerKey, AuthMessage) = v=…, ClientKey = ClientProof XOR ClientSignature
    const authMessage =
      "n=user,r=rOprNGfwEbeRWgbNEkqO," +
      "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096," +
      "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    expect(createHmac("sha256", serverKey).update(authMessage).digest("base64")).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
    const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
    const proof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSignature[i]));
    expect(createHash("sha256").update(clientKey).digest().equals(storedKey)).toBe(true);
    // Nyt tilfældigt salt hver gang
    expect(scramSha256Verifier("pencil")).not.toBe(scramSha256Verifier("pencil"));
  });
});
