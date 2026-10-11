import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTransitSnapshot, vehicleFreshness } from "../../src/lib/bus";

describe("Python collector to frontend import contract", () => {
  it("accepts the real four-direction sample and preserves repeated station occurrences", () => {
    const snapshot = parseTransitSnapshot(
      JSON.parse(
        readFileSync(
          new URL("../../public/data/whu-bus.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(snapshot.lines.map((line) => line.id)).toEqual([
      "10486-50-0",
      "10486-55-0",
      "10486-56-0",
      "10486-56-1",
    ]);
    const first = snapshot.lines[0];
    expect(first.stops[0].name).toBe(first.stops.at(-1)?.name);
    expect(first.stops[0].occurrenceId).not.toBe(
      first.stops.at(-1)?.occurrenceId,
    );
    expect(first.stops[0].sourceLng).not.toBe(first.stops[0].lng);
    expect(
      vehicleFreshness(
        snapshot,
        first,
        Date.parse(snapshot.fetchedAt) + 120000,
      ),
    ).toBe("stale");
  });
});
