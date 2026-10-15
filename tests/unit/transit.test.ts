import { describe, expect, it, vi } from "vitest";
import {
  arrivalsAt,
  initialFeedUrl,
  normalizeFeedUrl,
  parseTransitSnapshot,
  vehicleFreshness,
  type TransitSnapshot,
} from "../../src/lib/bus";

function fixture(): TransitSnapshot {
  const now = "2026-10-11T09:30:00+08:00";
  return {
    schemaVersion: 1,
    source: "bus.whu.edu.cn",
    fetchedAt: now,
    coordinateSystem: "amap-gcj02-inferred",
    displayCoordinateSystem: "wgs84-approximate",
    lines: [
      {
        id: "10486-50-0",
        name: "1号线",
        direction: 0,
        returnLineId: null,
        firstTime: "07:20",
        lastTime: "22:40",
        priceRaw: "1.0~2.0",
        warnings: [],
        timetable: [],
        rawMetadata: {},
        stops: [1, 2, 3, 4].map((order) => ({
          occurrenceId: `10486-50-0:${order}`,
          sourceStopId: order === 4 ? "1" : String(order),
          order,
          name: order === 4 ? "站1" : `站${order}`,
          area: "校园校巴",
          aliases: [],
          lat: 30.5,
          lng: 114.3,
          sourceLat: 30.5,
          sourceLng: 114.3,
        })),
        path: [[30.5, 114.3]],
        vehiclesFetchedAt: now,
        vehicleStatus: "fresh",
        vehicles: [1, 3, 2].map((stopOrder) => ({
          id: String(stopOrder),
          lineId: "10486-50-0",
          stopOrder,
          arrivalState: "0",
          lat: 30.5,
          lng: 114.3,
          sourceLat: 30.5,
          sourceLng: 114.3,
          rawFields: [],
        })),
      },
    ],
  };
}

describe("transit import boundary", () => {
  it("resolves live links before old snapshot preferences and preserves normal saved feeds", () => {
    expect(initialFeedUrl("?view=bus&live=1", "/data/old.json")).toBe(
      "/api/transit",
    );
    expect(initialFeedUrl("?live=1", "javascript:alert(1)")).toBe(
      "/api/transit",
    );
    expect(initialFeedUrl("?live=0", "/data/old.json")).toBe(
      "/data/whu-bus.json",
    );
    expect(
      initialFeedUrl("?view=bus", "http://127.0.0.1:8766/api/transit"),
    ).toBe("http://127.0.0.1:8766/api/transit");
    expect(initialFeedUrl("", null)).toBe("/api/transit");
    expect(initialFeedUrl("", "javascript:alert(1)")).toBe("/api/transit");
  });
  it("preserves repeated physical stops as separate occurrences", () => {
    const value = parseTransitSnapshot(fixture());
    expect(value.lines[0].stops[0].sourceStopId).toBe(
      value.lines[0].stops[3].sourceStopId,
    );
    expect(
      new Set(value.lines[0].stops.map((stop) => stop.occurrenceId)).size,
    ).toBe(4);
  });
  it("rejects wrong coordinates, malformed timestamps, duplicate orders and foreign vehicles", () => {
    const malformed = fixture();
    malformed.lines[0].path = [[114.3, 30.5]];
    expect(() => parseTransitSnapshot(malformed)).toThrow("坐标");
    const stamp = fixture();
    stamp.fetchedAt = "2026-10-11 09:30";
    expect(() => parseTransitSnapshot(stamp)).toThrow();
    const duplicate = fixture();
    duplicate.lines[0].stops[1].order = 1;
    expect(() => parseTransitSnapshot(duplicate)).toThrow("站次");
    const foreign = fixture();
    foreign.lines[0].vehicles[0].lineId = "another-line";
    expect(() => parseTransitSnapshot(foreign)).toThrow("车辆");
  });
  it("rejects unsupported schema and protocol-relative, executable or credentialed feeds", () => {
    expect(() =>
      parseTransitSnapshot({ ...fixture(), schemaVersion: 2 }),
    ).toThrow();
    expect(normalizeFeedUrl("")).toBe("/api/transit");
    expect(normalizeFeedUrl("http://127.0.0.1:8766/api/transit")).toBe(
      "http://127.0.0.1:8766/api/transit",
    );
    for (const input of [
      "//example.com/feed",
      "javascript:alert(1)",
      "https://user:pass@example.com/feed",
    ])
      expect(() => normalizeFeedUrl(input)).toThrow();
  });
  it("migrates bundled snapshots and public-site loopback addresses to the automatic feed", () => {
    expect(initialFeedUrl("", "/data/whu-bus.json")).toBe("/api/transit");
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(
        initialFeedUrl(
          "",
          `http://${host}:8766/api/transit`,
          "whu-going.example.com",
        ),
      ).toBe("/api/transit");
    }
    expect(
      initialFeedUrl("", "https://example.com/feed", "whu-going.example.com"),
    ).toBe("https://example.com/feed");
  });
  it("keeps the portable static package usable without a server API", () => {
    vi.stubEnv("NEXT_PUBLIC_TRANSIT_STATIC_EXPORT", "1");
    try {
      expect(initialFeedUrl("", null)).toBe("/data/whu-bus.json");
      expect(normalizeFeedUrl("")).toBe("/data/whu-bus.json");
      expect(initialFeedUrl("?live=1", null)).toBe("/api/transit");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("official station arithmetic", () => {
  it("uses the last two qualifying vehicles in response order, without a next loop", () => {
    const line = fixture().lines[0];
    expect(
      arrivalsAt(line, 4).map((item) => [item.vehicle.id, item.label]),
    ).toEqual([
      ["2", "2 站后"],
      ["3", "1 站后"],
    ]);
    expect(arrivalsAt(line, 0)).toEqual([]);
    line.vehicles = [line.vehicles[1]];
    expect(arrivalsAt(line, 2)).toEqual([]);
  });
  it("distinguishes approaching, arrived and unknown states without inventing minutes", () => {
    const line = fixture().lines[0];
    line.vehicles = [line.vehicles[0]];
    expect(arrivalsAt(line, 1)[0].label).toBe("即将到站");
    line.vehicles[0].arrivalState = "1";
    expect(arrivalsAt(line, 1)[0].label).toBe("已到站");
    line.vehicles[0].arrivalState = "2";
    expect(arrivalsAt(line, 1)).toEqual([]);
  });
});

describe("data freshness", () => {
  it("treats fresh empty lists as successful observations and ages based on data timestamps", () => {
    const value = fixture();
    const line = value.lines[0];
    line.vehicles = [];
    const now = Date.parse(value.fetchedAt);
    expect(vehicleFreshness(value, line, now)).toBe("fresh");
    expect(vehicleFreshness(value, line, now + 30001)).toBe("stale");
    expect(vehicleFreshness(value, line, now, true)).toBe("stale");
    line.vehiclesFetchedAt = null;
    expect(vehicleFreshness(value, line, now)).toBe("unavailable");
    expect(vehicleFreshness(null, undefined, now)).toBe("unavailable");
  });
  it("does not allow a new snapshot envelope to freshen old vehicle data", () => {
    const value = fixture();
    const now = Date.parse(value.fetchedAt);
    value.lines[0].vehiclesFetchedAt = new Date(now - 60000).toISOString();
    expect(vehicleFreshness(value, value.lines[0], now)).toBe("stale");
    value.lines[0].vehicleStatus = "unavailable";
    expect(vehicleFreshness(value, value.lines[0], now)).toBe("unavailable");
  });
});
