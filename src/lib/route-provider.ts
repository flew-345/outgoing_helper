import type { Mode, Place, Route } from "./campus";

// Extension point: a future server-side AMap adapter normalizes its result into
// WGS84 Route objects. Keys belong on that server, never in browser bundles.
export interface RouteProvider {
  plan(
    origin: Place,
    destination: Place,
    mode: Mode,
    signal?: AbortSignal,
  ): Promise<Route | undefined>;
}

/** Forward transform matching the collector's approximate GCJ-02 inverse. */
export function wgsToGcj(lat: number, lng: number): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271)
    return [lat, lng];
  const x = lng - 105,
    y = lat - 35,
    pi = Math.PI;
  const common =
    ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  let dy =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  let dx =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dy +=
    common + ((20 * Math.sin(y * pi) + 40 * Math.sin((y * pi) / 3)) * 2) / 3;
  dy +=
    ((160 * Math.sin((y * pi) / 12) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  dx +=
    common + ((20 * Math.sin(x * pi) + 40 * Math.sin((x * pi) / 3)) * 2) / 3;
  dx +=
    ((150 * Math.sin((x * pi) / 12) + 300 * Math.sin((x * pi) / 30)) * 2) / 3;
  const rad = (lat * pi) / 180,
    ee = 0.0066934216229659433;
  const magic = 1 - ee * Math.sin(rad) ** 2;
  dy = (dy * 180) / (((6378245 * (1 - ee)) / (magic * Math.sqrt(magic))) * pi);
  dx = (dx * 180) / ((6378245 / Math.sqrt(magic)) * Math.cos(rad) * pi);
  return [lat + dy, lng + dx];
}
export function amapNavigationUrl(
  from: Place,
  to: Place,
  mode: "walk" | "bike",
) {
  const encodePoint = (p: Place) => {
    const [lat, lng] = wgsToGcj(p.lat, p.lng);
    return `${lng.toFixed(6)},${lat.toFixed(6)},${p.name}`;
  };
  const url = new URL("https://uri.amap.com/navigation");
  url.search = new URLSearchParams({
    from: encodePoint(from),
    to: encodePoint(to),
    mode: mode === "bike" ? "ride" : "walk",
    src: "luojia-transit",
    callnative: "1",
  }).toString();
  return url.toString();
}
