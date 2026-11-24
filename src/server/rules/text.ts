// Typed-answer text rules (TECH-SPEC 8.1, 8.2): normalising, similarity, grouping.
// Pure functions: no I/O, no engine state.

import type { AnswerSpec } from "../../shared/formats.ts";
import type { AnswerGroup, Mark } from "../../shared/rules-api.ts";

const ARTICLE = /^(?:the|a|an) /;

/**
 * 8.1, in order: NFKD and drop combining marks; lower-case; `&` to `and`;
 * drop everything but letters, digits and spaces; collapse spaces; trim;
 * remove one leading "the ", "a " or "an ".
 * Any whitespace (tab, newline, no-break space) counts as a space, so words
 * separated by a tab are not glued together.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s/gu, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/ +/g, " ")
    .trim()
    .replace(ARTICLE, "");
}

/**
 * Optimal string alignment (restricted Damerau-Levenshtein) distance,
 * counted in code points.
 */
export function osaDistance(a: string, b: string): number {
  const s = Array.from(a);
  const t = Array.from(b);
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  // Three rolling rows: i-2, i-1, i.
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d = Math.min(d, prev2[j - 2]! + 1);
      }
      cur[j] = d;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m]!;
}

/** 8.2: `1 - distance / max(length)` on the normalised strings; two empty strings are 1. */
export function similarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  const len = Math.max(Array.from(x).length, Array.from(y).length);
  if (len === 0) return 1;
  return 1 - osaDistance(x, y) / len;
}

/** True when the typed text matches one of the accepted answers after normalising. */
export function matchesAccepted(text: string, accepted: readonly string[]): boolean {
  const key = normalise(text);
  // An answer that normalises to nothing ("???") is never auto-matched; the host decides.
  if (key === "") return false;
  return accepted.some((a) => normalise(a) === key);
}

/**
 * 8.2: groups typed answers by normalised text for the review queue.
 * `answers` are in the order received, so `display` is the first raw answer in
 * each group. Groups come back with the closest match to an accepted answer
 * first (ties keep the order received; groups with no accepted answer to
 * compare with go last).
 */
export function groupText(
  spec: AnswerSpec & { type: "text" },
  answers: { teamId: string; text: string; mark: Mark }[],
): AnswerGroup[] {
  const byKey = new Map<string, { group: AnswerGroup; marks: Set<Mark> }>();
  for (const a of answers) {
    const key = normalise(a.text);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { group: { key, display: a.text.trim(), teamIds: [], mark: a.mark, nearest: null }, marks: new Set() };
      byKey.set(key, entry);
    }
    if (!entry.group.teamIds.includes(a.teamId)) entry.group.teamIds.push(a.teamId);
    entry.marks.add(a.mark);
  }

  const groups: AnswerGroup[] = [];
  for (const { group, marks } of byKey.values()) {
    group.mark = marks.size === 1 ? [...marks][0]! : "pending";
    group.nearest = nearestAccepted(group.key, spec.accepted);
    groups.push(group);
  }
  const score = (g: AnswerGroup) => (g.nearest ? g.nearest.similarity : -1);
  // Array.prototype.sort is stable, so equal scores keep the order received.
  return groups.sort((a, b) => score(b) - score(a));
}

function nearestAccepted(key: string, accepted: readonly string[]): AnswerGroup["nearest"] {
  let best: AnswerGroup["nearest"] = null;
  for (const raw of accepted) {
    const sim = similarity(key, raw);
    if (!best || sim > best.similarity) best = { accepted: raw, similarity: sim };
  }
  return best;
}
