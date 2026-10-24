import { describe, expect, it } from "vitest";
import { chiefLiveEnabled, liveEventForResult } from "./chief-live.js";

describe("Chief Live", () => {
  it("returns task commentary with the original delegation ID", () => {
    expect(liveEventForResult("delegation_42", "Verified result", "event_7")).toEqual({
      type: "session.commentary.append",
      event_id: "event_7",
      delegation_id: "delegation_42",
      content: "Verified result",
    });
  });

  it("limits returned commentary to a short spoken summary", () => {
    expect(liveEventForResult("d", "x".repeat(2000), "e").content).toHaveLength(1600);
  });

  it("requires both the opt-in flag and the Chief bot", () => {
    expect(chiefLiveEnabled("Other")).toBe(false);
    expect(chiefLiveEnabled("Chief")).toBe(import.meta.env.VITE_CHIEF_LIVE_ENABLED === "true");
  });
});
