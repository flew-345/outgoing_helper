import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import openNextConfig from "../../open-next.config";

const readProjectFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const config = JSON.parse(readProjectFile("wrangler.json"));

describe("Cloudflare deployment", () => {
  it("binds the worker to its own deployment name", () => {
    expect(config.name).toBe("whu-going");
    expect(config.services).toEqual([
      { binding: "WORKER_SELF_REFERENCE", service: config.name },
    ]);
    expect(config.compatibility_flags).toContain("nodejs_compat");
  });

  it("deploys the OpenNext worker and asset outputs", () => {
    expect(config.main).toBe(".open-next/worker.js");
    expect(config.assets).toEqual({
      directory: ".open-next/assets",
      binding: "ASSETS",
    });
    expect(openNextConfig.default?.override?.wrapper).toBe("cloudflare-node");
  });

  it("needs no provisioned cache or image service for the current app", () => {
    expect(config.r2_buckets).toBeUndefined();
    expect(config.images).toBeUndefined();
    expect(openNextConfig.default?.override?.incrementalCache).toBe("dummy");
  });

  it("pins the verified Next.js version to avoid unhandled preview manifests", () => {
    const pkg = JSON.parse(readProjectFile("package.json"));
    expect(pkg.dependencies.next).toBe("16.3.8");
  });
});
