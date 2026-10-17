import { getEnv } from "../env";
import type { TranscriptSegment, TranscriptionProvider, TranscriptionResult } from "./types";

const SUMMARY_PROMPT = `Du er referent for et rådgivende bestyrelsesmøde. Skriv et kort, struktureret resumé på dansk af transskriptionen.
Brug præcis disse overskrifter: "Hovedpunkter", "Beslutninger", "Handlingspunkter" (med ansvarlig hvis nævnt).
Opfind ikke noget, der ikke står i transskriptionen.`;

export class MistralTranscription implements TranscriptionProvider {
  private get env() {
    return getEnv();
  }

  private headers() {
    return { Authorization: `Bearer ${this.env.MISTRAL_API_KEY}` };
  }

  async transcribe(file: Buffer, mime: string, filename = "recording"): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("model", this.env.MISTRAL_TRANSCRIPTION_MODEL);
    form.append("language", "da");
    form.append("timestamp_granularities", "segment");
    form.append("file", new Blob([new Uint8Array(file)], { type: mime }), filename);

    const res = await fetch(`${this.env.MISTRAL_API_URL}/audio/transcriptions`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) throw new Error(`Mistral transskription fejlede (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as {
      text?: string;
      language?: string | null;
      segments?: { start: number; end: number; text: string }[];
    };
    const segments: TranscriptSegment[] = (json.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));
    return { text: json.text ?? segments.map((s) => s.text).join(" "), segments, language: json.language ?? "da" };
  }

  async summarize(text: string): Promise<string> {
    const res = await fetch(`${this.env.MISTRAL_API_URL}/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.env.MISTRAL_SUMMARY_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Mistral resumé fejlede (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
}
