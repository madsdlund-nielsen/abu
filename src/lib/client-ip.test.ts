import { describe, expect, it } from "vitest";
import { clientIpFrom, UNKNOWN_IP } from "./client-ip";

describe("klient-IP fra betroet proxy (H-2)", () => {
  it("tager posten hops fra højre, ikke den klientstyrede første", () => {
    // Klienten sender selv "1.2.3.4"; Caddy/nginx tilføjer den rigtige adresse til højre
    expect(clientIpFrom("1.2.3.4, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(clientIpFrom("203.0.113.7", 1)).toBe("203.0.113.7");
    // To proxies (fx CDN + Caddy)
    expect(clientIpFrom("9.9.9.9, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
  });
  it("roterende X-Forwarded-For giver samme IP bag én proxy", () => {
    const ips = ["1.1.1.1", "2.2.2.2", "8.8.8.8"].map((spoof) => clientIpFrom(`${spoof}, 198.51.100.9`, 1));
    expect(new Set(ips)).toEqual(new Set(["198.51.100.9"]));
  });
  it("uden betroet proxy ignoreres headeren", () => {
    expect(clientIpFrom("1.2.3.4", 0)).toBe(UNKNOWN_IP);
    expect(clientIpFrom(null, 1)).toBe(UNKNOWN_IP);
    expect(clientIpFrom("1.2.3.4", 2)).toBe(UNKNOWN_IP); // færre poster end proxies: kan ikke stoles på
    expect(clientIpFrom("evil<script>", 1)).toBe(UNKNOWN_IP);
    expect(clientIpFrom("2001:db8::1", 1)).toBe("2001:db8::1");
  });
});
