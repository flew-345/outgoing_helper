import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { zipSync } from "fflate";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  ".gitignore",
  ".prettierignore",
  "AGENTS.md",
  "README.md",
  "TODO.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "vitest.config.ts",
  "playwright.config.ts",
  "artifacts/ui-desktop.png",
  "artifacts/ui-mobile.png",
  "artifacts/bus-desktop.png",
  "artifacts/bus-mobile.png",
];
const excluded = new Set([
  "node_modules",
  ".git",
  ".next",
  "releases",
  "out",
  "test-results",
  "playwright-report",
  "__pycache__",
]);

export function safeSourcePath(path) {
  return (
    !path
      .split(/[\\/]/)
      .some(
        (part) =>
          excluded.has(part) ||
          (part.startsWith(".env") && part !== ".env.example"),
      ) && !/\.(log|tsbuildinfo|pyc)$/.test(path)
  );
}

async function collectFiles(directory, prefix = "", files = {}) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!safeSourcePath(path) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory())
      await collectFiles(join(directory, entry.name), path, files);
    else if (entry.isFile())
      files[path] = new Uint8Array(await readFile(join(directory, entry.name)));
  }
  return files;
}

export async function collectSourceFiles(directory) {
  const files = {};
  for (const path of sourceFiles) {
    try {
      files[path] = new Uint8Array(await readFile(join(directory, path)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const path of ["src", "tests", "docs", "scripts", "public"]) {
    try {
      await collectFiles(join(directory, path), path, files);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

export function archiveFiles(files, folder) {
  if (!/^[a-zA-Z0-9_-]+$/.test(folder))
    throw new Error("Invalid archive folder");
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        `${folder}/${path}`,
        content,
      ]),
    ),
    { level: 6 },
  );
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error(
      "Build the portable Windows x64 package with Windows x64 Node.js.",
    );
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const nodeLicensePath = join(
    root,
    "scripts/licenses",
    `node-${process.version}-LICENSE.txt`,
  );
  await stat(nodeLicensePath);
  const build = spawnSync(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "build"],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, TRANSIT_STATIC_EXPORT: "1" },
    },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error("Static export failed");
  const files = {};
  const site = await collectFiles(join(root, "out"));
  for (const [path, content] of Object.entries(site))
    files[`site/${path}`] = content;
  files["runtime/node.exe"] = new Uint8Array(await readFile(process.execPath));
  files["runtime/LICENSE.txt"] = new Uint8Array(
    await readFile(nodeLicensePath),
  );
  files["preview-server.mjs"] = new Uint8Array(
    await readFile(join(root, "scripts/preview-server.mjs")),
  );
  files["start-preview.cmd"] = new TextEncoder().encode(
    '@echo off\r\ntitle Luojia Transit Preview\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0preview-server.mjs" %*\r\nif errorlevel 1 pause\r\n',
  );
  files["README.md"] = new Uint8Array(
    await readFile(join(root, "docs/TEAM-PREVIEW.md")),
  );
  for (const image of ["ui-desktop.png", "ui-mobile.png"])
    files[`screenshots/${image}`] = new Uint8Array(
      await readFile(join(root, "artifacts", image)),
    );
  for (const [name, path] of Object.entries({
    next: "next/license.md",
    react: "react/LICENSE",
    "react-dom": "react-dom/LICENSE",
    leaflet: "leaflet/LICENSE",
    lucide: "lucide-react/LICENSE",
  })) {
    files[`licenses/${name}.txt`] = new Uint8Array(
      await readFile(join(root, "node_modules", path)),
    );
  }
  files["manifest.json"] = new TextEncoder().encode(
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        platform: "windows-x64",
        nodeVersion: process.version,
        dataStatus:
          "UI preview only; local demo data; no live vehicle or navigation service",
        files: Object.fromEntries(
          Object.entries(files).map(([path, data]) => [
            path,
            { bytes: data.length, sha256: sha256(data) },
          ]),
        ),
      },
      null,
      2,
    ),
  );
  const directory = join(root, "releases");
  await mkdir(directory, { recursive: true });
  const previewName = `luojia-transit-preview-v${pkg.version}-windows-x64.zip`;
  const sourceName = `luojia-transit-source-v${pkg.version}.zip`;
  const preview = archiveFiles(files, "luojia-transit-preview");
  await writeFile(join(directory, previewName), preview);
  const source = archiveFiles(
    await collectSourceFiles(root),
    "luojia-transit-source",
  );
  await writeFile(join(directory, sourceName), source);
  await writeFile(
    join(directory, "SHA256SUMS.txt"),
    `${sha256(preview)}  ${previewName}\n${sha256(source)}  ${sourceName}\n`,
  );
  console.log(
    `Preview: ${join(directory, previewName)} (${(preview.length / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(
    `Source: ${join(directory, sourceName)} (${(source.length / 1024 / 1024).toFixed(1)} MB)`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
