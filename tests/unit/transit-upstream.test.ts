import { describe, expect, it, vi } from "vitest";
import forge from "node-forge";
import {
  createUpstreamClient,
  parseProtocol,
  readUpstream,
  TRANSIT_ORIGIN,
} from "../../src/server/transit-upstream";

function protocolFixture() {
  const seed = forge.pki.rsa.generateKeyPair(512);
  const data = forge.pki.rsa.generateKeyPair(512);
  const constants = [
    `wt=${JSON.stringify(forge.pki.privateKeyToPem(seed.privateKey))}`,
  ];
  function wrap(pem: string, prefix: string) {
    const names: string[] = [];
    for (let i = 0; i < pem.length; i += 48) {
      const name = `${prefix}${i}`;
      constants.push(
        `${name}=${JSON.stringify(forge.util.encode64(seed.publicKey.encrypt(pem.slice(i, i + 48), "RSAES-PKCS1-V1_5")))}`,
      );
      names.push(`r(wt,mt(${name}))`);
    }
    return names.join("+");
  }
  const pub = wrap(forge.pki.publicKeyToPem(data.publicKey), "pub");
  const priv = wrap(forge.pki.privateKeyToPem(data.privateKey), "priv");
  const script = `${constants.join(";")};At=${pub};var e=0;vt=${priv},r(vt,mt(t))`;
  return { script, data };
}

describe("official H5 transformation", () => {
  it("unwraps published parameters, creates fresh request URLs and decodes response fields", () => {
    const { script, data } = protocolFixture();
    const codec = parseProtocol(script);
    const encoded = codec
      .requestUrl("10486/line/10486-50-0/bus", 123456)
      .split("/weben/")[1]
      .replaceAll("*", "/");
    expect(
      data.privateKey.decrypt(forge.util.decode64(encoded), "RSAES-PKCS1-V1_5"),
    ).toBe("123456/10486/line/10486-50-0/bus");
    const vehicle = "50264|11|1|0|114.36|30.53";
    expect(
      codec.decodeVehicle(
        forge.util.encode64(
          data.publicKey.encrypt(vehicle, "RSAES-PKCS1-V1_5"),
        ),
      ),
    ).toBe(vehicle);
    expect(() => parseProtocol("changed script")).toThrow("协议已变化");
  });

  it("fetches the official script once, validates results, and decodes UTF-8 stop names", async () => {
    const { script, data } = protocolFixture();
    let result: unknown = {
      resultCode: 1,
      data: {
        stops: [
          forge.util.encode64(
            forge.util.encodeUtf8(JSON.stringify({ stopName: "珞珈门" })),
          ),
        ],
      },
    };
    const read = vi.fn(async (url: string) => {
      if (url.endsWith("index.html"))
        return '<script src="/mobile/static/js/app.test.js"></script>';
      if (url.endsWith("app.test.js")) return script;
      return JSON.stringify(result);
    });
    const client = createUpstreamClient(read);
    const signal = AbortSignal.timeout(8000);
    expect(await client.stations("10486-50-0", signal)).toEqual({
      stops: [{ stopName: "珞珈门" }],
    });
    result = { resultCode: 1, data: [] };
    expect(await client.vehicles("10486-50-0", signal)).toEqual([]);
    result = {
      resultCode: 1,
      data: [
        forge.util.encode64(data.publicKey.encrypt("bus|11|1|1|114.36|30.53")),
      ],
    };
    expect(await client.vehicles("10486-50-0", signal)).toEqual([
      "bus|11|1|1|114.36|30.53",
    ]);
    result = { resultCode: 1, data: {} };
    await expect(client.vehicles("10486-50-0", signal)).rejects.toThrow(
      "缺少数组",
    );
    result = { resultCode: 0, data: [] };
    await expect(client.path("10486-50-0", signal)).rejects.toThrow(
      "未返回成功数据",
    );
    expect(
      read.mock.calls.filter(([url]) => url.endsWith("app.test.js")),
    ).toHaveLength(1);
  });

  it("rejects cross-origin resources, HTTP failures, and redirects instead of following login", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("no", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const signal = AbortSignal.timeout(8000);
      await expect(
        readUpstream("https://cas.whu.edu.cn/login", signal),
      ).rejects.toThrow("地址发生变化");
      expect(fetcher).not.toHaveBeenCalled();
      await expect(
        readUpstream(`${TRANSIT_ORIGIN}/mobile/index.html`, signal),
      ).rejects.toThrow("503");
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        redirect: "manual",
        cache: "no-store",
        signal,
      });
      fetcher.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://cas.whu.edu.cn/login" },
        }),
      );
      await expect(
        readUpstream(`${TRANSIT_ORIGIN}/mobile/index.html`, signal),
      ).rejects.toThrow("重定向");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
