import { expect, test } from "@playwright/test";
import type { TransitSnapshot } from "../../src/lib/bus";

function transitFixture(): TransitSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    source: "bus.whu.edu.cn",
    fetchedAt: now,
    coordinateSystem: "amap-gcj02-inferred",
    displayCoordinateSystem: "wgs84-approximate",
    lines: [
      ["10486-50-0", "1号线", 20],
      ["10486-55-0", "2号线", 15],
      ["10486-56-0", "5号线", 5],
      ["10486-56-1", "5号线返向", 5],
    ].map(([rawId, rawName, rawCount]) => {
      const id = String(rawId);
      const count = Number(rawCount);
      return {
        id,
        name: String(rawName),
        direction: id.endsWith("-1") ? 1 : 0,
        returnLineId: id === "10486-56-0" ? "10486-56-1" : null,
        firstTime: "07:20",
        lastTime: "22:40",
        priceRaw: "1.0~2.0",
        stops: Array.from({ length: count }, (_, i) => ({
          occurrenceId: `${id}:${i + 1}`,
          sourceStopId: String(i + 1),
          order: i + 1,
          name:
            i === 14
              ? "田园食堂"
              : i === 0 || i === count - 1
                ? "珞珈门"
                : `校巴站${i + 1}`,
          area: "校园校巴",
          aliases: [],
          lat: 30.53 + i * 0.0005,
          lng: 114.36,
          sourceLat: 30.53 + i * 0.0005,
          sourceLng: 114.36,
        })),
        path: [
          [30.53, 114.36],
          [30.54, 114.36],
        ],
        vehiclesFetchedAt: now,
        vehicleStatus: "fresh",
        vehicles:
          id === "10486-50-0"
            ? [4, 9, 16].map((stopOrder) => ({
                id: `vehicle-${stopOrder}`,
                lineId: id,
                stopOrder,
                arrivalState: "0",
                lat: 30.53 + stopOrder * 0.0005,
                lng: 114.36,
                sourceLat: 30.53 + stopOrder * 0.0005,
                sourceLng: 114.36,
                rawFields: [],
              }))
            : [],
        warnings: [],
        timetable: [],
        rawMetadata: {},
      };
    }),
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/data/whu-bus.json", (route) =>
    route.fulfill({ json: transitFixture() }),
  );
});

test("renders the campus workspace and switches transport details", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "下一站，去哪里？" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /全程步行/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: /共享电动车路程|共享电动车预计|共享电动车/ })
    .click();
  await expect(
    page.getByRole("button", { name: /共享电动车/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByLabel("道路管制区域", { exact: true }).uncheck();
  await expect(page.locator(".map-alert")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭图层" }).click();
  if (test.info().project.name === "desktop") {
    const bike = await page
      .getByRole("button", { name: /共享电动车/ })
      .boundingBox();
    expect((bike?.y ?? 0) + (bike?.height ?? 0)).toBeLessThan(1000);
  }
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((el) => el.clientWidth),
  );
  expect(errors).toEqual([]);
});

test("searches aliases, plans a route and swaps endpoints", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "目的地" }).fill("樱顶");
  await page.getByRole("option", { name: /樱顶老图书馆/ }).click();
  await page.getByRole("button", { name: "查找路线" }).click();
  await expect(page.locator(".journey-detail")).toContainText("樱顶老图书馆");
  await expect(page.locator(".journey-detail")).toContainText(
    "已按演示施工记录调整路线",
  );
  await page.getByRole("button", { name: "交换起点与终点" }).click();
  await expect(page.getByRole("combobox", { name: "出发地" })).toHaveValue(
    "樱顶老图书馆",
  );
  await expect(page.getByRole("combobox", { name: "目的地" })).toHaveValue(
    "桂园宿舍",
  );
  await page.getByRole("button", { name: "查找路线" }).click();
  await expect(page.locator(".detail-place-names strong").first()).toHaveText(
    "樱顶老图书馆",
  );
});

test("persists favorites and explains unavailable live data", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "收藏终点", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "取消收藏终点", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "数据说明", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("实时状态不可用");
  await expect(page.getByRole("dialog")).toContainText("2026-10-10 09:30");
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("navigates bus and filtered notices, then plans from an incident", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "校园校巴", exact: true }).click();
  await expect(page.locator(".bus-stop")).toHaveCount(20);
  await page.getByRole("combobox", { name: "校巴目标站次" }).selectOption("15");
  await expect(page.locator(".bus-arrival")).toContainText("6 站后");
  await expect(page.locator(".bus-arrival")).toContainText("11 站后");
  await expect(page.locator(".bus-arrival")).not.toContainText("模拟到站");
  await page.getByRole("button", { name: "站点", exact: true }).click();
  await expect(page.locator(".bus-stop small").first()).toBeVisible();
  await page
    .getByRole("combobox", { name: "校巴线路与方向" })
    .selectOption("10486-56-1");
  await expect(page.locator(".bus-stop")).toHaveCount(5);
  await expect(page.locator(".bus-arrival")).toContainText("本次响应无车辆");
  await page.getByRole("button", { name: "出行公告", exact: true }).click();
  await page.getByRole("button", { name: "限行", exact: true }).click();
  await expect(page.locator(".notice-item")).toHaveCount(1);
  await page.getByRole("button", { name: /工学部活动临时限行/ }).click();
  await page.getByRole("button", { name: "规划前往此处的路线" }).click();
  await expect(
    page.getByRole("heading", { name: "下一站，去哪里？" }),
  ).toBeVisible();
  await expect(page.locator(".journey-detail")).toContainText("工学部教学楼");
});

test("marks old snapshots stale and keeps last good data after a failed refresh", async ({
  page,
}) => {
  const fixture = transitFixture();
  fixture.fetchedAt = new Date(Date.now() - 120000).toISOString();
  for (const line of fixture.lines) line.vehiclesFetchedAt = fixture.fetchedAt;
  let failRefresh = false;
  await page.route("**/data/whu-bus.json", (route) =>
    failRefresh
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: fixture }),
  );
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "校园校巴", exact: true }).click();
  await expect(page.locator(".source-line")).toContainText("已过期");
  failRefresh = true;
  await page.clock.fastForward(11000);
  await expect(page.locator(".bus-warning")).toContainText("503");
  await expect(page.locator(".bus-stop")).toHaveCount(20);
  await expect(page.locator(".source-line")).toContainText("历史快照");
});

test("shows unavailable data without simulated buses when import fails", async ({
  page,
}) => {
  await page.route("**/data/whu-bus.json", (route) =>
    route.fulfill({ json: { schemaVersion: 999 } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "校园校巴", exact: true }).click();
  await expect(page.locator(".bus-empty")).toContainText("实时状态不可用");
  await expect(page.locator(".bus-stop")).toHaveCount(0);
  await expect(page.locator(".bus-marker")).toHaveCount(0);
});

test("loads a configured data service and preserves the setting", async ({
  page,
}) => {
  let requests = 0;
  await page.route("http://127.0.0.1:8766/api/transit", (route) => {
    requests++;
    return route.fulfill({ json: transitFixture() });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "数据说明", exact: true }).click();
  await page
    .getByLabel("校巴数据地址")
    .fill("http://127.0.0.1:8766/api/transit");
  await page.getByRole("button", { name: "应用数据地址" }).click();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await page.reload();
  await expect.poll(() => requests).toBeGreaterThan(1);
  await page.getByRole("button", { name: "校园校巴", exact: true }).click();
  await expect(page.locator(".bus-stop")).toHaveCount(20);
});

test("preserves the map zoom when the same line refreshes vehicles", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/data/whu-bus.json", (route) => {
    requests++;
    return route.fulfill({ json: transitFixture() });
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "校园校巴", exact: true }).click();
  await expect(page.locator(".bus-stop")).toHaveCount(20);
  await expect(page.locator(".leaflet-proxy")).toHaveCount(1);
  await page.getByRole("button", { name: "放大地图", exact: true }).click();
  await page.clock.runFor(1000);
  const transform = await page.locator(".leaflet-proxy").getAttribute("style");
  await page.clock.fastForward(11000);
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(page.locator(".leaflet-proxy")).toHaveAttribute(
    "style",
    transform!,
  );
});

test("answers a local journey query with provenance", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开出行问答" }).click();
  await page
    .getByRole("textbox", { name: "出行问题" })
    .fill("从桂园到总图书馆怎么走");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.locator(".chat-message.assistant")).toContainText(
    "来源：本地演示数据",
  );
  await expect(page.locator(".chat-message.assistant")).toContainText(
    "状态尚未接入",
  );
  await page.getByRole("button", { name: "关闭出行问答" }).click();
  await expect(page.locator(".journey-detail")).toContainText("总图书馆");
});

test("captures a complete desktop or mobile UI preview", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect
    .poll(
      () =>
        page
          .locator(".leaflet-tile")
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every(
                (image) =>
                  image instanceof HTMLImageElement &&
                  image.complete &&
                  image.naturalWidth === 256,
              ),
          ),
      {
        timeout: 45000,
      },
    )
    .toBe(true);
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: `artifacts/ui-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "校园校巴", exact: true }).click();
  await page.getByRole("combobox", { name: "校巴目标站次" }).selectOption("15");
  await expect(page.locator(".bus-arrival")).toContainText("6 站后");
  await page.evaluate(() => {
    const label = document.createElement("div");
    label.textContent = "自动化测试数据 · 非实时校巴快照";
    label.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;background:#fff1c7;color:#5b4014;padding:8px;text-align:center;z-index:99999;font-size:12px";
    document.body.append(label);
  });
  await page.screenshot({
    path: `artifacts/bus-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const bounds = await page.locator(".map-surface").boundingBox();
  expect(bounds?.width).toBeGreaterThan(280);
  expect(bounds?.height).toBeGreaterThan(350);
});

test("selects a place by keyboard and rejects an identical endpoint", async ({
  page,
}) => {
  await page.goto("/");
  const destination = page.getByRole("combobox", { name: "目的地" });
  await destination.fill("桂园");
  await destination.press("Enter");
  await expect(destination).toHaveValue("桂园宿舍");
  await page.getByRole("button", { name: "查找路线" }).click();
  await expect(page.getByRole("status")).toContainText("起点和终点相同");
  await expect(page.locator(".journey-detail")).toContainText("第一教学楼");
});

test("keeps modal focus inside and restores it on Escape", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "数据说明", exact: true });
  await trigger.click();
  const close = page.getByRole("button", { name: "关闭数据说明" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "知道了" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("displays an explicit fallback when map tiles cannot load", async ({
  page,
}) => {
  await page.route("**/MapServer/tile/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".map-error")).toContainText(
    "地图底图暂时无法加载",
  );
  await expect(page.getByRole("button", { name: "查找路线" })).toBeEnabled();
  await expect(page.locator(".endpoint-marker")).toHaveCount(2);
});

test("offers a manual fallback when location permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (reason: unknown) => void,
        ) => error({ code: 1 }),
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "定位当前位置" }).click();
  await expect(page.getByRole("status")).toContainText("浏览器定位权限");
  await expect(
    page.getByRole("button", { name: "定位当前位置" }),
  ).toBeEnabled();
});

test("switches between a real street basemap and satellite imagery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "地图图层", exact: true }).click();
  await page.getByRole("radio", { name: "卫星影像" }).check();
  await expect(page.locator(".leaflet-tile").first()).toHaveAttribute(
    "src",
    /World_Imagery/,
  );
  await page.getByRole("radio", { name: "浅色底图" }).check();
  await expect(page.locator(".leaflet-tile").first()).toHaveAttribute(
    "src",
    /World_Light_Gray_Base/,
  );
});
