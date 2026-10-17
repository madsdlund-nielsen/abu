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
  transcribe(file: Buffer, mime: string, filename?: string): Promise<TranscriptionResult>;
  summarize(text: string): Promise<string>;
}
