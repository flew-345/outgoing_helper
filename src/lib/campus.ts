import { meters, planRoadRoutes, type RoadGraph } from "./road-router";
import type { BusLine } from "./bus";

export type Place = {
  id: string;
  name: string;
  area: string;
  aliases: string[];
  lat: number;
  lng: number;
  source?: string;
};
export type Mode = "walk" | "bus" | "bike";
export type Route = {
  mode: Mode;
  title: string;
  minutes: number | null;
  distance: number;
  cost: string;
  reason: string;
  segments: { label: string; minutes: number | null; mode: Mode }[];
  points: [number, number][];
  legs: { mode: Mode; connector?: boolean; points: [number, number][] }[];
  steps: string[];
  affected: boolean;
  busLineId?: string;
};

export const places: Place[] = [
  {
    id: "guiyuan",
    name: "桂园宿舍",
    area: "文理学部 · 桂园",
    aliases: ["桂园", "宿舍"],
    lat: 30.5411241,
    lng: 114.3533677,
    source: "OSM way/103948537 · 桂园一舍中心",
  },
  {
    id: "teaching",
    name: "第一教学楼",
    area: "文理学部 · 教学区",
    aliases: ["一教", "第一教学楼"],
    lat: 30.5395725,
    lng: 114.3598807,
    source: "OSM way/103752729 · 建筑中心",
  },
  {
    id: "library",
    name: "工学部图书馆",
    area: "工学部 · 图书馆",
    aliases: ["图书馆", "工图"],
    lat: 30.5460604,
    lng: 114.3557969,
    source: "OSM way/153744434 · 建筑中心",
  },
  {
    id: "sakura",
    name: "樱顶老图书馆",
    area: "文理学部 · 樱园",
    aliases: ["樱顶", "老图书馆"],
    lat: 30.542526,
    lng: 114.3581496,
    source: "OSM way/103753737 · 建筑中心",
  },
  {
    id: "meiyuan",
    name: "梅园食堂",
    area: "文理学部 · 梅园",
    aliases: ["梅园", "食堂"],
    lat: 30.5379839,
    lng: 114.359068,
    source: "OSM way/103751587 · 建筑中心",
  },
  {
    id: "gate",
    name: "珞珈门",
    area: "八一路 · 校门",
    aliases: ["校门", "正门", "珞珈门"],
    lat: 30.5349699,
    lng: 114.3523725,
    source: "OSM node/3709156166",
  },
  {
    id: "engineering",
    name: "工学部教学楼",
    area: "工学部 · 教学区",
    aliases: ["工学部"],
    lat: 30.5445587,
    lng: 114.3615752,
    source: "OSM way/1477325046 · 工学部第二教学楼中心",
  },
  {
    id: "lake",
    name: "凌波门",
    area: "东湖路 · 校门",
    aliases: ["凌波门", "东湖"],
    lat: 30.5456112,
    lng: 114.3651049,
    source: "OSM node/13613667177",
  },
];

export const campusBounds: [[number, number], [number, number]] = [
  [30.5333, 114.3518],
  [30.549, 114.3765],
];
export const DEMO_TIME = "2026-10-10 09:30";
export const incidents = [
  {
    id: "construction",
    title: "樱园路局部施工",
    detail: "樱园路靠近老图书馆路段施工，步行与骑行请走南侧道路。",
    area: "樱园路",
    type: "施工",
    time: "10 月 10 日 08:00 — 18:00",
    lat: 30.5418,
    lng: 114.3649,
    severity: "warning",
  },
  {
    id: "event",
    title: "工学部活动临时限行",
    detail: "工学部主干道活动期间限制机动车通行，行人可正常通过。",
    area: "工学部",
    type: "限行",
    time: "10 月 10 日 14:00 — 17:00",
    lat: 30.5469,
    lng: 114.3633,
    severity: "info",
  },
];

export function searchPlaces(query: string): Place[] {
  const value = query.trim().toLowerCase();
  return places.filter(
    (p) =>
      !value ||
      [p.name, p.area, ...p.aliases].some((s) =>
        s.toLowerCase().includes(value),
      ),
  );
}

export function distanceMeters(a: Place, b: Place): number {
  return Math.round(meters([a.lat, a.lng], [b.lat, b.lng]));
}

export function planRoutes(
  origin: Place,
  destination: Place,
  graph: RoadGraph,
  lines: BusLine[] = [],
): Route[] {
  return planRoadRoutes(origin, destination, graph, lines);
}

export function recommendRoute(routes: Route[]): Route | undefined {
  return routes
    .filter((r) => r.minutes !== null)
    .sort(
      (a, b) =>
        (a.minutes ?? Infinity) - (b.minutes ?? Infinity) ||
        a.distance - b.distance,
    )[0];
}

export function parseJourney(text: string): {
  origin?: Place;
  destination?: Place;
} {
  // Match specific names before broad aliases such as "图书馆" or "食堂".
  const candidates = places
    .flatMap((place) =>
      [place.name, ...place.aliases].flatMap((name) => {
        const index = text.indexOf(name);
        return index < 0 ? [] : [{ place, index, end: index + name.length }];
      }),
    )
    .sort((a, b) => b.end - b.index - (a.end - a.index));
  const matches: typeof candidates = [];
  for (const candidate of candidates) {
    if (
      !matches.some(
        (match) =>
          match.place.id === candidate.place.id ||
          (candidate.index < match.end && candidate.end > match.index),
      )
    )
      matches.push(candidate);
  }
  matches.sort((a, b) => a.index - b.index);
  return { origin: matches[0]?.place, destination: matches[1]?.place };
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} 米` : `${(meters / 1000).toFixed(1)} 公里`;
}
