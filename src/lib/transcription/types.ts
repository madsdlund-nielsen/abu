export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  language: string;
}

export interface TranscriptionProvider {
  /** `file` er en Blob, der læses fra disk ved afsendelse (ingen fuld kopi i hukommelsen). */
  transcribe(file: Blob, mime: string, filename?: string): Promise<TranscriptionResult>;
  summarize(text: string): Promise<string>;
}
