import { describe, expect, it } from "vitest";
import { joinOpensAt, meetingJoinState } from "./meeting-join";
import { formatTime } from "./time";

const start = new Date("2026-11-12T09:00:00Z"); // 10:00 København (CET)
const end = new Date("2026-11-12T11:00:00Z");
const booked = { status: "BOOKED" as const, startsAt: start, endsAt: end };
const at = (iso: string) => new Date(iso);

describe("meetingJoinState", () => {
  it("er not_open_yet før vinduet åbner (15 min før start)", () => {
    expect(meetingJoinState(booked, at("2026-11-12T08:44:59Z"), 15)).toBe("not_open_yet");
    expect(meetingJoinState(booked, at("2026-11-10T09:00:00Z"), 15)).toBe("not_open_yet");
  });
  it("åbner præcis 15 min før start og er åbent til mødets slut", () => {
    expect(meetingJoinState(booked, at("2026-11-12T08:45:00Z"), 15)).toBe("open");
    expect(meetingJoinState(booked, at("2026-11-12T09:00:00Z"), 15)).toBe("open");
    expect(meetingJoinState(booked, at("2026-11-12T10:59:59Z"), 15)).toBe("open");
  });
  it("er ended fra sluttidspunktet", () => {
    expect(meetingJoinState(booked, at("2026-11-12T11:00:00Z"), 15)).toBe("ended");
    expect(meetingJoinState(booked, at("2026-11-13T09:00:00Z"), 15)).toBe("ended");
  });
  it("COMPLETED er ended, også før sluttidspunktet", () => {
    expect(meetingJoinState({ ...booked, status: "COMPLETED" }, at("2026-11-12T09:30:00Z"), 15)).toBe("ended");
  });
  it("CANCELLED er altid cancelled", () => {
    const c = { ...booked, status: "CANCELLED" as const };
    expect(meetingJoinState(c, at("2026-11-12T09:30:00Z"), 15)).toBe("cancelled");
    expect(meetingJoinState(c, at("2026-11-01T09:30:00Z"), 15)).toBe("cancelled");
    expect(meetingJoinState(c, at("2026-12-01T09:30:00Z"), 15)).toBe("cancelled");
  });
  it("respekterer en anden åbningstid og 0 minutter", () => {
    expect(meetingJoinState(booked, at("2026-11-12T08:30:00Z"), 30)).toBe("open");
    expect(meetingJoinState(booked, at("2026-11-12T08:59:59Z"), 0)).toBe("not_open_yet");
    expect(meetingJoinState(booked, at("2026-11-12T09:00:00Z"), 0)).toBe("open");
  });
});

describe("meetingJoinState og sommertid", () => {
  // Natten til søndag 29. marts 2026 skifter København fra CET (UTC+1) til CEST (UTC+2) kl. 02:00 → 03:00.
  it("åbningstiden regnes på tidspunkter, ikke klokkeslæt, hen over skiftet til sommertid", () => {
    const m = { status: "BOOKED" as const, startsAt: at("2026-03-29T01:10:00Z"), endsAt: at("2026-03-29T03:10:00Z") }; // 03:10 CEST
    const opens = joinOpensAt(m, 15);
    expect(opens.toISOString()).toBe("2026-03-29T00:55:00.000Z"); // præcis 15 min før i UTC
    expect(formatTime(opens)).toBe("01:55"); // lokal tid er stadig CET, før skiftet
    expect(formatTime(m.startsAt)).toBe("03:10"); // 75 min senere på uret (der springes en time over)
    expect(meetingJoinState(m, at("2026-03-29T00:54:59Z"), 15)).toBe("not_open_yet");
    expect(meetingJoinState(m, at("2026-03-29T00:55:00Z"), 15)).toBe("open");
  });
  it("hen over skiftet til vintertid (25. oktober 2026, 03:00 → 02:00)", () => {
    const m = { status: "BOOKED" as const, startsAt: at("2026-10-25T01:10:00Z"), endsAt: at("2026-10-25T03:10:00Z") }; // 02:10 CET
    const opens = joinOpensAt(m, 15);
    expect(opens.toISOString()).toBe("2026-10-25T00:55:00.000Z");
    expect(formatTime(opens)).toBe("02:55"); // CEST, før skiftet: uret viser 02:55 og går derefter tilbage til 02:00
    expect(formatTime(m.startsAt)).toBe("02:10");
    expect(meetingJoinState(m, at("2026-10-25T00:55:00Z"), 15)).toBe("open");
    expect(meetingJoinState(m, at("2026-10-25T00:54:00Z"), 15)).toBe("not_open_yet");
  });
  it("sommermøde: 15 min før kl. 10:00 CEST er kl. 09:45 lokal tid", () => {
    const m = { status: "BOOKED" as const, startsAt: at("2026-06-18T08:00:00Z"), endsAt: at("2026-06-18T10:00:00Z") };
    expect(formatTime(joinOpensAt(m, 15))).toBe("09:45");
  });
});
