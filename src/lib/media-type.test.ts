import { describe, expect, it } from "vitest";
import { detectMediaType } from "./media-type";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  while (out.length < 32) out.push(0);
  return Uint8Array.from(out);
};

describe("magic bytes (L-4/H-5)", () => {
  it("genkender lyd- og videoformater ud fra indholdet", () => {
    expect(detectMediaType(bytes([0, 0, 0, 0x20], "ftypisom"))?.mime).toBe("video/mp4");
    expect(detectMediaType(bytes([0, 0, 0, 0x20], "ftypM4A "))?.mime).toBe("audio/mp4");
    expect(detectMediaType(bytes([0, 0, 0, 0x14], "ftypqt  "))?.ext).toBe("mov");
    expect(detectMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3], "....webm"))?.mime).toBe("video/webm");
    expect(detectMediaType(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))?.mime).toBe("audio/wav");
    expect(detectMediaType(bytes("OggS"))?.mime).toBe("audio/ogg");
    expect(detectMediaType(bytes("fLaC"))?.mime).toBe("audio/flac");
    expect(detectMediaType(bytes("ID3", [4, 0]))?.mime).toBe("audio/mpeg");
    expect(detectMediaType(bytes([0xff, 0xfb, 0x90, 0x64]))?.mime).toBe("audio/mpeg");
    expect(detectMediaType(bytes([0xff, 0xf1, 0x50, 0x80]))?.mime).toBe("audio/aac");
  });

  it("afviser alt andet, også selvom filnavnet/MIME påstår lyd", () => {
    expect(detectMediaType(bytes("%PDF-1.7"))).toBeNull();
    expect(detectMediaType(bytes("MZ", [0x90, 0]))).toBeNull(); // exe
    expect(detectMediaType(bytes("PK", [3, 4]))).toBeNull(); // zip
    expect(detectMediaType(bytes("<html><script>"))).toBeNull();
    expect(detectMediaType(bytes("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
    expect(detectMediaType(Uint8Array.from([0xff, 0xfb]))).toBeNull(); // for kort
  });
});
