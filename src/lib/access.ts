import type { Role } from "@prisma/client";

export function canAccessMeeting(
  user: { id: string; role: Role },
  participantIds: string[],
): boolean {
  return user.role === "ADMIN" || participantIds.includes(user.id);
}
