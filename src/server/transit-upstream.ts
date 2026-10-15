import forge from "node-forge";

export const TRANSIT_ORIGIN = "https://bus.whu.edu.cn";
export const LINE_IDS = [
  "10486-50-0",
  "10486-55-0",
  "10486-56-0",
  "10486-56-1",
] as const;

export type ReadUpstream = (
  url: string,
  signal: AbortSignal,
) => Promise<string>;

export const readUpstream: ReadUpstream = async (url, signal) => {
  if (new URL(url).origin !== TRANSIT_ORIGIN)
    throw new Error("校巴资源地址发生变化");
  const resource = url.includes("/interface/")
    ? "data"
    : url.endsWith("index.html")
      ? "index"
      : "script";
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
    redirect: "manual",
    cache: "no-store",
    signal,
  }).catch((error: unknown) => {
    console.warn(
      "Transit resource unavailable",
      resource,
      error instanceof Error ? error.message : "unknown",
    );
    throw error;
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("校巴上游发生重定向");
  if (!response.ok) throw new Error(`校巴上游返回 ${response.status}`);
  const body = await response.text();
  if (body.length > 4_000_000) throw new Error("校巴响应超过大小限制");
  return body;
};

function constant(script: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = script.match(
    new RegExp(`(?<![\\w$])${escaped}=("(?:\\\\.|[^"\\\\])*")`),
  );
  if (!match) throw new Error("校方页面的数据协议已变化");
  return JSON.parse(match[1]);
}

/** Use the same published H5 transformation as the existing Python collector. */
export function parseProtocol(script: string) {
  const seed = forge.pki.privateKeyFromPem(constant(script, "wt"));
  const unwrap = (fragment: string | undefined) => {
    const names = [...(fragment ?? "").matchAll(/r\(wt,mt\(([\w$]+)\)\)/g)];
    if (!names.length) throw new Error("校方页面的数据协议已变化");
    return names
      .map((match) =>
        seed.decrypt(
          forge.util.decode64(constant(script, match[1])),
          "RSAES-PKCS1-V1_5",
        ),
      )
      .join("");
  };
  const requestKey = forge.pki.publicKeyFromPem(
    unwrap(script.match(/At=([^;]+);var e=/)?.[1]),
  );
  const responseKey = forge.pki.privateKeyFromPem(
    unwrap(script.match(/vt=([^;]+?),r\(vt,mt\(t\)\)/)?.[1]),
  );
  return {
    requestUrl(path: string, now = Date.now()) {
      const encoded = forge.util
        .encode64(requestKey.encrypt(`${now}/${path}`, "RSAES-PKCS1-V1_5"))
        .replaceAll("/", "*");
      return `${TRANSIT_ORIGIN}/interface/whubus/weben/${encoded}`;
    },
    decodeVehicle(value: string) {
      return forge.util.decodeUtf8(
        responseKey.decrypt(forge.util.decode64(value), "RSAES-PKCS1-V1_5"),
      );
    },
  };
}

export interface TransitClient {
  stations(id: string, signal: AbortSignal): Promise<unknown>;
  path(id: string, signal: AbortSignal): Promise<unknown>;
  vehicles(id: string, signal: AbortSignal): Promise<string[]>;
}

export function createUpstreamClient(
  read: ReadUpstream = readUpstream,
): TransitClient {
  let protocol: ReturnType<typeof parseProtocol> | undefined;
  let protocolAt = 0;
  let pending: Promise<ReturnType<typeof parseProtocol>> | undefined;
  async function getProtocol(signal: AbortSignal) {
    if (protocol && Date.now() - protocolAt < 6 * 60 * 60 * 1000)
      return protocol;
    if (!pending) {
      pending = (async () => {
        const index = await read(`${TRANSIT_ORIGIN}/mobile/index.html`, signal);
        const path = index.match(
          /src=["']?(\/mobile\/static\/js\/app\.[^"' >]+)/,
        )?.[1];
        if (!path) throw new Error("校方页面脚本地址已变化");
        protocol = parseProtocol(
          await read(`${TRANSIT_ORIGIN}${path}`, signal),
        );
        protocolAt = Date.now();
        return protocol;
      })().finally(() => {
        pending = undefined;
      });
    }
    return pending;
  }
  async function get(path: string, signal: AbortSignal) {
    const codec = await getProtocol(signal);
    const value = JSON.parse(await read(codec.requestUrl(path), signal));
    if (!value || String(value.resultCode) !== "1")
      throw new Error("校巴上游未返回成功数据");
    return { data: value.data, codec };
  }
  return {
    async stations(id, signal) {
      const { data } = await get(`10486/line/${id}`, signal);
      if (!data || !Array.isArray(data.stops))
        throw new Error("校巴站点格式已变化");
      return {
        ...data,
        stops: data.stops.map((stop: string) =>
          JSON.parse(forge.util.decodeUtf8(forge.util.decode64(stop))),
        ),
      };
    },
    async path(id, signal) {
      return (await get(`10486/linePath/${id}`, signal)).data;
    },
    async vehicles(id, signal) {
      const { data, codec } = await get(`10486/line/${id}/bus`, signal);
      if (!Array.isArray(data)) throw new Error("校巴车辆响应缺少数组");
      return data.map((item: unknown) => {
        if (typeof item !== "string") throw new Error("校巴车辆格式已变化");
        return codec.decodeVehicle(item);
      });
    },
  };
}
