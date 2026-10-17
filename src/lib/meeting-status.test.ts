import { describe, expect, it } from "vitest";
import { ADVISOR_BLOCKING_STATUSES, recordingUploadDecision, shouldMarkCompleted, statusAfterTranscription } from "./meeting-status";

const now = new Date("2026-10-17T10:00:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

describe("recordingUploadDecision", () => {
  it("afviser upload før mødet er startet", () => {
    const d = recordingUploadDecision({ status: "BOOKED", startsAt: h(1) }, now);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/startet/);
  });
  it("tillader upload præcis ved start og under/efter mødet", () => {
    expect(recordingUploadDecision({ status: "BOOKED", startsAt: now }, now).allowed).toBe(true);
    expect(recordingUploadDecision({ status: "BOOKED", startsAt: h(-1) }, now).allowed).toBe(true);
    expect(recordingUploadDecision({ status: "COMPLETED", startsAt: h(-24) }, now).allowed).toBe(true);
  });
  it("afviser upload på aflyste møder", () => {
    expect(recordingUploadDecision({ status: "CANCELLED", startsAt: h(-24) }, now).allowed).toBe(false);
  });
});

describe("shouldMarkCompleted", () => {
  it("kun når BOOKED og sluttidspunktet er passeret", () => {
    expect(shouldMarkCompleted({ status: "BOOKED", endsAt: h(-1) }, now)).toBe(true);
    expect(shouldMarkCompleted({ status: "BOOKED", endsAt: now }, now)).toBe(true);
    expect(shouldMarkCompleted({ status: "BOOKED", endsAt: h(1) }, now)).toBe(false);
    expect(shouldMarkCompleted({ status: "CANCELLED", endsAt: h(-1) }, now)).toBe(false);
    expect(shouldMarkCompleted({ status: "COMPLETED", endsAt: h(-1) }, now)).toBe(false);
  });
});

describe("statusAfterTranscription", () => {
  it("sætter ikke COMPLETED for et møde, der ikke er slut (også selvom det er begyndt)", () => {
    expect(statusAfterTranscription({ status: "BOOKED", endsAt: h(1) }, now)).toBe("BOOKED");
    expect(statusAfterTranscription({ status: "BOOKED", endsAt: h(48) }, now)).toBe("BOOKED");
  });
  it("sætter COMPLETED når mødet er slut", () => {
    expect(statusAfterTranscription({ status: "BOOKED", endsAt: h(-2) }, now)).toBe("COMPLETED");
  });
  it("rører ikke aflyste møder", () => {
    expect(statusAfterTranscription({ status: "CANCELLED", endsAt: h(-2) }, now)).toBe("CANCELLED");
  });
});

describe("ADVISOR_BLOCKING_STATUSES", () => {
  it("booket og afholdt blokerer rådgiveren, aflyst gør ikke", () => {
    expect(ADVISOR_BLOCKING_STATUSES).toContain("BOOKED");
    expect(ADVISOR_BLOCKING_STATUSES).toContain("COMPLETED");
    expect(ADVISOR_BLOCKING_STATUSES).not.toContain("CANCELLED");
  });
});
