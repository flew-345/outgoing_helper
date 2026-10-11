import graphData from "../../public/data/campus-roads.json";
import { parseRoadGraph } from "../../src/lib/road-router";
import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  formatDistance,
  parseJourney,
  places,
  planRoutes,
  recommendRoute,
  searchPlaces,
} from "../../src/lib/campus";

describe("campus place lookup", () => {
  it("searches partial names, aliases and areas", () => {
    expect(searchPlaces("  一教  ").map((p) => p.id)).toEqual(["teaching"]);
    expect(searchPlaces("图书馆")).toHaveLength(2);
    expect(searchPlaces("不存在的地点")).toEqual([]);
    expect(searchPlaces("")).toHaveLength(places.length);
  });
  it("extracts endpoints in sentence order and does not duplicate aliases", () => {
    expect(parseJourney("从桂园到工学部图书馆怎么走")).toEqual({
      origin: places[0],
      destination: places[2],
    });
    expect(parseJourney("从一教回桂园")).toEqual({
      origin: places[1],
      destination: places[0],
    });
    expect(parseJourney("从第一教学楼出发").destination).toBeUndefined();
    expect(parseJourney("从老图书馆到梅园食堂")).toEqual({
      origin: places[3],
      destination: places[4],
    });
    expect(parseJourney("去樱顶老图书馆").destination).toBeUndefined();
    expect(parseJourney("你好")).toEqual({
      origin: undefined,
      destination: undefined,
    });
  });
});

describe("road route estimates", () => {
  const graph = parseRoadGraph(graphData);
  it("calculates distance from road geometry and uses declared speeds", () => {
    const routes = planRoutes(places[0], places[1], graph);
    expect(routes.map((r) => r.mode)).toEqual(["walk", "bike"]);
    for (const route of routes) {
      expect(route.minutes).toBeGreaterThan(0);
      expect(route.points[0]).toEqual([places[0].lat, places[0].lng]);
      expect(route.points.at(-1)).toEqual([places[1].lat, places[1].lng]);
      expect(route.points.length).toBeGreaterThan(4);
      expect(route.steps.length).toBeGreaterThan(2);
    }
    expect(recommendRoute(routes)?.minutes).toBe(
      Math.min(...routes.map((r) => r.minutes!)),
    );
  });
  it("avoids a journey to the same place", () => {
    expect(planRoutes(places[0], places[0], graph)).toEqual([]);
    expect(recommendRoute([])).toBeUndefined();
  });
  it("handles distance formatting and identical coordinates", () => {
    expect(distanceMeters(places[0], places[0])).toBe(0);
    expect(formatDistance(950)).toBe("950 米");
    expect(formatDistance(1250)).toBe("1.3 公里");
  });
});
