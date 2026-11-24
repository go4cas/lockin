// QR code encoder (TECH-SPEC B8): byte mode, error correction level M,
// versions 1 to 10, no dependencies. Follows ISO/IEC 18004:2015.
//
//   const m = encodeQr("https://quiz.example.com/j/BCDF");   // boolean[][], true = dark
//   const svg = qrSvg("https://quiz.example.com/j/BCDF");

/** Error correction level M, versions 1 to 10 (ISO 18004 table 9). */
interface VersionInfo {
  /** Error correction codewords per block. */
  ec: number;
  /** Data codewords per block, one entry per block, in order. */
  blocks: number[];
}

const rep = (n: number, v: number): number[] => Array.from({ length: n }, () => v);

const VERSIONS_M: readonly VersionInfo[] = [
  { ec: 10, blocks: [16] },                         // 1
  { ec: 16, blocks: [28] },                         // 2
  { ec: 26, blocks: [44] },                         // 3
  { ec: 18, blocks: rep(2, 32) },                   // 4
  { ec: 24, blocks: rep(2, 43) },                   // 5
  { ec: 16, blocks: rep(4, 27) },                   // 6
  { ec: 18, blocks: rep(4, 31) },                   // 7
  { ec: 22, blocks: [...rep(2, 38), ...rep(2, 39)] }, // 8
  { ec: 22, blocks: [...rep(3, 36), ...rep(2, 37)] }, // 9
  { ec: 26, blocks: [...rep(4, 43), 44] },          // 10
];

/** Alignment pattern centre coordinates per version (ISO 18004 annex E). */
const ALIGNMENT: readonly number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

export const MAX_VERSION = 10;

const dataCodewords = (v: number): number => VERSIONS_M[v - 1]!.blocks.reduce((a, b) => a + b, 0);
const countBits = (v: number): number => (v < 10 ? 8 : 16);

/** The most bytes that fit at error correction M, version 10. */
export const MAX_BYTES = Math.floor((dataCodewords(MAX_VERSION) * 8 - 4 - countBits(MAX_VERSION)) / 8);

export class QrTooLongError extends Error {}

// ---- Reed-Solomon over GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 ----

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** Generator polynomial of the given degree, highest power first, leading 1 omitted. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** Error correction codewords for one block of data. */
export function reedSolomon(data: readonly number[], ecCount: number): number[] {
  const gen = generator(ecCount);
  const rem = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecCount; i++) rem[i] = rem[i]! ^ gfMul(gen[i]!, factor);
  }
  return rem;
}

// ---- Data encoding ----

/** The smallest version (1 to 10) that holds `n` bytes at level M, or null. */
export function versionFor(n: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (4 + countBits(v) + 8 * n <= dataCodewords(v) * 8) return v;
  }
  return null;
}

/** Mode, count, data, terminator and padding, then interleaved with error correction (ISO 18004 7.4 to 7.6). */
export function codewords(bytes: Uint8Array, version: number): number[] {
  const info = VERSIONS_M[version - 1]!;
  const capacity = dataCodewords(version) * 8;
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let at = 0;
  for (const size of info.blocks) {
    const block = data.slice(at, at + size);
    at += size;
    blocks.push(block);
    ecBlocks.push(reedSolomon(block, info.ec));
  }
  const out: number[] = [];
  const longest = Math.max(...info.blocks);
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < info.ec; i++) for (const b of ecBlocks) out.push(b[i]!);
  return out;
}

// ---- Matrix ----

/** Format information bits for level M and a mask (ISO 18004 7.9). */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** Version information bits, versions 7 and up (ISO 18004 7.10). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = 17 + 4 * version;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(r: number, c: number, dark: boolean): void {
    this.dark[r]![c] = dark;
    this.fixed[r]![c] = true;
  }

  drawFunctionPatterns(): void {
    const n = this.size;
    // Finder patterns with separators.
    for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = fr + r, cc = fc + c;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          this.set(rr, cc, ring !== 2 && ring !== 4);
        }
      }
    }
    // Timing patterns.
    for (let i = 8; i < n - 8; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    // Alignment patterns, skipping the three that overlap finders.
    const pos = ALIGNMENT[this.version - 1]!;
    for (const r of pos) {
      for (const c of pos) {
        if ((r === 6 && c === 6) || (r === 6 && c === pos[pos.length - 1]) || (r === pos[pos.length - 1] && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) this.set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
    // Reserve format areas (written later) and the dark module.
    this.drawFormat(0);
    if (this.version >= 7) this.drawVersion();
  }

  drawFormat(mask: number): void {
    const n = this.size;
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    // First copy, around the top-left finder: bits 0-7 down column 8, bits 8-14 along row 8 leftwards.
    for (let i = 0; i <= 5; i++) this.set(i, 8, bit(i));
    this.set(7, 8, bit(6));
    this.set(8, 8, bit(7));
    this.set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) this.set(8, 14 - i, bit(i));
    // Second copy: bits 0-7 along row 8 at the right, bits 8-14 up column 8 at the bottom.
    for (let i = 0; i < 8; i++) this.set(8, n - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) this.set(n - 15 + i, 8, bit(i));
    this.set(n - 8, 8, true); // dark module
  }

  drawVersion(): void {
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  /** Places codewords in the zigzag order (ISO 18004 7.7.3). */
  drawCodewords(data: readonly number[]): void {
    const n = this.size;
    let i = 0;
    const total = data.length * 8;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const upward = ((right + 1) & 2) === 0;
          const r = upward ? n - 1 - vert : vert;
          if (this.fixed[r]![c]) continue;
          if (i < total) this.dark[r]![c] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }

  applyMask(mask: number): void {
    const fn = MASKS[mask]!;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (!this.fixed[r]![c] && fn(r, c)) this.dark[r]![c] = !this.dark[r]![c];
      }
    }
  }
}

/**
 * Penalty score of a finished matrix (ISO 18004 7.8.3, N1=3, N2=3, N3=40, N4=10).
 * Rule 3 reads "1:1:3:1:1 with 4 light modules beside it" as whole runs of
 * modules, counting the quiet zone around the symbol as light. This is the
 * reading of Project Nayuki's reference encoder, which the tests compare with.
 */
export function penalty(m: readonly (readonly boolean[])[]): number {
  const n = m.length;
  let score = 0;

  for (const byColumn of [false, true]) {
    for (let a = 0; a < n; a++) {
      const at = (b: number) => (byColumn ? m[b]![a]! : m[a]![b]!);
      // history[0] is the latest finished run; runs alternate colour, the first being light.
      const history = [0, 0, 0, 0, 0, 0, 0];
      const push = (run: number) => {
        if (history[0] === 0) run += n; // the quiet zone before the first run
        history.pop();
        history.unshift(run);
      };
      const finderLike = (): number => {
        const u = history[1]!;
        const core = u > 0 && history[2] === u && history[3] === u * 3 && history[4] === u && history[5] === u;
        return (core && history[0]! >= u * 4 && history[6]! >= u ? 1 : 0) + (core && history[6]! >= u * 4 && history[0]! >= u ? 1 : 0);
      };
      let colour = false;
      let run = 0;
      for (let b = 0; b < n; b++) {
        if (at(b) === colour) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          push(run);
          if (!colour) score += finderLike() * 40;
          colour = at(b);
          run = 1;
        }
      }
      // End of the line: close the last run, then the quiet zone after it.
      if (colour) {
        push(run);
        run = 0;
      }
      run += n;
      push(run);
      score += finderLike() * 40;
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r]![c];
      if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1]) score += 3;
    }
  }
  // Rule 4: 10 points for each full 5% the dark share is away from 50%.
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += k * 10;
  return score;
}

export interface QrOptions {
  /** Force a mask (0 to 7) instead of choosing the lowest penalty. */
  mask?: number;
  /** Force a version (1 to 10) instead of the smallest that fits. */
  version?: number;
}

export interface QrCode {
  version: number;
  mask: number;
  /** size x size, row-major, true = dark. */
  modules: boolean[][];
}

/** Encodes text (as UTF-8) or bytes. Throws QrTooLongError if it needs more than version 10. */
export function encodeQr(input: string | Uint8Array, opts: QrOptions = {}): QrCode {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const smallest = versionFor(bytes.length);
  if (smallest === null) throw new QrTooLongError(`QR codes here hold at most ${MAX_BYTES} bytes; this has ${bytes.length}.`);
  const version = opts.version ?? smallest;
  if (!Number.isInteger(version) || version < smallest || version > MAX_VERSION) throw new RangeError(`Version ${version} cannot hold ${bytes.length} bytes.`);

  const grid = new Grid(version);
  grid.drawFunctionPatterns();
  grid.drawCodewords(codewords(bytes, version));

  const tryMask = (mask: number): boolean[][] => {
    const g = new Grid(version);
    for (let r = 0; r < g.size; r++) {
      g.dark[r] = grid.dark[r]!.slice();
      g.fixed[r] = grid.fixed[r]!.slice();
    }
    g.applyMask(mask);
    g.drawFormat(mask);
    return g.dark;
  };

  if (opts.mask !== undefined) {
    if (!Number.isInteger(opts.mask) || opts.mask < 0 || opts.mask > 7) throw new RangeError(`Mask must be 0 to 7.`);
    return { version, mask: opts.mask, modules: tryMask(opts.mask) };
  }
  let best: QrCode | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const modules = tryMask(mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = { version, mask, modules };
    }
  }
  return best!;
}

export interface SvgOptions {
  /** Light modules around the code; the standard asks for 4. */
  quietZone?: number;
  /** Accessible name for the image. */
  title?: string;
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * An SVG of the code: black on white with a quiet zone, one path of horizontal
 * runs, sized by its viewBox so CSS can scale it without blurring.
 */
export function qrSvg(input: string | Uint8Array, opts: SvgOptions = {}): string {
  const { modules } = encodeQr(input);
  const q = opts.quietZone ?? 4;
  const n = modules.length;
  const full = n + 2 * q;
  let d = "";
  for (let r = 0; r < n; r++) {
    const row = modules[r]!;
    for (let c = 0; c < n; c++) {
      if (!row[c]) continue;
      let end = c;
      while (end + 1 < n && row[end + 1]) end++;
      d += `M${c + q} ${r + q}h${end - c + 1}v1h-${end - c + 1}z`;
      c = end;
    }
  }
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"` +
    `${opts.title ? ` role="img" aria-label="${escapeXml(opts.title)}"` : ""}>` +
    `${title}<rect width="${full}" height="${full}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  );
}
