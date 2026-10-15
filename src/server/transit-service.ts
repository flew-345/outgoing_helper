import type { BusLine, BusVehicle, TransitSnapshot } from "../lib/bus";
import { wgsToGcj } from "../lib/route-provider";
import timetables from "../../scripts/transit/timetables.json";
import {
  createUpstreamClient,
  LINE_IDS,
  type TransitClient,
} from "./transit-upstream";

type CollectedLine = BusLine & { metadataFetchedAt: string };
export type CollectedSnapshot = Omit<TransitSnapshot, "lines"> & {
  lines: CollectedLine[];
  errors: string[];
};
export interface SnapshotStore {
  read(): Promise<CollectedSnapshot | undefined>;
  write(value: CollectedSnapshot): Promise<void>;
}
const METADATA_TTL = 6 * 60 * 60 * 1000;
const REFRESH_INTERVAL = 10_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("校巴响应格式无效");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("校巴文本字段无效");
  return value;
}
function number(value: unknown): number {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    value === "" ||
    !Number.isFinite(Number(value))
  )
    throw new Error("校巴数字字段无效");
  return Number(value);
}
export function gcjToWgs(lat: number, lng: number): [number, number] {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw new Error("校巴坐标无效");
  let result: [number, number] = [lat, lng];
  for (let i = 0; i < 5; i++) {
    const projected = wgsToGcj(...result);
    result = [
      lat - (projected[0] - result[0]),
      lng - (projected[1] - result[1]),
    ];
  }
  return result;
}
function normalizeLine(
  id: string,
  metadata: unknown,
  pathData: unknown,
  now: number,
): CollectedLine {
  const raw = record(metadata);
  if (!Array.isArray(raw.stops) || !raw.stops.length)
    throw new Error("校巴站点缺失");
  const stops = raw.stops.map((value, i) => {
    const stop = record(value);
    const order = number(stop.stopOrder);
    if (order !== i + 1) throw new Error("校巴站次顺序无效");
    const sourceLat = number(stop.lat),
      sourceLng = number(stop.lng);
    const [lat, lng] = gcjToWgs(sourceLat, sourceLng);
    return {
      occurrenceId: `${id}:${order}`,
      sourceStopId: String(stop.stopId ?? ""),
      order,
      name: text(stop.stopName),
      area: "校园校巴",
      aliases: [],
      lat,
      lng,
      sourceLat,
      sourceLng,
    };
  });
  const pathRaw =
    typeof pathData === "string" ? pathData : text(record(pathData).path);
  const path = pathRaw
    .split(";")
    .filter(Boolean)
    .map((point) => {
      const pair = point.split(",");
      if (pair.length !== 2) throw new Error("校巴轨迹格式无效");
      return gcjToWgs(number(pair[0]), number(pair[1]));
    });
  const direction = number(raw.direction);
  if (!Number.isInteger(direction)) throw new Error("校巴方向无效");
  const warnings = [
    "上游未声明坐标系；按高德 GCJ-02 推断并近似转换，保留原始坐标。",
  ];
  if (id.startsWith("10486-56-"))
    warnings.push(
      "5 号线接口运营时间与官方 H5 内置时刻表不一致，时刻表尚未经运营方确认。",
    );
  return {
    id,
    name: text(raw.lineName),
    direction,
    returnLineId: raw.line2Id ? text(raw.line2Id) : null,
    firstTime: text(raw.firstTime ?? ""),
    lastTime: text(raw.lastTime ?? ""),
    priceRaw: String(raw.price ?? ""),
    stops,
    path,
    metadataFetchedAt: new Date(now).toISOString(),
    vehiclesFetchedAt: null,
    vehicleStatus: "unavailable",
    vehicles: [],
    warnings,
    timetable:
      ((timetables as Record<string, unknown>)[id] as BusLine["timetable"]) ??
      [],
    rawMetadata: Object.fromEntries(
      Object.entries(raw).filter(
        ([key]) => !["stops", "bus", "buses"].includes(key),
      ),
    ),
  };
}
function normalizeVehicles(line: BusLine, values: string[]): BusVehicle[] {
  const ids = new Set<string>();
  return values.map((value) => {
    const fields = value.split("|");
    const [id, , order, arrivalState, longitude, latitude] = fields;
    const stopOrder = number(order);
    if (
      fields.length < 6 ||
      !id ||
      ids.has(id) ||
      !Number.isInteger(stopOrder) ||
      stopOrder < 1 ||
      stopOrder > line.stops.length ||
      !["0", "1"].includes(arrivalState)
    )
      throw new Error("校巴车辆站次或状态无效");
    ids.add(id);
    const sourceLat = number(latitude),
      sourceLng = number(longitude);
    const [lat, lng] = gcjToWgs(sourceLat, sourceLng);
    return {
      id,
      lineId: line.id,
      stopOrder,
      arrivalState,
      lat,
      lng,
      sourceLat,
      sourceLng,
      rawFields: fields,
    };
  });
}

/** Coalesce refreshes and retain original successful timestamps on upstream failures. */
export function createTransitService(
  client: TransitClient = createUpstreamClient(),
  clock = Date.now,
) {
  let snapshot: CollectedSnapshot | undefined;
  let refreshedAt = -Infinity;
  let pending: Promise<CollectedSnapshot> | undefined;
  async function refresh(store?: SnapshotStore) {
    const now = clock();
    const shared = await store?.read().catch(() => undefined);
    if (
      shared &&
      (!snapshot ||
        Date.parse(shared.fetchedAt) > Date.parse(snapshot.fetchedAt))
    )
      snapshot = shared;
    if (
      snapshot &&
      now - Date.parse(snapshot.fetchedAt) >= 0 &&
      now - Date.parse(snapshot.fetchedAt) < REFRESH_INTERVAL
    ) {
      refreshedAt = Date.parse(snapshot.fetchedAt);
      return snapshot;
    }
    const signal = AbortSignal.timeout(20_000);
    const errors: string[] = [];
    const lines = await Promise.all(
      LINE_IDS.map(async (id) => {
        const previous = snapshot?.lines.find((line) => line.id === id);
        let line = previous ? structuredClone(previous) : undefined;
        if (line)
          line.warnings = line.warnings.filter(
            (warning) => !/^(站点\/轨迹|车辆)更新失败：/.test(warning),
          );
        try {
          const age = now - Date.parse(line?.metadataFetchedAt ?? "");
          if (
            !line ||
            !Number.isFinite(age) ||
            age < 0 ||
            age >= METADATA_TTL
          ) {
            const [metadata, path] = await Promise.all([
              client.stations(id, signal),
              client.path(id, signal),
            ]);
            line = normalizeLine(id, metadata, path, clock());
            if (previous) {
              line.vehicles = previous.vehicles;
              line.vehiclesFetchedAt = previous.vehiclesFetchedAt;
            }
          }
        } catch (error) {
          console.warn(
            "Transit metadata unavailable",
            id,
            error instanceof Error ? error.message : "unknown",
          );
          errors.push(`${id} 站点/轨迹更新失败`);
          line?.warnings.push("站点/轨迹更新失败：暂用上次成功读取的线路。");
        }
        if (!line) return undefined;
        try {
          line.vehicles = normalizeVehicles(
            line,
            await client.vehicles(id, signal),
          );
          line.vehiclesFetchedAt = new Date(clock()).toISOString();
          line.vehicleStatus = "fresh";
        } catch (error) {
          console.warn(
            "Transit vehicles unavailable",
            id,
            error instanceof Error ? error.message : "unknown",
          );
          errors.push(`${id} 车辆更新失败`);
          line.vehicleStatus = line.vehiclesFetchedAt ? "stale" : "unavailable";
          line.warnings.push(
            "车辆更新失败：校方服务暂时无法读取，稍后自动重试。",
          );
        }
        return line;
      }),
    );
    const usable = lines.filter((line): line is CollectedLine => Boolean(line));
    refreshedAt = clock();
    if (!usable.length) throw new Error("校方校巴数据暂时无法读取，请稍后重试");
    snapshot = {
      schemaVersion: 1,
      source: "bus.whu.edu.cn",
      fetchedAt: new Date(clock()).toISOString(),
      coordinateSystem: "amap-gcj02-inferred",
      displayCoordinateSystem: "wgs84-approximate",
      lines: usable,
      errors,
    };
    await store?.write(snapshot).catch(() => undefined);
    return snapshot;
  }
  return {
    async getSnapshot(store?: SnapshotStore) {
      if (clock() - refreshedAt < REFRESH_INTERVAL) {
        if (snapshot) return structuredClone(snapshot);
        throw new Error("校方校巴数据暂时无法读取，请稍后重试");
      }
      pending ??= refresh(store).finally(() => {
        pending = undefined;
      });
      return structuredClone(await pending);
    },
  };
}
