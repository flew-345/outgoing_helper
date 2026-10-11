import { expect, it } from "vitest";
import busData from "../../public/data/whu-bus.json";
import { amapNavigationUrl, wgsToGcj } from "../../src/lib/route-provider";
import { places } from "../../src/lib/campus";

it("converts WGS84 back to the collector's source coordinates before an AMap jump", () => {
  const stop = busData.lines[0].stops[0];
  const [lat, lng] = wgsToGcj(stop.lat, stop.lng);
  expect(lat).toBeCloseTo(stop.sourceLat, 6);
  expect(lng).toBeCloseTo(stop.sourceLng, 6);
  expect(wgsToGcj(51, -0.1)).toEqual([51, -0.1]);
});
it("encodes endpoint names safely and selects the documented walk/ride mode", () => {
  const from = { ...places[0], name: "a&b,起点" };
  const url = new URL(amapNavigationUrl(from, places[1], "bike"));
  expect(url.origin).toBe("https://uri.amap.com");
  expect(url.searchParams.get("mode")).toBe("ride");
  expect(url.searchParams.get("from")).toContain("a&b,起点");
  expect(url.searchParams.has("key")).toBe(false);
  expect(
    new URL(amapNavigationUrl(from, places[1], "walk")).searchParams.get(
      "mode",
    ),
  ).toBe("walk");
});
