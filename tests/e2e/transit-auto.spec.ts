import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { TransitSnapshot } from "../../src/lib/bus";

function snapshot(): TransitSnapshot {
  const value: TransitSnapshot = JSON.parse(
    readFileSync(
      new URL("../../public/data/whu-bus.json", import.meta.url),
      "utf8",
    ),
  );
  value.fetchedAt = new Date().toISOString();
  for (const line of value.lines) {
    line.vehiclesFetchedAt = value.fetchedAt;
    line.vehicleStatus = "fresh";
    line.warnings = [];
  }
  return value;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("luojia-authenticated", "true"),
  );
});

test("automatically connects and refreshes without a live link or manual feed settings", async ({
  page,
}) => {
  let requests = 0;
  let snapshotRequests = 0;
  await page.route("**/api/transit", (route) => {
    requests++;
    return route.fulfill({ json: snapshot() });
  });
  await page.route("**/data/whu-bus.json", (route) => {
    snapshotRequests++;
    return route.fulfill({ status: 500 });
  });
  await page.clock.install();
  await page.goto("/?view=bus");
  await expect(page.locator(".demo-status")).toHaveText("校巴实采");
  await expect(page.locator(".bus-stop")).toHaveCount(20);
  await page.clock.fastForward(11_000);
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  expect(snapshotRequests).toBe(0);
});

test("allows a slow first upstream connection to finish before the browser timeout", async ({
  page,
}) => {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/transit", async (route) => {
    requested = true;
    await ready;
    await route.fulfill({ json: snapshot() });
  });
  await page.clock.install();
  await page.goto("/?view=bus");
  await expect.poll(() => requested).toBe(true);
  await page.clock.fastForward(21_000);
  release();
  await expect(page.locator(".demo-status")).toHaveText("校巴实采");
  await expect(page.locator(".bus-stop")).toHaveCount(20);
});

test("recovers after a cold failure and preserves successful data during later failures", async ({
  page,
}) => {
  let fail = true;
  const data = snapshot();
  await page.route("**/api/transit", (route) =>
    fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: data }),
  );
  await page.clock.install();
  await page.goto("/?view=bus");
  await expect(page.locator(".demo-status")).toHaveText("校巴未连接");
  await expect(page.locator(".bus-stop")).toHaveCount(0);
  fail = false;
  await page.clock.fastForward(11_000);
  await expect(page.locator(".demo-status")).toHaveText("校巴实采");
  fail = true;
  await page.clock.fastForward(11_000);
  await expect(page.locator(".demo-status")).toHaveText("历史快照");
  await expect(page.locator(".bus-stop")).toHaveCount(20);
  await expect(page.locator(".bus-warning")).toContainText("503");
});

test("moves a previously selected bundled snapshot to the automatic endpoint", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("luojia-transit-feed-url", "/data/whu-bus.json"),
  );
  await page.route("**/api/transit", (route) =>
    route.fulfill({ json: snapshot() }),
  );
  await page.goto("/?view=bus");
  await expect(page.locator(".demo-status")).toHaveText("校巴实采");
});
