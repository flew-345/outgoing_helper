"use client";

import { useEffect, useState } from "react";

export type BusStop = {
  occurrenceId: string;
  sourceStopId: string;
  order: number;
  name: string;
  area: string;
  aliases: string[];
  lat: number;
  lng: number;
  sourceLat: number;
  sourceLng: number;
};
export type BusVehicle = {
  id: string;
  lineId: string;
  stopOrder: number;
  arrivalState: string;
  lat: number;
  lng: number;
  sourceLat: number;
  sourceLng: number;
  rawFields: string[];
};
export type BusLine = {
  id: string;
  name: string;
  direction: number;
  returnLineId: string | null;
  firstTime: string;
  lastTime: string;
  priceRaw: string;
  stops: BusStop[];
  path: [number, number][];
  vehiclesFetchedAt: string | null;
  vehicleStatus: "fresh" | "stale" | "unavailable";
  vehicles: BusVehicle[];
  warnings: string[];
  timetable: { time: string; from: string; to: string }[];
  rawMetadata: Record<string, unknown>;
};
export type TransitSnapshot = {
  schemaVersion: 1;
  source: "bus.whu.edu.cn";
  fetchedAt: string;
  coordinateSystem: "amap-gcj02-inferred";
  displayCoordinateSystem: "wgs84-approximate";
  lines: BusLine[];
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown) => Array.isArray(value) && value.every(text);
const time = (value: unknown) =>
  text(value) &&
  /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const integer = (value: unknown) =>
  Number.isInteger(value) && Number(value) > 0;
const coordinates = (value: Record<string, unknown>, source = false) => {
  const lat = value[source ? "sourceLat" : "lat"];
  const lng = value[source ? "sourceLng" : "lng"];
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180
  );
};

/** Reject malformed snapshots before they reach the map or station arithmetic. */
export function parseTransitSnapshot(value: unknown): TransitSnapshot {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.source !== "bus.whu.edu.cn" ||
    value.coordinateSystem !== "amap-gcj02-inferred" ||
    value.displayCoordinateSystem !== "wgs84-approximate" ||
    !time(value.fetchedAt) ||
    !Array.isArray(value.lines) ||
    value.lines.length === 0
  )
    throw new Error("校巴数据格式不兼容");
  const lineIds = new Set<string>();
  for (const line of value.lines) {
    if (
      !object(line) ||
      !text(line.id) ||
      !line.id ||
      lineIds.has(line.id) ||
      !text(line.name) ||
      !Number.isInteger(line.direction) ||
      !(line.returnLineId === null || text(line.returnLineId)) ||
      !text(line.firstTime) ||
      !text(line.lastTime) ||
      !text(line.priceRaw) ||
      !Array.isArray(line.stops) ||
      !line.stops.length ||
      !Array.isArray(line.path) ||
      !(line.vehiclesFetchedAt === null || time(line.vehiclesFetchedAt)) ||
      !["fresh", "stale", "unavailable"].includes(String(line.vehicleStatus)) ||
      !Array.isArray(line.vehicles) ||
      !strings(line.warnings) ||
      !Array.isArray(line.timetable) ||
      !object(line.rawMetadata)
    )
      throw new Error("校巴线路字段不完整");
    lineIds.add(line.id);
    const orders = new Set<number>();
    for (const stop of line.stops) {
      if (
        !object(stop) ||
        !integer(stop.order) ||
        orders.has(Number(stop.order)) ||
        stop.occurrenceId !== `${line.id}:${stop.order}` ||
        !text(stop.sourceStopId) ||
        !text(stop.name) ||
        !text(stop.area) ||
        !strings(stop.aliases) ||
        !coordinates(stop) ||
        !coordinates(stop, true)
      )
        throw new Error("校巴站次字段无效");
      orders.add(Number(stop.order));
    }
    if (line.stops.some((stop, i) => stop.order !== i + 1))
      throw new Error("校巴站次顺序无效");
    for (const point of line.path) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !coordinates({ lat: point[0], lng: point[1] })
      )
        throw new Error("校巴轨迹坐标无效");
    }
    const vehicleIds = new Set<string>();
    for (const vehicle of line.vehicles) {
      if (
        !object(vehicle) ||
        !text(vehicle.id) ||
        vehicleIds.has(vehicle.id) ||
        vehicle.lineId !== line.id ||
        !integer(vehicle.stopOrder) ||
        !orders.has(Number(vehicle.stopOrder)) ||
        !text(vehicle.arrivalState) ||
        !coordinates(vehicle) ||
        !coordinates(vehicle, true) ||
        !strings(vehicle.rawFields)
      )
        throw new Error("校巴车辆字段无效");
      vehicleIds.add(vehicle.id);
    }
    if (
      line.timetable.some(
        (entry) =>
          !object(entry) ||
          !text(entry.time) ||
          !text(entry.from) ||
          !text(entry.to),
      )
    )
      throw new Error("校巴时刻表字段无效");
  }
  return value as TransitSnapshot;
}

export function vehicleFreshness(
  snapshot: TransitSnapshot | null,
  line: BusLine | undefined,
  now = Date.now(),
  failed = false,
): "fresh" | "stale" | "unavailable" {
  if (
    !snapshot ||
    !line ||
    line.vehicleStatus === "unavailable" ||
    !line.vehiclesFetchedAt
  )
    return "unavailable";
  const age =
    now -
    Math.min(
      Date.parse(snapshot.fetchedAt),
      Date.parse(line.vehiclesFetchedAt),
    );
  return !failed &&
    line.vehicleStatus === "fresh" &&
    age >= -30000 &&
    age <= 30000
    ? "fresh"
    : "stale";
}

/** Follow the H5 response order; do not invent a next loop or ETA minutes. */
export function arrivalsAt(
  line: BusLine,
  targetOrder: number,
): { vehicle: BusVehicle; label: string }[] {
  if (!line.stops.some((stop) => stop.order === targetOrder)) return [];
  return line.vehicles
    .filter(
      (vehicle) =>
        ["0", "1"].includes(vehicle.arrivalState) &&
        2 * (vehicle.stopOrder - 1) - 1 + Number(vehicle.arrivalState) <=
          2 * (targetOrder - 1),
    )
    .slice(-2)
    .reverse()
    .map((vehicle) => ({
      vehicle,
      label:
        targetOrder === vehicle.stopOrder
          ? vehicle.arrivalState === "0"
            ? "即将到站"
            : "已到站"
          : `${targetOrder - vehicle.stopOrder} 站后`,
    }));
}

export function normalizeFeedUrl(value: string): string {
  const url = value.trim() || "/data/whu-bus.json";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  const parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("请输入 HTTP 或 HTTPS 数据地址");
  return parsed.href;
}

export function useTransitFeed() {
  const [url, setUrl] = useState("/data/whu-bus.json");
  const [state, setState] = useState<{
    snapshot: TransitSnapshot | null;
    error: string;
    loading: boolean;
    now: number;
  }>({
    snapshot: null,
    error: "",
    loading: true,
    now: Date.now(),
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem("luojia-transit-feed-url");
      if (saved) setUrl(normalizeFeedUrl(saved));
    } catch {
      /* Use the bundled snapshot if browser storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    setState({ snapshot: null, error: "", loading: true, now: Date.now() });
    async function refresh() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`数据服务返回 ${response.status}`);
        const snapshot = parseTransitSnapshot(await response.json());
        if (!stopped)
          setState({ snapshot, error: "", loading: false, now: Date.now() });
      } catch (error) {
        if (!stopped)
          setState((previous) => ({
            ...previous,
            loading: false,
            now: Date.now(),
            error:
              error instanceof Error ? error.message : "校巴数据暂时无法读取",
          }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(refresh, 10000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [url]);
  function configure(value: string) {
    const next = normalizeFeedUrl(value);
    try {
      localStorage.setItem("luojia-transit-feed-url", next);
    } catch {
      /* Session-only configuration. */
    }
    setUrl(next);
  }
  return { ...state, url, configure };
}
