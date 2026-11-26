// The branding page (public/host/brand/derive.js) and the server
// (src/server/branding/derive.ts) must give the same venue tokens: the page shows the
// preview, the server writes /theme.css. In Last Call a venue sets one main colour.
import { describe, expect, test } from "bun:test";
import * as page from "../../public/host/brand/derive.js";
import * as server from "../../src/server/branding/derive.ts";

type Inputs = page.BrandInputs;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe("venue colour tokens", () => {
  const rand = rng(42);
  const hex = () => "#" + Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
  const inputs: Inputs[] = [
    page.DEFAULT_INPUTS,
    { accent: "#D9A441" },
    { accent: "#000000" },
    { accent: "#ffffff" },
    { ...page.DEFAULT_INPUTS, displayBackgroundImage: "/theme/assets/background-0123456789.jpg" },
  ];
  for (let i = 0; i < 500; i++) inputs.push({ accent: hex(), displayBackgroundImage: rand() < 0.5 ? null : "/theme/assets/x.jpg" });

  test("the server and the page give the same tokens for 505 inputs", () => {
    for (const inp of inputs) expect(server.deriveBrandTokens(inp)).toEqual(page.deriveBrandTokens(inp));
  });

  test("the server and the page agree on defaults, helpers and asset URLs", () => {
    expect(server.DEFAULT_INPUTS).toEqual(page.DEFAULT_INPUTS);
    expect(server.INK).toBe(page.INK);
    expect(server.BONE).toBe(page.BONE);
    expect(server.mix("#000000", "#ffffff", 0.5)).toBe(page.mix("#000000", "#ffffff", 0.5));
    expect(server.contrast("#17191b", "#edeae2")).toBe(page.contrast("#17191b", "#edeae2"));
    expect(server.assetUrl("assets/x.png")).toBe(page.assetUrl("assets/x.png"));
  });

  test("the default colour gives Lock In's own tokens", () => {
    const t = page.deriveBrandTokens(page.DEFAULT_INPUTS);
    expect(t.venue).toBe("#7df0c3");
    expect(t["on-venue"]).toBe(page.INK);
    expect(t["display-bg-image"]).toBe("none");
  });

  test("labels on the venue colour are Ink on light colours and Bone on dark ones", () => {
    expect(page.onVenue("#ffd54f")).toBe(page.INK);
    expect(page.onVenue("#1a237e")).toBe(page.BONE);
  });

  test("a TV picture sets the image and a scrim", () => {
    const t = page.deriveBrandTokens({ accent: "#7df0c3", displayBackgroundImage: "/theme/assets/b.jpg" });
    expect(t["display-bg-image"]).toBe('url("/theme/assets/b.jpg")');
    expect(t["display-scrim"]).not.toBe("rgba(11, 11, 12, 0)");
  });

  test("checkReadability: the default passes, a dark colour and a status-like colour warn", () => {
    expect(page.checkReadability(page.DEFAULT_INPUTS).every((c) => c.level === "ok")).toBe(true);
    expect(page.checkReadability({ accent: "#1b1b1d" })[0]!.level).toBe("warn");
    expect(page.checkReadability({ accent: "#2fa866" })[2]!.level).toBe("warn");
  });

  test("inputsFromTheme falls back to the default colour", () => {
    const theme = { colours: { accent: null }, displayBackground: null } as unknown as Parameters<typeof page.inputsFromTheme>[0];
    expect(page.inputsFromTheme(theme)).toEqual(server.inputsFromTheme(theme));
    expect(page.inputsFromTheme(theme).accent).toBe("#7df0c3");
  });
});
