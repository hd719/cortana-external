import { describe, expect, it } from "vitest";

import { getWorkoutRenderKey } from "./page";

describe("getWorkoutRenderKey", () => {
  it("produces unique keys for duplicate workout id + start combinations", () => {
    const workouts = [
      { id: "w1", start: "2026-03-03T10:00:00.000Z" },
      { id: "w1", start: "2026-03-03T10:00:00.000Z" },
      { id: "w1", start: "2026-03-03T10:00:00.000Z" },
    ];

    const keys = workouts.map((workout, index) => getWorkoutRenderKey(workout, index));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "w1-2026-03-03T10:00:00.000Z-0",
      "w1-2026-03-03T10:00:00.000Z-1",
      "w1-2026-03-03T10:00:00.000Z-2",
    ]);
  });

  it("uses a deterministic fallback when start is null", () => {
    const key = getWorkoutRenderKey({ id: "w2", start: null }, 4);
    expect(key).toBe("w2-na-4");
  });
});
