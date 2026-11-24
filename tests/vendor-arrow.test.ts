// TECH-SPEC 3.1: ArrowJS core is vendored, unchanged, in public/vendor/arrow/.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contentType } from "../src/server/static.ts";
// Type-only: proves the "/vendor/*" path in tsconfig.json resolves for `bun run typecheck`.
import type { ArrowTemplate } from "/vendor/arrow/index.mjs";

const DIR = join(import.meta.dir, "../public/vendor/arrow");

interface VendorManifest {
  package: string;
  version: string;
  license: string;
  files: Record<string, { from: string; sha256?: string }>;
}
const manifest: VendorManifest = JSON.parse(readFileSync(join(DIR, "vendor.json"), "utf8"));

describe("vendored Arrow files", () => {
  test("is @arrow-js/core under the MIT licence, with the licence text shipped", () => {
    expect(manifest.package).toBe("@arrow-js/core");
    expect(manifest.license).toBe("MIT");
    expect(readFileSync(join(DIR, "LICENSE.txt"), "utf8")).toContain("Permission is hereby granted, free of charge");
  });

  test("every file matches the SHA-256 recorded in vendor.json", () => {
    for (const [name, info] of Object.entries(manifest.files)) {
      expect(existsSync(join(DIR, name))).toBe(true);
      if (!info.sha256) continue;
      const sum = createHash("sha256").update(readFileSync(join(DIR, name))).digest("hex");
      expect(`${name} ${sum}`).toBe(`${name} ${info.sha256}`);
    }
  });

  test("the README and TECH-SPEC name the same version", () => {
    expect(readFileSync(join(DIR, "README.md"), "utf8")).toContain(`| Version | ${manifest.version} |`);
    const spec = readFileSync(join(import.meta.dir, "../docs/TECH-SPEC.md"), "utf8");
    expect(spec.includes(`\`@arrow-js/core\` ${manifest.version}`) ? "TECH-SPEC names it" : "TECH-SPEC 3.1 names another version").toBe("TECH-SPEC names it");
  });

  test("index.mjs only imports files that are vendored next to it", () => {
    const code = readFileSync(join(DIR, "index.mjs"), "utf8");
    const specs = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec.startsWith("./")).toBe(true);
      expect(Object.keys(manifest.files)).toContain(spec.slice(2));
    }
  });

  test(".mjs files are served as JavaScript, which module scripts require", () => {
    expect(contentType("vendor/arrow/index.mjs")).toStartWith("text/javascript");
  });
});

describe("Arrow's reactive store, as pages will use it for server views", () => {
  test("loads as an ES module and exposes the API the spec relies on", async () => {
    const arrow = await import("../public/vendor/arrow/index.mjs");
    for (const name of ["html", "reactive", "watch", "component", "nextTick", "onCleanup", "svg"]) {
      expect(typeof (arrow as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("a watcher reruns when a new view replaces part of the store", async () => {
    const { reactive, watch, nextTick } = await import("../public/vendor/arrow/index.mjs");
    const store = reactive({ view: { phase: "lobby", seq: 1 } as { phase: string; seq: number } });
    const seen: string[] = [];
    watch(() => seen.push(`${store.view.phase}#${store.view.seq}`));
    store.view = { phase: "question", seq: 2 };
    await nextTick();
    expect(seen).toEqual(["lobby#1", "question#2"]);
  });

  test("types resolve through the /vendor path", () => {
    const t: ArrowTemplate | null = null;
    expect(t).toBeNull();
  });
});
