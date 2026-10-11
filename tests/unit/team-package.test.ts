import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
      await writeFile(join(directory, "TODO.md"), "handoff backlog");
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
        "TODO.md",
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

describe("project handoff documentation", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));

  it.each(["README.md", "TODO.md", "docs/DATA-INTERFACES.md"])(
    "%s has resolvable local documentation links",
    async (name) => {
      const content = await readFile(join(root, name), "utf8");
      const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
        .map((match) => match[1])
        .filter((target) => !/^(?:[a-z]+:|#)/i.test(target));
      expect(links.length).toBeGreaterThan(0);
      for (const target of links) {
        await expect(
          access(
            resolve(root, name, "..", decodeURIComponent(target.split("#")[0])),
          ),
        ).resolves.toBeUndefined();
      }
    },
  );

  it("README npm commands match available package scripts", async () => {
    const content = await readFile(join(root, "README.md"), "utf8");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const commands = [...content.matchAll(/npm run ([\w:-]+)/g)].map(
      (match) => match[1],
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(pkg.scripts).toHaveProperty(command);
  });

  it("ships README, TODO and interface documentation together in the source ZIP", async () => {
    const files = await collectSourceFiles(root);
    const archive = unzipSync(archiveFiles(files, "source"));
    for (const path of [
      "README.md",
      "TODO.md",
      "docs/DATA-INTERFACES.md",
      "docs/TEAM-PREVIEW.md",
    ]) {
      expect(strFromU8(archive[`source/${path}`])).toBe(
        await readFile(join(root, path), "utf8"),
      );
    }
  });
});
