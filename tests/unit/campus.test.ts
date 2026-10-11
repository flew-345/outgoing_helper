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
    expect(parseJourney("从桂园到总图书馆怎么走")).toEqual({
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

describe("preview route estimates", () => {
  it("includes every access, wait and travel segment in total time", () => {
    const routes = planRoutes(places[0], places[1]);
    expect(routes.map((r) => r.mode)).toEqual(["walk", "bus", "bike"]);
    for (const route of routes) {
      expect(route.minutes).toBe(
        route.segments.reduce((sum, segment) => sum + segment.minutes, 0),
      );
      expect(route.points[0]).toEqual([places[0].lat, places[0].lng]);
      expect(route.points.at(-1)).toEqual([places[1].lat, places[1].lng]);
    }
  });
  it("avoids a journey to the same place", () => {
    expect(planRoutes(places[0], places[0])).toEqual([]);
    expect(recommendRoute([])).toBeUndefined();
  });
  it("flags and adjusts the preview route affected by construction", () => {
    const forward = planRoutes(places[0], places[3]);
    const reverse = planRoutes(places[3], places[0]);
    expect(forward.every((r) => r.affected)).toBe(true);
    expect(reverse.every((r) => r.affected)).toBe(true);
    expect(forward[0].distance).toBeGreaterThan(
      distanceMeters(places[0], places[3]) * 1.35,
    );
    expect(planRoutes(places[0], places[1]).some((r) => r.affected)).toBe(
      false,
    );
  });
  it("selects the shortest estimate without reordering the displayed options", () => {
    const routes = planRoutes(places[0], places[1]);
    expect(recommendRoute(routes)?.minutes).toBe(
      Math.min(...routes.map((r) => r.minutes)),
    );
    expect(routes[0].mode).toBe("walk");
  });
  it("handles distance formatting and identical coordinates", () => {
    expect(distanceMeters(places[0], places[0])).toBe(0);
    expect(formatDistance(950)).toBe("950 米");
    expect(formatDistance(1250)).toBe("1.3 公里");
  });
});
