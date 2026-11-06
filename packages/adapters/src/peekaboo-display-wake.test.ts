import { describe, expect, it, vi } from "vitest";
import { needsPeekabooDisplayWake, wakePeekabooDisplay } from "./peekaboo-display-wake.js";

const local = { transport: "stdio", command: "/Users/imac/.local/bin/peekaboo" };
describe("Peekaboo display wake hook", () => {
  it("wakes for local visual tools on macOS only", () => {
    for (const name of ["see", "capture", "image", "analyze", "inspect_ui"]) {
      expect(needsPeekabooDisplayWake(local, name)).toBe(process.platform === "darwin");
    }
  });
  it("does not wake for discovery, actions or unrelated servers", async () => {
    const wake = vi.fn(async () => {});
    await wakePeekabooDisplay(local, "list_tools", wake);
    await wakePeekabooDisplay(local, "click", wake);
    await wakePeekabooDisplay({ transport: "stdio", command: "/bin/other" }, "see", wake);
    await wakePeekabooDisplay(
      { transport: "http", command: "/Users/imac/.local/bin/peekaboo" },
      "see",
      wake,
    );
    expect(wake).not.toHaveBeenCalled();
  });
  it("runs exactly one wake for an eligible observation", async () => {
    const wake = vi.fn(async () => {});
    await wakePeekabooDisplay(local, "see", wake);
    expect(wake).toHaveBeenCalledTimes(process.platform === "darwin" ? 1 : 0);
  });
});
