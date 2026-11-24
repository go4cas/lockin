// B8: the QR encoder against published reference matrices and an independent decoder.

import { describe, expect, test } from "bun:test";
import { MAX_BYTES, QrTooLongError, encodeQr, formatBits, qrSvg, reedSolomon, versionBits, versionFor } from "../../src/server/qr/encode.ts";
import vectors from "./vectors.json" with { type: "json" };
import { decodeQr, svgToMatrix } from "./decode.ts";

const rows = (m: boolean[][]) => m.map((r) => r.map((b) => (b ? "1" : "0")).join(""));

describe("reference vectors (Project Nayuki's encoder, see vectors.json)", () => {
  for (const v of vectors.vectors) {
    const label = `${v.forced ? `mask ${v.mask} forced` : "auto mask"}, v${v.version}: ${JSON.stringify(v.text.slice(0, 40))}`;
    test(label, () => {
      const q = encodeQr(v.text, v.forced ? { mask: v.mask } : {});
      expect(q.version).toBe(v.version);
      expect(q.mask).toBe(v.mask);
      expect(rows(q.modules)).toEqual(v.rows);
    });
  }

  test("cover every version from 1 to 10 and every mask", () => {
    expect(new Set(vectors.vectors.map((v) => v.version))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(new Set(vectors.vectors.map((v) => v.mask))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });
});

describe("building blocks match ISO 18004 worked values", () => {
  test("format bits for level M (annex C table)", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((m) => formatBits(m).toString(2).padStart(15, "0"))).toEqual([
      "101010000010010", "101000100100101", "101111001111100", "101101101001011",
      "100010111111001", "100000011001110", "100111110010111", "100101010100000",
    ]);
  });

  test("version 7 information is 000111110010010100 (annex D)", () => {
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
    expect(versionBits(10).toString(2).padStart(18, "0")).toBe("001010010011010011");
  });

  test("Reed-Solomon: the ISO 18004 annex I example (1-M, \"01234567\")", () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(reedSolomon(data, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });
});

describe("capacity", () => {
  test("smallest version per length at level M", () => {
    // Byte-mode capacities at M for versions 1-10 (ISO 18004 table 7).
    const caps = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
    caps.forEach((cap, i) => {
      expect(versionFor(cap)).toBe(i + 1);
      if (i < 9) expect(versionFor(cap + 1)).toBe(i + 2);
    });
    expect(MAX_BYTES).toBe(213);
  });

  test("more than 213 bytes is refused with a plain error", () => {
    expect(() => encodeQr("x".repeat(213))).not.toThrow();
    expect(() => encodeQr("x".repeat(214))).toThrow(QrTooLongError);
  });
});

describe("round trip through an independent decoder", () => {
  test("every length from 0 to 213, UTF-8 included", () => {
    const alphabet = Array.from("abcXYZ0129-/:.?=&é€🍺 ");
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let len = 0; len <= 213; len++) {
      const bytes = new Uint8Array(len).map(() => Math.floor(rand() * 256));
      const q = encodeQr(bytes);
      const d = decodeQr(q.modules);
      expect(d.version).toBe(q.version);
      expect(d.mask).toBe(q.mask);
      expect([...d.bytes]).toEqual([...bytes]);
      const text = Array.from({ length: Math.min(len, 50) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      expect(decodeQr(encodeQr(text).modules).text).toBe(text);
    }
  });

  test("every mask decodes", () => {
    for (let mask = 0; mask < 8; mask++) {
      expect(decodeQr(encodeQr("https://quiz.example.com/j/BCDF", { mask }).modules).text).toBe("https://quiz.example.com/j/BCDF");
    }
  });

  test("the SVG draws exactly the matrix, with a 4-module quiet zone", () => {
    const text = "https://quiz.example.com/m/23456789";
    const svg = qrSvg(text, { title: `Join <"&'>` });
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg).toContain('viewBox="0 0 37 37"'); // version 3 = 29 modules + 8
    expect(svg).toContain("<title>Join &#60;&#34;&#38;&#39;&#62;</title>");
    expect(rows(svgToMatrix(svg))).toEqual(rows(encodeQr(text).modules));
    expect(decodeQr(svgToMatrix(svg)).text).toBe(text);
  });
});
