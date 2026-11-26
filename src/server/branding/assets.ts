// Theme asset uploads (TECH-SPEC 5.3, 9.2, 12.4): the logo and the display background picture.
// Files are checked by their first bytes, never by the name or type the browser sent.

export type AssetKind = "logo" | "displayBackground";

export const ASSET_KINDS: readonly AssetKind[] = ["logo", "displayBackground"];

const MB = 1024 * 1024;

interface KindRule { maxBytes: number; types: string[]; label: string; typesText: string }

export const ASSET_RULES: Record<AssetKind, KindRule> = {
  logo: { maxBytes: 2 * MB, types: ["png", "svg", "jpg"], label: "logo", typesText: "a PNG, SVG or JPEG file" },
  displayBackground: { maxBytes: 5 * MB, types: ["jpg", "png", "webp"], label: "display background picture", typesText: "a JPEG, PNG or WebP picture" },
};

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Works out a file's type from its first bytes. Returns the extension it is stored under, or null. */
export function sniffType(b: Uint8Array): string | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpg";
  if (starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8)) return "webp";
  if (isSvg(b)) return "svg";
  return null;
}

/** An SVG is text (no NUL bytes) whose first element is <svg>, after an optional XML declaration, comments and doctype. */
function isSvg(b: Uint8Array): boolean {
  const head = b.subarray(0, 4096);
  if (head.includes(0)) return false;
  let text = new TextDecoder("utf-8", { fatal: false }).decode(head).replace(/^﻿/, "");
  text = text.replace(/^\s*<\?xml[^>]*\?>/, "");
  for (;;) {
    const before = text;
    text = text.replace(/^\s*<!--[\s\S]*?-->/, "").replace(/^\s*<!DOCTYPE[^>]*>/i, "");
    if (text === before) break;
  }
  return /^\s*<svg[\s>]/i.test(text);
}

export type AssetCheck = { ok: true; ext: string } | { ok: false; status: number; code: string; message: string };

export function checkAsset(kind: AssetKind, bytes: Uint8Array): AssetCheck {
  const rule = ASSET_RULES[kind];
  if (bytes.length === 0) return { ok: false, status: 400, code: "empty_file", message: "That file is empty." };
  if (bytes.length > rule.maxBytes) {
    return { ok: false, status: 413, code: "too_big", message: `The ${rule.label} must be ${rule.maxBytes / MB} MB or smaller.` };
  }
  const ext = sniffType(bytes);
  if (!ext || !rule.types.includes(ext)) {
    return { ok: false, status: 415, code: "wrong_type", message: `The ${rule.label} must be ${rule.typesText}.` };
  }
  return { ok: true, ext };
}

/** Generated name: kind, a short content hash and the sniffed extension, e.g. "logo-3f9a1c2b7d.png". */
export function assetName(kind: AssetKind, ext: string, bytes: Uint8Array): string {
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 10);
  const prefix = kind === "displayBackground" ? "background" : kind;
  return `${prefix}-${hash}.${ext}`;
}
