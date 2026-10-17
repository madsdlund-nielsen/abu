import { getEnv } from "../env";
import { MockVideo } from "./mock";
import type { VideoProvider } from "./types";
import { WherebyVideo } from "./whereby";

let provider: VideoProvider | null = null;

export function getVideo(): VideoProvider {
  if (!provider) provider = getEnv().VIDEO_PROVIDER === "whereby" ? new WherebyVideo() : new MockVideo();
  return provider;
}
