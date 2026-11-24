// Auto-marking (TECH-SPEC 8.2). Pure functions: no I/O, no engine state.

import type { AnswerSpec } from "../../shared/formats.ts";
import type { AnswerValue, Mark } from "../../shared/rules-api.ts";
import { matchesAccepted } from "./text.ts";

const EPSILON = 1e-9;
const DAY_MS = 86_400_000;

type Precision = "year" | "date" | "time";

/**
 * Reads a datetime value at a precision. Returns its normal form (`YYYY`,
 * `YYYY-MM-DD` or `HH:MM`) and an ordinal in the unit used for distance
 * (years, days or minutes), or null if it is not a valid value.
 * Accepts single-digit month, day and hour ("1969-7-20", "9:05") and drops
 * seconds on a time ("20:17:30" is "20:17").
 */
export function parseDatetime(precision: Precision, raw: string): { key: string; ordinal: number } | null {
  const s = raw.trim();
  if (precision === "year") {
    const m = /^(\d{1,4})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]);
    return { key: String(y).padStart(4, "0"), ordinal: y };
  }
  if (precision === "date") {
    const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const date = new Date(0);
    date.setUTCFullYear(y, mo - 1, d);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    const key = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { key, ordinal: Math.round(date.getTime() / DAY_MS) };
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]), sec = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || sec > 59) return null;
  return { key: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, ordinal: h * 60 + min };
}

/** A missing or malformed value (for example the wrong answer type) is treated as no answer. */
function isValue(v: unknown): v is AnswerValue {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

/** True for answer specs that are marked by closeness at the lock (markClosest). */
export function needsClosest(spec: AnswerSpec): boolean {
  return spec.type === "closest" || (spec.type === "datetime" && spec.scoring === "closest");
}

/**
 * 8.2 for every type except closest scoring. Closest questions (and datetime
 * set to closest) stay `pending` here: they need every team's answer, so the
 * engine marks them with markClosest at the lock. No answer, or an answer of
 * the wrong type, is `wrong`. A typed answer is never auto-`wrong`.
 */
export function autoMark(spec: AnswerSpec, value: AnswerValue): Mark {
  if (needsClosest(spec)) return "pending";
  if (!isValue(value)) return "wrong";
  switch (spec.type) {
    case "text":
      if (value.type !== "text") return "wrong";
      return matchesAccepted(value.text, spec.accepted) ? "correct" : "pending";
    case "choice":
      return value.type === "choice" && value.index === spec.correct ? "correct" : "wrong";
    case "number":
      return value.type === "number" && Number.isFinite(value.value) && Math.abs(value.value - spec.value) < EPSILON
        ? "correct" : "wrong";
    case "datetime": {
      if (value.type !== "datetime") return "wrong";
      const want = parseDatetime(spec.precision, spec.value);
      const got = parseDatetime(spec.precision, value.value);
      return want && got && want.key === got.key ? "correct" : "wrong";
    }
    default:
      return "wrong";
  }
}

/** Distance from the right answer in the question's unit, or null when the value cannot be compared. */
function distance(spec: AnswerSpec, value: AnswerValue | undefined): number | null {
  if (!isValue(value)) return null;
  if (spec.type === "closest") {
    if (value.type !== "number" || !Number.isFinite(value.value)) return null;
    return Math.abs(value.value - spec.value);
  }
  if (spec.type === "datetime") {
    if (value.type !== "datetime") return null;
    const want = parseDatetime(spec.precision, spec.value);
    const got = parseDatetime(spec.precision, value.value);
    if (!want || !got) return null;
    return Math.abs(got.ordinal - want.ordinal);
  }
  return null;
}

/**
 * 8.2 closest scoring, run at the lock with every team's answer.
 * `closest`: every team at the smallest distance is `correct`, the rest `wrong`.
 * `range`: every team within `range` (missing range = 0) is `correct`.
 * A team in the map with no usable value is `wrong`; teams not in the map are
 * not in the result (the engine marks a missing answer `wrong`).
 * For a spec that is not marked by closeness, each value is auto-marked.
 */
export function markClosest(
  spec: AnswerSpec,
  values: Map<string, AnswerValue>,
  scoring: "closest" | "range",
): Map<string, Mark> {
  const out = new Map<string, Mark>();
  if (!needsClosest(spec)) {
    for (const [teamId, v] of values) out.set(teamId, isValue(v) ? autoMark(spec, v) : "wrong");
    return out;
  }
  const dist = new Map<string, number | null>();
  for (const [teamId, v] of values) dist.set(teamId, distance(spec, v));

  let limit: number;
  if (scoring === "range") {
    const range = "range" in spec && typeof spec.range === "number" && Number.isFinite(spec.range) ? Math.abs(spec.range) : 0;
    limit = range;
  } else {
    const known = [...dist.values()].filter((d): d is number => d !== null);
    limit = known.length ? Math.min(...known) : -1;
  }
  for (const [teamId, d] of dist) {
    out.set(teamId, d !== null && limit >= 0 && d <= limit + EPSILON ? "correct" : "wrong");
  }
  return out;
}
