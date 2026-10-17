/**
 * Genkendelse af lyd-/videofiler ud fra filens første bytes ("magic bytes"), ikke browserens påståede MIME-type (L-4).
 * Kun formater, transskriberingen kan læse, accepteres; alt andet (også application/octet-stream) afvises.
 */
export interface MediaType {
  mime: string;
  ext: string;
  label: string;
}

/** Antal bytes, der skal læses fra filens start for at genkende formatet. */
export const MEDIA_SNIFF_BYTES = 64;
/** Største tilladte optagelse (ca. 2 timers video i god kvalitet). */
export const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));

export function detectMediaType(bytes: Uint8Array): MediaType | null {
  const b = bytes;
  if (b.length < 12) return null;
  // ISO BMFF (MP4/M4A/MOV/3GP): "ftyp" ved offset 4
  if (ascii(b, 4, "ftyp")) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^M4A |^M4B /.test(brand)) return { mime: "audio/mp4", ext: "m4a", label: "M4A" };
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", label: "MOV" };
    if (brand.startsWith("3g")) return { mime: "video/3gpp", ext: "3gp", label: "3GP" };
    return { mime: "video/mp4", ext: "mp4", label: "MP4" };
  }
  // Matroska/WebM: EBML-header 1A 45 DF A3
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = Buffer.from(b).toString("latin1");
    return head.includes("webm") ? { mime: "video/webm", ext: "webm", label: "WebM" } : { mime: "video/x-matroska", ext: "mkv", label: "MKV" };
  }
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return { mime: "audio/wav", ext: "wav", label: "WAV" };
  if (ascii(b, 0, "OggS")) return { mime: "audio/ogg", ext: "ogg", label: "Ogg" };
  if (ascii(b, 0, "fLaC")) return { mime: "audio/flac", ext: "flac", label: "FLAC" };
  if (ascii(b, 0, "ID3")) return { mime: "audio/mpeg", ext: "mp3", label: "MP3" };
  if (ascii(b, 0, "#!AMR")) return { mime: "audio/amr", ext: "amr", label: "AMR" };
  // MPEG-ramme uden ID3 (MP3) eller ADTS (AAC): 11 sync-bits
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const layer = (b[1] >> 1) & 0x03;
    if (layer === 0) return { mime: "audio/aac", ext: "aac", label: "AAC" };
    return { mime: "audio/mpeg", ext: "mp3", label: "MP3" };
  }
  return null;
}

export const ACCEPTED_FORMATS = "MP3, M4A, MP4, MOV, WebM, MKV, WAV, Ogg, FLAC, AAC";
