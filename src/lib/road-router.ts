import type { Place, Route } from "./campus";
import type { BusLine } from "./bus";

export type Point = [number, number];
type Tags = Record<string, string>;
export type RoadGraph = {
  schemaVersion: number;
  source: string;
  fetchedAt: string;
  dataTimestamp: string;
  bbox: number[];
  nodes: Record<string, Point>;
  nodeTags?: Record<string, Tags>;
  ways: { id: string; nodes: string[]; tags: Tags }[];
};
export function meters(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) *
      Math.cos(b[0] * rad) *
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function parseRoadGraph(value: unknown): RoadGraph {
  const d = value as RoadGraph;
  const tagsValid = (t: Tags) =>
    t &&
    typeof t === "object" &&
    Object.values(t).every((v) => typeof v === "string");
  if (
    !d ||
    d.schemaVersion !== 1 ||
    d.source !== "OpenStreetMap" ||
    !Number.isFinite(Date.parse(d.dataTimestamp)) ||
    !Number.isFinite(Date.parse(d.fetchedAt)) ||
    !Array.isArray(d.bbox) ||
    d.bbox.length !== 4 ||
    !d.bbox.every(Number.isFinite) ||
    d.bbox[0] >= d.bbox[2] ||
    d.bbox[1] >= d.bbox[3] ||
    !d.nodes ||
    !Object.values(d.nodes).every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        Math.abs(p[0]) <= 90 &&
        Math.abs(p[1]) <= 180,
    ) ||
    !Array.isArray(d.ways) ||
    !d.ways.length ||
    !d.ways.every(
      (w) =>
        typeof w.id === "string" &&
        tagsValid(w.tags) &&
        Array.isArray(w.nodes) &&
        w.nodes.length >= 2 &&
        w.nodes.every((n) => !!d.nodes[n]),
    ) ||
    (d.nodeTags && !Object.values(d.nodeTags).every(tagsValid))
  )
    throw new Error("道路数据格式不兼容");
  return d;
}

const allowed = new Set(["yes", "designated", "permissive"]);
export function permits(tags: Tags, mode: "walk" | "bike", barrier = false) {
  const specific = tags[mode === "walk" ? "foot" : "bicycle"];
  if (specific && !allowed.has(specific)) return false;
  if (
    tags[`${mode === "walk" ? "foot" : "bicycle"}:conditional`] ||
    tags["access:conditional"]
  )
    return false;
  if (
    !(specific && allowed.has(specific)) &&
    tags.access &&
    !allowed.has(tags.access)
  )
    return false;
  if (
    mode === "bike" &&
    (!specific || !allowed.has(specific)) &&
    ((tags.vehicle && !allowed.has(tags.vehicle)) ||
      tags["vehicle:conditional"])
  )
    return false;
  if (barrier)
    return (
      tags.locked !== "yes" &&
      !["wall", "fence", "block"].includes(tags.barrier)
    );
  if (
    [
      "construction",
      "proposed",
      "motorway",
      "motorway_link",
      "busway",
      "corridor",
    ].includes(tags.highway)
  )
    return false;
  if (mode === "bike" && tags.highway === "steps") return false;
  if (["trunk", "trunk_link"].includes(tags.highway) && !allowed.has(specific))
    return false;
  if (
    mode === "bike" &&
    ["footway", "pedestrian"].includes(tags.highway) &&
    !allowed.has(specific)
  )
    return false;
  return [
    "service",
    "residential",
    "unclassified",
    "living_street",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "footway",
    "pedestrian",
    "cycleway",
    "path",
    "track",
    "steps",
    "trunk",
    "trunk_link",
  ].includes(tags.highway);
}
type Edge = { to: string; distance: number; name: string; wayId: string };
type Segment = {
  a: string;
  b: string;
  name: string;
  wayId: string;
  forward: boolean;
  reverse: boolean;
};
type Network = { adjacent: Map<string, Edge[]>; segments: Segment[] };
const compiled = new WeakMap<
  RoadGraph,
  Partial<Record<"walk" | "bike", Network>>
>();
function network(graph: RoadGraph, mode: "walk" | "bike") {
  const cache = compiled.get(graph) ?? {};
  if (cache[mode]) return cache[mode]!;
  const adjacent = new Map<string, Edge[]>(),
    segments: Segment[] = [];
  const inside = (p: Point) =>
    p[0] >= graph.bbox[0] &&
    p[0] <= graph.bbox[2] &&
    p[1] >= graph.bbox[1] &&
    p[1] <= graph.bbox[3];
  for (const way of graph.ways) {
    if (!permits(way.tags, mode)) continue;
    const one =
      mode === "bike"
        ? (way.tags["oneway:bicycle"] ??
          way.tags.oneway ??
          (way.tags.junction === "roundabout" ? "yes" : "no"))
        : way.tags["oneway:foot"];
    const forward = one !== "-1",
      reverse = !["yes", "1", "true"].includes(one);
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1],
        b = way.nodes[i];
      if (
        !inside(graph.nodes[a]) ||
        !inside(graph.nodes[b]) ||
        [a, b].some(
          (n) => graph.nodeTags?.[n] && !permits(graph.nodeTags[n], mode, true),
        )
      )
        continue;
      const name =
        way.tags.name ??
        (way.tags.highway === "steps" ? "台阶" : "未命名校园道路");
      const distance = meters(graph.nodes[a], graph.nodes[b]);
      segments.push({ a, b, name, wayId: way.id, forward, reverse });
      const add = (from: string, to: string) => {
        const edges = adjacent.get(from) ?? [];
        edges.push({ to, distance, name, wayId: way.id });
        adjacent.set(from, edges);
      };
      if (forward) add(a, b);
      if (reverse) add(b, a);
    }
  }
  cache[mode] = { adjacent, segments };
  compiled.set(graph, cache);
  return cache[mode]!;
}
// Project to a road segment, rather than snapping to a distant intersection.
export function project(p: Point, a: Point, b: Point) {
  const scale = Math.cos((p[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * scale,
    dy = b[0] - a[0];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[1] - a[1]) * scale * dx + (p[0] - a[0]) * dy) /
        (dx * dx + dy * dy || 1),
    ),
  );
  const point: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, t, distance: meters(p, point) };
}
class MinHeap {
  items: { id: string; cost: number }[] = [];
  push(value: { id: string; cost: number }) {
    this.items.push(value);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= value.cost) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = value;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop();
    if (!last || !this.items.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (
        child + 1 < this.items.length &&
        this.items[child + 1].cost < this.items[child].cost
      )
        child++;
      if (last.cost <= this.items[child].cost) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = last;
    return first;
  }
}
export type RoadPath = {
  points: Point[];
  distance: number;
  connectors: number;
  legs: Route["legs"];
  steps: string[];
  wayIds: string[];
};
export function findRoadPath(
  graph: RoadGraph,
  from: Point,
  to: Point,
  mode: "walk" | "bike",
): RoadPath | undefined {
  if (
    [from, to].some(
      (p) =>
        p[0] < graph.bbox[0] ||
        p[0] > graph.bbox[2] ||
        p[1] < graph.bbox[1] ||
        p[1] > graph.bbox[3],
    )
  )
    return;
  const net = network(graph, mode);
  const snap = (point: Point) => {
    let best: (ReturnType<typeof project> & { segment: Segment }) | undefined;
    for (const segment of net.segments) {
      const projection = project(
        point,
        graph.nodes[segment.a],
        graph.nodes[segment.b],
      );
      if (!best || projection.distance < best.distance)
        best = { segment, ...projection };
    }
    return best;
  };
  const start = snap(from),
    end = snap(to);
  if (!start || !end || start.distance > 120 || end.distance > 120) return;
  const extra = new Map<string, Edge[]>();
  const add = (a: string, b: string, pa: Point, pb: Point, s: Segment) => {
    const edges = extra.get(a) ?? [];
    edges.push({
      to: b,
      distance: meters(pa, pb),
      name: s.name,
      wayId: s.wayId,
    });
    extra.set(a, edges);
  };
  // Only the endpoint edges are virtual. No crossing or disconnected road is joined.
  for (const [id, s] of [
    ["start", start],
    ["end", end],
  ] as const) {
    const { segment } = s;
    if (segment.forward) {
      add(segment.a, id, graph.nodes[segment.a], s.point, segment);
      add(id, segment.b, s.point, graph.nodes[segment.b], segment);
    }
    if (segment.reverse) {
      add(segment.b, id, graph.nodes[segment.b], s.point, segment);
      add(id, segment.a, s.point, graph.nodes[segment.a], segment);
    }
  }
  if (
    start.segment.a === end.segment.a &&
    start.segment.b === end.segment.b &&
    start.segment.wayId === end.segment.wayId &&
    ((end.t >= start.t && start.segment.forward) ||
      (end.t <= start.t && start.segment.reverse))
  )
    add("start", "end", start.point, end.point, start.segment);
  const costs = new Map<string, number>([["start", 0]]),
    prev = new Map<string, { from: string; edge: Edge }>();
  const heap = new MinHeap();
  heap.push({ id: "start", cost: 0 });
  while (heap.items.length) {
    const current = heap.pop()!;
    if (current.cost !== costs.get(current.id)) continue;
    if (current.id === "end") break;
    for (const edge of [
      ...(net.adjacent.get(current.id) ?? []),
      ...(extra.get(current.id) ?? []),
    ]) {
      const cost = current.cost + edge.distance;
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost);
        prev.set(edge.to, { from: current.id, edge });
        heap.push({ id: edge.to, cost });
      }
    }
  }
  if (!costs.has("end")) return;
  const ids = ["end"],
    edges: Edge[] = [];
  let at = "end";
  while (at !== "start") {
    const p = prev.get(at)!;
    edges.unshift(p.edge);
    ids.unshift(p.from);
    at = p.from;
  }
  const roadPoints = ids.map((id) =>
    id === "start" ? start.point : id === "end" ? end.point : graph.nodes[id],
  );
  const grouped: { name: string; distance: number }[] = [];
  for (const e of edges) {
    if (grouped.at(-1)?.name === e.name) grouped.at(-1)!.distance += e.distance;
    else grouped.push({ name: e.name, distance: e.distance });
  }
  const connectors = start.distance + end.distance;
  const legs: Route["legs"] = [
    { mode: "walk", connector: true, points: [from, start.point] },
    { mode, points: roadPoints },
    { mode: "walk", connector: true, points: [end.point, to] },
  ];
  return {
    points: [from, ...roadPoints, to],
    distance: Math.round(costs.get("end")! + connectors),
    connectors,
    legs,
    steps: [
      `接入道路约 ${Math.round(start.distance)} 米（入口需核实）`,
      ...grouped
        .filter((s) => s.distance >= 1)
        .map((s) => `沿${s.name} ${Math.round(s.distance)} 米`),
      `离开道路约 ${Math.round(end.distance)} 米（入口需核实）`,
    ],
    wayIds: edges.map((e) => e.wayId),
  };
}

const pointOf = (p: { lat: number; lng: number }): Point => [p.lat, p.lng];
export function planRoadRoutes(
  origin: Place,
  destination: Place,
  graph: RoadGraph,
  lines: BusLine[] = [],
): Route[] {
  if (origin.id === destination.id) return [];
  const routes: Route[] = [];
  for (const mode of ["walk", "bike"] as const) {
    const path = findRoadPath(
      graph,
      pointOf(origin),
      pointOf(destination),
      mode,
    );
    if (!path) continue;
    const minutes = Math.max(
      1,
      Math.ceil(
        (path.distance - path.connectors) / (mode === "walk" ? 72 : 200) +
          path.connectors / 72,
      ),
    );
    routes.push({
      mode,
      title: mode === "walk" ? "全程步行" : "自行车骑行",
      minutes,
      distance: path.distance,
      cost: mode === "walk" ? "免费" : "自备车 / 自行租车",
      reason: mode === "walk" ? "沿可步行道路寻路" : "避开台阶与禁骑道路",
      segments: [
        { label: mode === "walk" ? "步行" : "骑行与接入", minutes, mode },
      ],
      points: path.points,
      legs: path.legs,
      steps: path.steps,
      affected: false,
    });
  }
  const bus = planDirectBus(origin, destination, graph, lines);
  if (bus) routes.push(bus);
  return routes;
}

// One directed ride; repeated stop names keep their original occurrence/order.
export function planDirectBus(
  origin: Place,
  destination: Place,
  graph: RoadGraph,
  lines: BusLine[],
): Route | undefined {
  const fullWalk = findRoadPath(
    graph,
    pointOf(origin),
    pointOf(destination),
    "walk",
  );
  const walking = new Map<string, RoadPath | undefined>();
  const walkTo = (
    p: Place,
    stop: BusLine["stops"][number],
    reverse: boolean,
  ) => {
    const key = `${reverse}:${p.id}:${stop.lat}:${stop.lng}`;
    if (!walking.has(key))
      walking.set(
        key,
        findRoadPath(
          graph,
          reverse ? pointOf(stop) : pointOf(p),
          reverse ? pointOf(p) : pointOf(stop),
          "walk",
        ),
      );
    return walking.get(key);
  };
  let best:
    | {
        line: BusLine;
        board: BusLine["stops"][number];
        alight: BusLine["stops"][number];
        access: RoadPath;
        egress: RoadPath;
        ride: Point[];
        rideDistance: number;
        score: number;
      }
    | undefined;
  for (const line of lines) {
    const nearest = (p: Place) =>
      [...line.stops]
        .filter((s) => meters(pointOf(p), pointOf(s)) < 900)
        .sort(
          (a, b) =>
            meters(pointOf(p), pointOf(a)) - meters(pointOf(p), pointOf(b)),
        )
        .slice(0, 3);
    // Locate consecutive stop occurrences along the official path. Out-of-order/mismatched geometry is unusable.
    let after = 0;
    const locations = new Map<
      number,
      { index: number; point: Point; offset: number }
    >();
    const offsets = [0];
    for (let i = 1; i < line.path.length; i++)
      offsets.push(offsets[i - 1] + meters(line.path[i - 1], line.path[i]));
    for (const stop of line.stops) {
      let match:
        | { index: number; point: Point; offset: number; distance: number }
        | undefined;
      for (let i = 1; i < line.path.length; i++) {
        const p = project(pointOf(stop), line.path[i - 1], line.path[i]);
        const offset = offsets[i - 1] + meters(line.path[i - 1], p.point);
        if (offset < after - 0.5) continue;
        if (!match || p.distance < match.distance)
          match = { index: i, point: p.point, offset, distance: p.distance };
      }
      if (!match || match.distance > 120) {
        locations.clear();
        break;
      }
      locations.set(stop.order, match);
      after = match.offset;
    }
    for (const board of nearest(origin))
      for (const alight of nearest(destination)) {
        if (board.order >= alight.order) continue;
        const a = locations.get(board.order),
          b = locations.get(alight.order);
        if (!a || !b || b.offset - a.offset < 150) continue;
        const access = walkTo(origin, board, false),
          egress = walkTo(destination, alight, true);
        if (
          !access ||
          !egress ||
          access.distance > 1100 ||
          egress.distance > 1100 ||
          (fullWalk && access.distance + egress.distance >= fullWalk.distance)
        )
          continue;
        // Rank access effort and ride length; no inferred bus travel or wait time.
        const score =
          access.distance + egress.distance + (b.offset - a.offset) * 0.12;
        if (!best || score < best.score)
          best = {
            line,
            board,
            alight,
            access,
            egress,
            ride: [a.point, ...line.path.slice(a.index, b.index), b.point],
            rideDistance: b.offset - a.offset,
            score,
          };
      }
  }
  if (!best) return;
  const { line, board, alight, access, egress, ride, rideDistance } = best;
  const accessMinutes = Math.ceil(access.distance / 72),
    egressMinutes = Math.ceil(egress.distance / 72);
  const legs: Route["legs"] = [
    ...access.legs,
    { mode: "walk", connector: true, points: [pointOf(board), ride[0]] },
    { mode: "bus", points: ride },
    { mode: "walk", connector: true, points: [ride.at(-1)!, pointOf(alight)] },
    ...egress.legs,
  ];
  return {
    mode: "bus",
    busLineId: line.id,
    title: "步行 + 校巴",
    minutes: null,
    distance: Math.round(
      access.distance +
        rideDistance +
        egress.distance +
        meters(pointOf(board), ride[0]) +
        meters(pointOf(alight), ride.at(-1)!),
    ),
    cost: "票价以校方为准",
    reason: `${line.name} · ${alight.order - board.order} 站 · 单程站序`,
    segments: [
      { label: "步行到站", minutes: accessMinutes, mode: "walk" },
      { label: "候车与乘车", minutes: null, mode: "bus" },
      { label: "步行到达", minutes: egressMinutes, mode: "walk" },
    ],
    points: legs.flatMap((l) => l.points),
    legs,
    steps: [
      ...access.steps,
      `在${board.name}（站次 ${board.order}）乘${line.name}，至${alight.name}（站次 ${alight.order}）下车；候车及乘车耗时未知，请查看校巴实时状态与运营时间`,
      ...egress.steps,
    ],
    affected: false,
  };
}
