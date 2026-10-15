import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTransitSnapshot } from "../../src/lib/bus";
import {
  createTransitService,
  gcjToWgs,
  type CollectedSnapshot,
  type SnapshotStore,
} from "../../src/server/transit-service";
import {
  LINE_IDS,
  type TransitClient,
} from "../../src/server/transit-upstream";
import { GET } from "../../src/app/api/transit/route.live";

function clientFixture() {
  return {
    stations: vi.fn(async () => ({
      lineName: "环线",
      direction: 0,
      line2Id: "",
      firstTime: "07:20",
      lastTime: "22:40",
      price: "1.0~2.0",
      stops: [1, 2].map((order) => ({
        stopId: "same-stop",
        stopName: "珞珈门",
        stopOrder: order,
        lat: "30.53",
        lng: "114.36",
      })),
    })),
    path: vi.fn(async () => ({ path: "30.53,114.36;30.54,114.37" })),
    vehicles: vi.fn(async () => ["50264|11|1|0|114.36|30.53"]),
  } satisfies TransitClient;
}

describe("automatic transit service", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("coalesces visitors and caches metadata while polling vehicles", async () => {
    let now = Date.parse("2026-10-15T01:00:00Z");
    const client = clientFixture();
    const service = createTransitService(client, () => now);
    const [first, concurrent] = await Promise.all([
      service.getSnapshot(),
      service.getSnapshot(),
    ]);
    expect(parseTransitSnapshot(first).lines.map((line) => line.id)).toEqual(
      LINE_IDS,
    );
    expect(concurrent).toEqual(first);
    expect(client.stations).toHaveBeenCalledTimes(4);
    expect(client.vehicles).toHaveBeenCalledTimes(4);
    expect(first.lines[0].stops[0].occurrenceId).not.toBe(
      first.lines[0].stops[1].occurrenceId,
    );
    expect(Math.abs(first.lines[0].stops[0].lng - 114.35454)).toBeLessThan(
      0.0001,
    );
    first.lines[0].stops.length = 0;
    expect((await service.getSnapshot()).lines[0].stops).toHaveLength(2);
    now += 10_000;
    client.vehicles.mockResolvedValue([]);
    const second = await service.getSnapshot();
    expect(second.lines[0].vehicles).toEqual([]);
    expect(second.lines[0].vehicleStatus).toBe("fresh");
    expect(second.lines[0].vehiclesFetchedAt).not.toBe(
      concurrent.lines[0].vehiclesFetchedAt,
    );
    expect(client.stations).toHaveBeenCalledTimes(4);
    expect(client.vehicles).toHaveBeenCalledTimes(8);
  });

  it("preserves old vehicle timestamps and positions during upstream failures and recovers", async () => {
    let now = Date.parse("2026-10-15T01:00:00Z");
    const client = clientFixture();
    const service = createTransitService(client, () => now);
    const first = await service.getSnapshot();
    now += 10_000;
    client.vehicles.mockRejectedValue(new Error("offline"));
    const stale = await service.getSnapshot();
    expect(stale.lines[0].vehiclesFetchedAt).toBe(
      first.lines[0].vehiclesFetchedAt,
    );
    expect(stale.lines[0].vehicles).toEqual(first.lines[0].vehicles);
    expect(stale.lines[0].vehicleStatus).toBe("stale");
    expect(stale.errors).toHaveLength(4);
    now += 10_000;
    client.vehicles.mockResolvedValue([]);
    expect((await service.getSnapshot()).lines[0].vehicleStatus).toBe("fresh");
  });

  it("marks first-time vehicle failures unavailable and rejects invalid station/vehicle fields", async () => {
    const client = clientFixture();
    client.vehicles.mockResolvedValue(["50264|11|99|0|114.36|30.53"]);
    const snapshot = await createTransitService(client).getSnapshot();
    expect(snapshot.lines[0].vehicleStatus).toBe("unavailable");
    expect(snapshot.lines[0].vehiclesFetchedAt).toBeNull();
    client.stations.mockResolvedValue({
      ...(await clientFixture().stations()),
      stops: [],
    });
    await expect(createTransitService(client).getSnapshot()).rejects.toThrow(
      "暂时无法读取",
    );
    expect(() => gcjToWgs(NaN, 114)).toThrow();
    expect(gcjToWgs(51, -1)).toEqual([51, -1]);
  });

  it("shares a cached snapshot with a new instance, expires metadata and tolerates cache outages", async () => {
    let now = Date.parse("2026-10-15T01:00:00Z");
    let shared: CollectedSnapshot | undefined;
    const store: SnapshotStore = {
      async read() {
        return shared;
      },
      async write(snapshot) {
        shared = structuredClone(snapshot);
      },
    };
    await createTransitService(clientFixture(), () => now).getSnapshot(store);
    const client = clientFixture();
    const service = createTransitService(client, () => now);
    await service.getSnapshot(store);
    expect(client.vehicles).not.toHaveBeenCalled();
    now += 10_000;
    await service.getSnapshot(store);
    expect(client.vehicles).toHaveBeenCalledTimes(4);
    expect(client.stations).not.toHaveBeenCalled();
    now += 6 * 60 * 60 * 1000;
    const brokenStore = {
      read: vi.fn().mockRejectedValue(new Error()),
      write: vi.fn().mockRejectedValue(new Error()),
    };
    await service.getSnapshot(brokenStore);
    expect(client.stations).toHaveBeenCalledTimes(4);
    expect(brokenStore.write).toHaveBeenCalled();
  });

  it("backs off complete failures instead of retrying for every visitor", async () => {
    let now = Date.parse("2026-10-15T01:00:00Z");
    const client = clientFixture();
    client.stations.mockRejectedValue(new Error());
    const service = createTransitService(client, () => now);
    await expect(service.getSnapshot()).rejects.toThrow();
    await expect(service.getSnapshot()).rejects.toThrow();
    expect(client.stations).toHaveBeenCalledTimes(4);
    now += 10_000;
    client.stations.mockImplementation(clientFixture().stations);
    expect((await service.getSnapshot()).lines).toHaveLength(4);
  });

  it("returns a no-store 503 on cold upstream failure without falling back to a bundled snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    try {
      const response = await GET(
        new Request("https://example.com/api/transit?url=http://localhost"),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "校方校巴数据暂时无法读取，请稍后重试",
      });
      expect(
        vi
          .mocked(fetch)
          .mock.calls.every(([url]) =>
            String(url).startsWith("https://bus.whu.edu.cn/"),
          ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
