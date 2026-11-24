// The branding page and the server share public/host/brand/derive.js. It must
// give the same results as Design's reference, docs/design/tools/derive.ts.
import { describe, expect, test } from "bun:test";
import * as port from "../../public/host/brand/derive.js";

// Loaded by a computed path so `bun run typecheck` does not check Design's tool
// file (docs/ is outside tsconfig's include and not written for its strict flags).
type Inputs = port.BrandInputs;
const ref: typeof port = await import(["..", "..", "docs", "design", "tools", "derive.ts"].join("/"));

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe("derive.js matches docs/design/tools/derive.ts", () => {
  const rand = rng(42);
  const hex = () => "#" + Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
  const inputs: Inputs[] = [
    ref.DEFAULT_INPUTS,
    { background: "#1c140f", text: "#f3e6cc", accent: "#d9a441", accent2: "#8cc2a8" },
    { background: "#0e0b1a", text: "#f2f0ff", accent: "#ff3ea5", accent2: "#2ef2e2" },
    { background: "#f4efe4", text: "#5c5c5c", accent: "#ffd54f", accent2: "#9ad0c2" },
    { background: "#000000", text: "#000000", accent: "#000000", accent2: "#ffffff" },
    { ...ref.DEFAULT_INPUTS, displayBackgroundColour: "#223344" },
    { ...ref.DEFAULT_INPUTS, displayBackgroundImage: "/theme/assets/background-0123456789.jpg" },
  ];
  for (let i = 0; i < 500; i++) inputs.push({ background: hex(), text: hex(), accent: hex(), accent2: hex() });

  test("deriveBrandTokens gives the same tokens for 507 inputs", () => {
    for (const inp of inputs) expect(port.deriveBrandTokens(inp)).toEqual(ref.deriveBrandTokens(inp));
  });

  test("checkReadability gives the same checks for 507 inputs", () => {
    for (const inp of inputs) expect(port.checkReadability(inp)).toEqual(ref.checkReadability(inp));
  });

  test("defaults and helpers agree", () => {
    expect(port.DEFAULT_INPUTS).toEqual(ref.DEFAULT_INPUTS);
    expect(port.mix("#000000", "#ffffff", 0.5)).toBe(ref.mix("#000000", "#ffffff", 0.5));
    expect(port.contrast("#17191b", "#edeae2")).toBe(ref.contrast("#17191b", "#edeae2"));
  });

  test("the sample too-light theme trips six of the seven checks (branding.md)", () => {
    const bad = port.checkReadability({ background: "#f4efe4", text: "#5c5c5c", accent: "#ffd54f", accent2: "#9ad0c2" }).filter((c) => c.level !== "ok");
    expect(bad.length).toBe(6);
  });
});
