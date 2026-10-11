import { describe, expect, it } from "vitest";
import extract from "../../public/data/campus-roads.json";
import busExtract from "../../public/data/whu-bus.json";
import {
  findRoadPath,
  meters,
  parseRoadGraph,
  permits,
  planDirectBus,
  type RoadGraph,
} from "../../src/lib/road-router";
import { parseTransitSnapshot } from "../../src/lib/bus";
import { places, planRoutes, recommendRoute } from "../../src/lib/campus";

const road = (id: string, nodes: string[], tags = {}) => ({
  id,
  nodes,
  tags: { highway: "service", name: id, ...tags },
});
function fixture(): RoadGraph {
  return {
    schemaVersion: 1,
    source: "OpenStreetMap",
    fetchedAt: "2026-10-11T00:00:00Z",
    dataTimestamp: "2026-10-11T00:00:00Z",
    bbox: [30, 114, 31, 115],
    nodes: {
      a: [30.5, 114.5],
      b: [30.501, 114.5],
      c: [30.501, 114.502],
      d: [30.5, 114.502],
    },
    ways: [road("detour", ["a", "b", "c", "d"])],
  };
}
describe("real road graph routing", () => {
  it("follows connected roads rather than multiplying straight-line distance", () => {
    const graph = fixture();
    graph.ways.push(road("closed-shortcut", ["a", "d"], { access: "private" }));
    const path = findRoadPath(graph, graph.nodes.a, graph.nodes.d, "walk")!;
    expect(path.wayIds.every((id) => id === "detour")).toBe(true);
    expect(path.points).toContainEqual(graph.nodes.b);
    expect(path.distance).toBeGreaterThan(
      meters(graph.nodes.a, graph.nodes.d) + 200,
    );
  });
  it("uses stairs for walking, but routes bicycles on the longer road", () => {
    const graph = fixture();
    graph.ways.push(road("stairs", ["a", "d"], { highway: "steps" }));
    const walk = findRoadPath(graph, graph.nodes.a, graph.nodes.d, "walk")!;
    const bike = findRoadPath(graph, graph.nodes.a, graph.nodes.d, "bike")!;
    expect(walk.wayIds).toContain("stairs");
    expect(bike.wayIds).not.toContain("stairs");
    expect(bike.distance).toBeGreaterThan(walk.distance);
  });
  it("honors one-way bicycle edges even when both endpoints snap onto the same segment", () => {
    const graph = fixture();
    graph.ways = [road("oneway", ["a", "d"], { oneway: "yes" })];
    const left: [number, number] = [30.5, 114.5005],
      right: [number, number] = [30.5, 114.5015];
    expect(findRoadPath(graph, left, right, "bike")).toBeDefined();
    expect(findRoadPath(graph, right, left, "bike")).toBeUndefined();
    expect(findRoadPath(graph, right, left, "walk")).toBeDefined();
    graph.ways[0].tags = { ...graph.ways[0].tags, "oneway:bicycle": "no" };
    expect(findRoadPath({ ...graph }, right, left, "bike")).toBeDefined();
  });
  it("does not join disconnected or crossing roads, snap outside coverage, or bridge distant endpoints", () => {
    const graph = fixture();
    graph.ways = [road("west", ["a", "b"]), road("east", ["c", "d"])];
    expect(
      findRoadPath(graph, graph.nodes.a, graph.nodes.d, "walk"),
    ).toBeUndefined();
    expect(
      findRoadPath(graph, [32, 116], graph.nodes.a, "walk"),
    ).toBeUndefined();
    expect(
      findRoadPath(graph, [30.51, 114.51], graph.nodes.a, "walk"),
    ).toBeUndefined();
  });
  it("honors explicit access, conditional restrictions and closed gates", () => {
    expect(
      permits({ highway: "service", access: "private", foot: "yes" }, "walk"),
    ).toBe(true);
    expect(permits({ highway: "service", bicycle: "no" }, "bike")).toBe(false);
    expect(permits({ highway: "service", vehicle: "no" }, "bike")).toBe(false);
    expect(permits({ highway: "service", access: "permit" }, "walk")).toBe(
      false,
    );
    expect(permits({ highway: "service", access: "destination" }, "walk")).toBe(
      false,
    );
    expect(permits({ highway: "footway" }, "bike")).toBe(false);
    expect(
      permits(
        { highway: "service", "access:conditional": "no @ (night)" },
        "walk",
      ),
    ).toBe(false);
    const graph = fixture();
    graph.nodeTags = { b: { barrier: "gate", access: "private" } };
    expect(
      findRoadPath(graph, graph.nodes.a, graph.nodes.d, "walk"),
    ).toBeUndefined();
  });
  it("rejects malformed extracts before routing", () => {
    expect(() =>
      parseRoadGraph({ ...fixture(), nodes: { a: [NaN, 114] } }),
    ).toThrow();
    expect(() =>
      parseRoadGraph({ ...fixture(), ways: [road("bad", ["a", "missing"])] }),
    ).toThrow();
  });
});

describe("bundled campus extract and official bus topology", () => {
  const graph = parseRoadGraph(extract);
  const lines = parseTransitSnapshot(busExtract).lines;
  it("has connected walking routes for every named endpoint and keeps road provenance", () => {
    for (const from of places)
      for (const to of places) {
        if (from.id === to.id) continue;
        const walk = planRoutes(from, to, graph).find((r) => r.mode === "walk");
        expect(walk, `${from.name} → ${to.name}`).toBeDefined();
        expect(walk!.points.length).toBeGreaterThan(4);
        expect(walk!.affected).toBe(false);
        expect(walk!.distance).toBeGreaterThanOrEqual(
          Math.floor(meters([from.lat, from.lng], [to.lat, to.lng])),
        );
      }
  }, 20000);
  it("offers an official directed ride without invented wait or travel minutes", () => {
    const route = planDirectBus(places[0], places[6], graph, lines)!;
    expect(route).toBeDefined();
    expect(route.minutes).toBeNull();
    expect(route.busLineId).toBe("10486-55-0");
    expect(
      route.legs.some((l) => l.mode === "bus" && l.points.length > 5),
    ).toBe(true);
    expect(route.steps.join(" ")).toContain("站次");
    expect(route.segments.find((s) => s.mode === "bus")?.minutes).toBeNull();
    expect(recommendRoute([route])).toBeUndefined();
    expect(planDirectBus(places[0], places[6], graph, [])).toBeUndefined();
  });
});
