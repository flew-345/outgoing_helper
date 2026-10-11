import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import {
  archiveFiles,
  collectSourceFiles,
  safeSourcePath,
} from "../../scripts/package-team.mjs";

describe("team package contents", () => {
  it("omits secrets, build output, dependencies and logs", () => {
    for (const path of [
      ".env",
      "src/.env.local",
      "node_modules/react/index.js",
      "src/node_modules/a.js",
      ".git/config",
      "out/index.html",
      "test-results/trace.zip",
      "artifacts/dev.log",
      "tsconfig.tsbuildinfo",
      "scripts/transit/__pycache__/collector.cpython-313.pyc",
      "scripts/transit/collector.pyc",
    ])
      expect(safeSourcePath(path)).toBe(false);
    expect(safeSourcePath(".env.example")).toBe(true);
    expect(safeSourcePath("src/app/page.tsx")).toBe(true);
  });
  it("creates a valid ZIP that preserves Chinese paths and bytes", () => {
    const content = new TextEncoder().encode("珞珈畅行团队预览");
    const decoded = unzipSync(
      archiveFiles({ "docs/中文说明.md": content }, "team"),
    );
    expect(strFromU8(decoded["team/docs/中文说明.md"])).toBe(
      "珞珈畅行团队预览",
    );
    expect(() => archiveFiles({}, "../unsafe")).toThrow(
      "Invalid archive folder",
    );
  });
  it("collects source and handoff files without generated artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "luojia-source-test-"));
    try {
      await mkdir(join(directory, "src"));
      await mkdir(join(directory, "artifacts"));
      await mkdir(join(directory, "node_modules"));
      await mkdir(join(directory, "public", "data"), { recursive: true });
      await writeFile(join(directory, "public", "data", "whu-bus.json"), "{}");
      await writeFile(join(directory, "README.md"), "team");
      await writeFile(join(directory, "src", "page.tsx"), "export default 1;");
      await writeFile(join(directory, "src", ".env.local"), "do-not-ship");
      await writeFile(
        join(directory, "artifacts", "ui-desktop.png"),
        "preview-image",
      );
      await writeFile(
        join(directory, "artifacts", "bus-mobile.png"),
        "bus-preview-image",
      );
      await writeFile(
        join(directory, "artifacts", "dev-server.log"),
        "do-not-ship",
      );
      await writeFile(
        join(directory, "node_modules", "dependency.js"),
        "do-not-ship",
      );
      const files = await collectSourceFiles(directory);
      expect(Object.keys(files).sort()).toEqual([
        "README.md",
        "artifacts/bus-mobile.png",
        "artifacts/ui-desktop.png",
        "public/data/whu-bus.json",
        "src/page.tsx",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
