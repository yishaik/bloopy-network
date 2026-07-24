import { describe, expect, it } from "vitest";
import { isValidTimeZone, timeFallsInQuietHours } from "../src/notifications.js";

describe("notification timezone validation",()=>{
  it("accepts real IANA zones and rejects invented zones",()=>{
    expect(isValidTimeZone("Asia/Jerusalem")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/A_Real_Zone")).toBe(false);
  });
});

describe("quiet hours",()=>{
  it("handles quiet hours that cross midnight",()=>{
    expect(timeFallsInQuietHours("23:00","22:00","08:00")).toBe(true);
    expect(timeFallsInQuietHours("07:59","22:00","08:00")).toBe(true);
    expect(timeFallsInQuietHours("08:00","22:00","08:00")).toBe(false);
    expect(timeFallsInQuietHours("10:00","22:00","08:00")).toBe(false);
  });

  it("handles quiet hours within the same day",()=>{
    expect(timeFallsInQuietHours("13:00","12:00","14:00")).toBe(true);
    expect(timeFallsInQuietHours("14:00","12:00","14:00")).toBe(false);
    expect(timeFallsInQuietHours("11:59","12:00","14:00")).toBe(false);
  });

  it("treats matching start and end as no quiet interval",()=>{
    expect(timeFallsInQuietHours("10:00","00:00","00:00")).toBe(false);
  });

  it("rejects malformed time strings",()=>{
    expect(()=>timeFallsInQuietHours("25:00","22:00","08:00")).toThrow("HH:mm");
  });
});
