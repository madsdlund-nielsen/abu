import { getEnv } from "../env";
import { MistralTranscription } from "./mistral";
import { MockTranscription } from "./mock";
import type { TranscriptionProvider } from "./types";

let provider: TranscriptionProvider | null = null;

export function getTranscriber(): TranscriptionProvider {
  if (!provider) {
    provider = getEnv().TRANSCRIPTION_PROVIDER === "mistral" ? new MistralTranscription() : new MockTranscription();
  }
  return provider;
}
