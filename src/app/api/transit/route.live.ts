import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  createTransitService,
  type CollectedSnapshot,
  type SnapshotStore,
} from "../../../server/transit-service";

export const dynamic = "force-dynamic";
const service = createTransitService();

function edgeStore(request: Request): SnapshotStore | undefined {
  // Cache API is shared within a Cloudflare location; Next.js dev uses memory only.
  const cache = (
    globalThis.caches as (CacheStorage & { default?: Cache }) | undefined
  )?.default;
  if (!cache) return undefined;
  const key = new Request(new URL("/internal-cache/transit-v1", request.url));
  return {
    async read() {
      const response = await cache.match(key);
      return response
        ? ((await response.json()) as CollectedSnapshot)
        : undefined;
    },
    async write(snapshot) {
      const response = Response.json(snapshot, {
        headers: { "Cache-Control": "public, max-age=21600" },
      });
      const write = cache.put(key, response);
      getCloudflareContext().ctx.waitUntil(write);
    },
  };
}

export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    return Response.json(await service.getSnapshot(edgeStore(request)), {
      headers,
    });
  } catch (error) {
    console.warn(
      "Transit API unavailable",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json(
      { error: "校方校巴数据暂时无法读取，请稍后重试" },
      { status: 503, headers },
    );
  }
}
