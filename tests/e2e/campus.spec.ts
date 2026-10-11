import { expect, test } from "@playwright/test";

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
  await expect(page.locator(".bus-stop")).toHaveCount(6);
  await expect(page.locator(".bus-arrival")).toContainText("模拟到站");
  await page.getByRole("button", { name: "站点", exact: true }).click();
  await expect(page.locator(".bus-stop small").first()).toBeVisible();
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
