import { describe, expect, it } from "vitest";
import { CreateBotInput } from "./domain.js";

describe("bot creation without a paid introduction", () => {
  const base = { name: "Research Analyst", computerMode: "dedicated" as const };
  it("defaults to an introduction for existing clients", () => {
    expect(CreateBotInput.parse(base).skipIntro).toBe(false);
  });
  it("accepts an explicit dormant specialist", () => {
    expect(CreateBotInput.parse({ ...base, skipIntro: true })).toMatchObject({
      name: "Research Analyst",
      computerMode: "dedicated",
      skipIntro: true,
    });
  });
  it("rejects ambiguous non-boolean switches", () => {
    expect(CreateBotInput.safeParse({ ...base, skipIntro: "yes" }).success).toBe(false);
  });
});
