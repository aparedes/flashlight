import { describe, it, expect } from "bun:test";
import { waitFor } from "../waitFor";

describe("waitFor", () => {
  it("returns the first truthy result of a sync predicate", async () => {
    let calls = 0;
    const result = await waitFor(() => (++calls >= 3 ? "done" : null), { checkInterval: 1 });

    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  it("awaits an async predicate instead of treating the promise as truthy", async () => {
    let calls = 0;
    const result = await waitFor(
      async () => {
        calls++;
        return calls >= 2;
      },
      { checkInterval: 1 }
    );

    expect(result).toBe(true);
    expect(calls).toBe(2);
  });

  it("times out with the given error message", async () => {
    await expect(
      waitFor(async () => false, { timeout: 5, checkInterval: 1, errorMessage: "nope" })
    ).rejects.toThrow("nope");
  });

  it("uses a default check interval when only a timeout is given", async () => {
    let calls = 0;
    await expect(
      waitFor(
        () => {
          calls++;
          return false;
        },
        { timeout: 120 }
      )
    ).rejects.toThrow("Waited for condition which never happened");

    // Default interval is 50ms: 120ms timeout allows 3 evaluations (0, 50, 100ms)
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("works with no options at all", async () => {
    expect(await waitFor(() => 42)).toBe(42);
  });
});
