import { randomBytes } from "node:crypto";
import type { CreateRoomInput, CreatedRoom, RecordingEvent, VideoProvider } from "./types";

export const MOCK_ROOM_PREFIX = "mock://room/";

export class MockVideo implements VideoProvider {
  readonly name = "mock" as const;

  async createMeeting(_input: CreateRoomInput): Promise<CreatedRoom> {
    void _input;
    const id = randomBytes(6).toString("hex");
    return {
      roomUrl: `${MOCK_ROOM_PREFIX}${id}`,
      hostRoomUrl: `${MOCK_ROOM_PREFIX}${id}?host`,
      providerMeetingId: `mock-${id}`,
    };
  }

  async deleteMeeting() {}

  parseWebhook(): RecordingEvent | null {
    return null;
  }
}
