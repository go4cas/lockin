// A small, independent QR decoder for tests: level M, byte mode, versions 1 to 10.
// It reads the format bits, unmasks, reads codewords in zigzag order,
// de-interleaves the blocks, checks every block's Reed-Solomon syndromes are
// zero and parses the byte-mode segment. It shares no code with the encoder
// except the GF(256) multiply, which the syndrome check exercises.

import { gfMul } from "../../src/server/qr/encode.ts";

const BLOCKS_M: [number, number[]][] = [
  [10, [16]], [16, [28]], [26, [44]], [18, [32, 32]], [24, [43, 43]], [16, [27, 27, 27, 27]],
  [18, [31, 31, 31, 31]], [22, [38, 38, 39, 39]], [22, [36, 36, 36, 37, 37]], [26, [43, 43, 43, 43, 44]],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export interface Decoded {
  version: number;
  mask: number;
  bytes: Uint8Array;
  text: string;
}

function isFunction(version: number, r: number, c: number): boolean {
  const n = 17 + 4 * version;
  if ((r < 9 && c < 9) || (r < 9 && c >= n - 8) || (r >= n - 8 && c < 9)) return true; // finders, separators, format
  if (r === 6 || c === 6) return true; // timing
  const pos = ALIGN[version - 1]!;
  const last = pos[pos.length - 1];
  for (const ar of pos) for (const ac of pos) {
    if ((ar === 6 && ac === 6) || (ar === 6 && ac === last) || (ar === last && ac === 6)) continue;
    if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
  }
  if (version >= 7 && ((r < 6 && c >= n - 11) || (c < 6 && r >= n - 11))) return true; // version info
  return false;
}

const MASK = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

export function decodeQr(m: boolean[][]): Decoded {
  const n = m.length;
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) throw new Error(`Unexpected size ${n}`);

  // Format bits, first copy: bit i for i 0-5 at (i, 8), then (7,8), (8,8), (8,7), then (8, 14-i).
  const pos: [number, number][] = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7]];
  for (let i = 9; i < 15; i++) pos.push([8, 14 - i]);
  let fmt = 0;
  pos.forEach(([r, c], i) => { if (m[r]![c]) fmt |= 1 << i; });
  const info = (fmt ^ 0x5412) >> 10;
  if (info >> 3 !== 0) throw new Error(`Not level M (format ${fmt.toString(2)})`);
  const mask = info & 7;
  if (!m[n - 8]![8]) throw new Error("Dark module missing");

  // Zigzag read.
  const bits: number[] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const r = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (isFunction(version, r, c)) continue;
        bits.push(m[r]![c] !== MASK[mask]!(r, c) ? 1 : 0);
      }
    }
  }
  const [ec, sizes] = BLOCKS_M[version - 1]!;
  const total = sizes.reduce((a, b) => a + b, 0) + ec * sizes.length;
  const cw: number[] = [];
  for (let i = 0; i < total; i++) cw.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));

  // De-interleave, check syndromes.
  const blocks = sizes.map((s) => ({ data: [] as number[], ec: [] as number[], size: s }));
  let k = 0;
  for (let i = 0; i < Math.max(...sizes); i++) for (const b of blocks) if (i < b.size) b.data.push(cw[k++]!);
  for (let i = 0; i < ec; i++) for (const b of blocks) b.ec.push(cw[k++]!);
  const alpha = [1];
  for (let i = 1; i < ec; i++) alpha.push(gfMul(alpha[i - 1]!, 2));
  for (const b of blocks) {
    const word = [...b.data, ...b.ec];
    for (let i = 0; i < ec; i++) {
      let s = 0;
      for (const v of word) s = gfMul(s, alpha[i]!) ^ v; // Horner: evaluate at alpha^i
      if (s !== 0) throw new Error(`Reed-Solomon syndrome ${i} is not zero`);
    }
  }

  // Parse: mode 0100, count, bytes.
  const data = blocks.flatMap((b) => b.data);
  const dbits = data.flatMap((v) => Array.from({ length: 8 }, (_, i) => (v >> (7 - i)) & 1));
  let p = 0;
  const take = (len: number) => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | dbits[p++]!;
    return v;
  };
  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`Mode ${mode} is not byte mode`);
  const count = take(version < 10 ? 8 : 16);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = take(8);
  return { version, mask, bytes, text: new TextDecoder().decode(bytes) };
}

/** Reads an SVG made by qrSvg() back into a module matrix (quiet zone removed). */
export function svgToMatrix(svg: string, quietZone = 4): boolean[][] {
  const full = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)![1]);
  const n = full - 2 * quietZone;
  const m = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const d = /<path[^>]* d="([^"]*)"/.exec(svg)![1]!;
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(w); i++) m[Number(y) - quietZone]![Number(x) - quietZone + i] = true;
  }
  return m;
}
