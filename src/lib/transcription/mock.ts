import type { TranscriptionProvider } from "./types";

export class MockTranscription implements TranscriptionProvider {
  async transcribe() {
    const segments = [
      { start: 0, end: 12, text: "Velkommen til mødet. Vi starter med en status på de seneste måneder." },
      { start: 12, end: 40, text: "Omsætningen er steget otte procent, men likviditeten er presset af lange betalingsfrister." },
      { start: 40, end: 75, text: "Bestyrelsen anbefaler at indføre kortere betalingsvilkår og at ansætte en salgschef inden sommer." },
      { start: 75, end: 90, text: "Vi aftaler at følge op på handlingspunkterne ved næste møde." },
    ];
    return {
      text: segments.map((s) => s.text).join(" "),
      segments,
      language: "da",
    };
  }

  async summarize() {
    return [
      "Resumé (mock)",
      "",
      "Beslutninger:",
      "- Indfør kortere betalingsvilkår over for kunder.",
      "- Start rekruttering af salgschef inden sommer.",
      "",
      "Handlingspunkter:",
      "- Direktionen: udarbejd nye betalingsvilkår (næste møde).",
      "- Rådgiver: send profilbeskrivelse til salgschef.",
    ].join("\n");
  }
}
