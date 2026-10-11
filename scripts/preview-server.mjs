import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import {
  resolve,
  relative,
  isAbsolute,
  join,
  extname,
  dirname,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function isInside(root, path) {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export function createPreviewServer(directory) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    const respond = (status, message) => {
      response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : message);
    };
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.setHeader("Allow", "GET, HEAD");
      respond(405, "Method not allowed");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      );
    } catch {
      respond(400, "Invalid URL");
      return;
    }
    if (pathname.includes("\0")) {
      respond(400, "Invalid URL");
      return;
    }
    let file = resolve(root, `.${pathname}`);
    if (!isInside(root, file)) {
      respond(403, "Forbidden");
      return;
    }
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, "index.html");
        info = await stat(file);
      }
      if (
        !info.isFile() ||
        !isInside(await realpath(root), await realpath(file))
      ) {
        respond(403, "Forbidden");
        return;
      }
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(file)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(file)
        .on("error", () => response.destroy())
        .pipe(response);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR")
        respond(404, "Not found");
      else respond(500, "Unable to read preview file");
    }
  });
}

export async function listenPreview(server, preferredPort = 4173) {
  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 0 ||
    preferredPort > 65535
  )
    throw new Error("Invalid preview port");
  for (
    let port = preferredPort;
    port <= Math.min(preferredPort + 20, 65535);
    port++
  ) {
    try {
      await new Promise((resolveListen, reject) => {
        const onError = (error) => {
          server.off("listening", onListen);
          reject(error);
        };
        const onListen = () => {
          server.off("error", onError);
          resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListen);
        server.listen(port, "127.0.0.1");
      });
      return `http://127.0.0.1:${server.address().port}`;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || preferredPort === 0) throw error;
    }
  }
  throw new Error(
    "No free preview port found. Close an earlier preview and try again.",
  );
}

async function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const portFlag = args.indexOf("--port");
  const root =
    rootFlag >= 0
      ? resolve(args[rootFlag + 1] ?? "out")
      : join(dirname(fileURLToPath(import.meta.url)), "site");
  await stat(join(root, "index.html"));
  const server = createPreviewServer(root);
  const url = await listenPreview(
    server,
    portFlag >= 0 ? Number(args[portFlag + 1]) : 4173,
  );
  console.log(`Luojia Transit preview: ${url}`);
  console.log(
    "Keep this window open. Press Ctrl+C to stop. Map imagery requires internet.",
  );
  if (!args.includes("--no-open")) {
    const command =
      process.platform === "win32"
        ? "cmd.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    const browserArgs =
      process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const browser = spawn(command, browserArgs, {
      stdio: "ignore",
      windowsHide: true,
    });
    browser.on("error", () => console.log(`Open ${url} in your browser.`));
    browser.unref();
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Preview could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
