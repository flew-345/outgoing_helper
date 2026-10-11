export type Place = {
  id: string;
  name: string;
  area: string;
  aliases: string[];
  lat: number;
  lng: number;
};
export type Mode = "walk" | "bus" | "bike";
export type Route = {
  mode: Mode;
  title: string;
  minutes: number;
  distance: number;
  cost: string;
  reason: string;
  segments: { label: string; minutes: number; mode: Mode }[];
  points: [number, number][];
  affected: boolean;
};

export const places: Place[] = [
  {
    id: "guiyuan",
    name: "桂园宿舍",
    area: "文理学部 · 桂园",
    aliases: ["桂园", "宿舍"],
    lat: 30.5392,
    lng: 114.3568,
  },
  {
    id: "teaching",
    name: "第一教学楼",
    area: "文理学部 · 教学区",
    aliases: ["一教", "第一教学楼"],
    lat: 30.5368,
    lng: 114.3633,
  },
  {
    id: "library",
    name: "总图书馆",
    area: "文理学部 · 图书馆",
    aliases: ["图书馆", "总图"],
    lat: 30.5413,
    lng: 114.3616,
  },
  {
    id: "sakura",
    name: "樱顶老图书馆",
    area: "文理学部 · 樱园",
    aliases: ["樱顶", "老图书馆"],
    lat: 30.5422,
    lng: 114.3656,
  },
  {
    id: "meiyuan",
    name: "梅园食堂",
    area: "文理学部 · 梅园",
    aliases: ["梅园", "食堂"],
    lat: 30.5401,
    lng: 114.3647,
  },
  {
    id: "gate",
    name: "珞珈门",
    area: "八一路 · 校门",
    aliases: ["校门", "正门", "珞珈门"],
    lat: 30.5349,
    lng: 114.3607,
  },
  {
    id: "engineering",
    name: "工学部教学楼",
    area: "工学部 · 教学区",
    aliases: ["工学部"],
    lat: 30.5477,
    lng: 114.3633,
  },
  {
    id: "lake",
    name: "凌波门",
    area: "东湖路 · 校门",
    aliases: ["凌波门", "东湖"],
    lat: 30.544,
    lng: 114.3733,
  },
];

export const campusBounds: [[number, number], [number, number]] = [
  [30.5333, 114.3518],
  [30.549, 114.3765],
];
export const DEMO_TIME = "2026-10-10 09:30";
export const busStops = [
  places[5],
  places[0],
  places[2],
  places[3],
  places[6],
  places[7],
];
export const busLine: [number, number][] = busStops.map((p) => [p.lat, p.lng]);
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
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

// The preview estimates time from distance; these polylines are not road navigation.
export function planRoutes(origin: Place, destination: Place): Route[] {
  if (origin.id === destination.id) return [];
  const affected = [origin.id, destination.id].includes("sakura");
  const distance = Math.round(
    distanceMeters(origin, destination) * (affected ? 1.5 : 1.35),
  );
  const walkMinutes = Math.max(2, Math.ceil(distance / 72));
  const bikeMinutes = Math.max(2, Math.ceil(distance / 230));
  const busMinutes = Math.max(3, Math.ceil(distance / 260));
  const points: [number, number][] = [
    [origin.lat, origin.lng],
    [origin.lat - 0.0004, origin.lng + (destination.lng - origin.lng) * 0.35],
    [
      (origin.lat + destination.lat) / 2 - (affected ? 0.0012 : 0.0003),
      (origin.lng + destination.lng) / 2,
    ],
    [destination.lat, destination.lng],
  ];
  return [
    {
      mode: "walk",
      title: "全程步行",
      minutes: walkMinutes,
      distance,
      cost: "免费",
      reason: "无需等待，随时出发",
      segments: [{ label: "步行", minutes: walkMinutes, mode: "walk" }],
      points,
      affected,
    },
    {
      mode: "bus",
      title: "步行 + 校巴",
      minutes: busMinutes + 11,
      distance,
      cost: "票价待核实",
      reason: "少走一段路，轻松到达",
      segments: [
        { label: "步行到站", minutes: 3, mode: "walk" },
        { label: "候车", minutes: 5, mode: "bus" },
        { label: "校巴", minutes: busMinutes, mode: "bus" },
        { label: "步行", minutes: 3, mode: "walk" },
      ],
      points: points.map(([lat, lng], i) => [
        lat + (i === 1 || i === 2 ? 0.0007 : 0),
        lng,
      ]),
      affected,
    },
    {
      mode: "bike",
      title: "共享电动车",
      minutes: bikeMinutes + 5,
      distance,
      cost: "以平台计费为准",
      reason: "路程较远时更省时间",
      segments: [
        { label: "找车", minutes: 3, mode: "walk" },
        { label: "骑行", minutes: bikeMinutes, mode: "bike" },
        { label: "步行", minutes: 2, mode: "walk" },
      ],
      points,
      affected,
    },
  ];
}

export function recommendRoute(routes: Route[]): Route | undefined {
  return [...routes].sort(
    (a, b) => a.minutes - b.minutes || a.distance - b.distance,
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
