import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import {
  createPreviewServer,
  listenPreview,
} from "../../scripts/preview-server.mjs";

const directories: string[] = [];
const servers: Server[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "luojia-preview-test-"));
  directories.push(directory);
  const site = join(directory, "site");
  await mkdir(join(site, "_next"), { recursive: true });
  await writeFile(join(site, "index.html"), "<h1>珞珈畅行</h1>");
  await writeFile(join(site, "_next", "app.js"), "window.preview = true;");
  await writeFile(join(site, "中文说明.txt"), "预览说明");
  await writeFile(join(directory, "private.txt"), "outside-root");
  const server = createPreviewServer(site);
  servers.push(server);
  return { site, server, url: await listenPreview(server, 0) };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("portable preview server", () => {
  it("serves UTF-8 HTML, JS, query strings and encoded filenames", async () => {
    const { url } = await fixture();
    const html = await fetch(`${url}/?preview=1`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await html.text()).toContain("珞珈畅行");
    const js = await fetch(`${url}/_next/app.js?v=1`);
    expect(js.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(await js.text()).toBe("window.preview = true;");
    const note = await fetch(`${url}/${encodeURIComponent("中文说明.txt")}`);
    expect(await note.text()).toBe("预览说明");
  });
  it("supports HEAD, missing resources and unsupported methods", async () => {
    const { url } = await fixture();
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
    expect(await head.text()).toBe("");
    expect((await fetch(`${url}/missing.js`)).status).toBe(404);
    const post = await fetch(url, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
  it("rejects malformed paths and access outside the published directory", async () => {
    const { url } = await fixture();
    expect((await fetch(`${url}/%ZZ`)).status).toBe(400);
    expect((await fetch(`${url}/%00`)).status).toBe(400);
    const escape = await fetch(`${url}/..%2fprivate.txt`);
    expect(escape.status).toBe(403);
    expect(await escape.text()).not.toContain("outside-root");
  });
  it("chooses another loopback port when the preferred one is occupied", async () => {
    const first = await fixture();
    const second = createPreviewServer(first.site);
    servers.push(second);
    const address = first.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server address");
    const next = await listenPreview(second, address.port);
    expect(next).not.toBe(first.url);
    expect((await fetch(next)).status).toBe(200);
    expect(second.address()).toMatchObject({ address: "127.0.0.1" });
  });
});
