import { describe, expect, it } from "vitest";
import { formValues } from "./form-state";
import { parseDanishDateTime } from "./time";

describe("formularværdier (plan #22)", () => {
  it("sender tekstfelter tilbage, men ikke filer, adgangskoder eller Next-interne felter", () => {
    const fd = new FormData();
    fd.set("name", "Mette");
    fd.set("bio", "Lang præsentation …");
    fd.set("password", "hemmelig");
    fd.set("$ACTION_ID_abc", "");
    fd.set("file", new Blob(["x"]), "a.mp3");
    expect(formValues(fd, ["password"])).toEqual({ name: "Mette", bio: "Lang præsentation …" });
  });
});

describe("fravær til kl. 24:00 (plan #24)", () => {
  it("24:00 er slutningen af dagen og kun tilladt som slut", () => {
    expect(parseDanishDateTime("24.12.2026", "24:00")).toBeNull();
    expect(parseDanishDateTime("24.12.2026", "24:00", { allowEndOfDay: true })?.toISOString()).toBe("2026-12-24T23:00:00.000Z");
    // Sommertid: 24:00 den 28.03.2026 er 00:00 den 29. (CET) = 23:00 UTC
    expect(parseDanishDateTime("28.03.2026", "24:00", { allowEndOfDay: true })?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(parseDanishDateTime("15.06.2026", "24:00", { allowEndOfDay: true })?.toISOString()).toBe("2026-06-15T22:00:00.000Z");
  });
});
