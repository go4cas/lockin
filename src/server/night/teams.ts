// Teams (TECH-SPEC 11): names, joining and rejoining with their limits (SA-01, SA-14, D1),
// move codes, renaming and removing. Split from the engine (code review LI-016); every change
// still goes through the engine's one unit of work.

import { randomInt } from "node:crypto";
import type { CommandResult } from "../ws.ts";
import { CODE_ALPHABET, randomCode, randomToken, sha256 } from "../auth.ts";
import type { TeamRec } from "./store.ts";
import { fail, len, OK, type NightReader, type Refusal, type TeamActor, type Work } from "./work.ts";

export const TEAM_COLOURS = 8;
export const ROOM_ALPHABET = "BCDFGHJKMNPQRSTVWXZ";
export const MOVE_CODE_TTL_MS = 10 * 60_000;
const REJOIN_TRIES = 5;
/** Wrong rejoin tries a minute from one client IP, across all its connections, before its wrong codes answer too_many_tries (a right code still works, SA-14). Higher than REJOIN_TRIES because a pub's phones often share one address. */
const REJOIN_TRIES_PER_IP = 10;
/**
 * SA-14: past REJOIN_TRIES_PER_IP an IP's wrong codes are refused but a right rejoin code still
 * works, so one phone guessing on the pub Wi-Fi cannot stop every other phone rejoining. This
 * many wrong codes a minute from one IP stops everything from it, so guessing stays bounded.
 */
const REJOIN_HARD_PER_IP = 60;
const MINUTE = 60_000;
/** Wrong room codes a minute (SA-01): per connection, per client IP, and from everyone together. */
export const JOIN_TRIES = 3;
export const JOIN_TRIES_PER_IP = 10;
export const JOIN_TRIES_TOTAL = 30;
/** How long joins by typed room code stay paused once JOIN_TRIES_TOTAL is reached (SA-01). */
export const JOIN_PAUSE_MS = 60_000;
/** Join key length (D1): 10 characters of the rejoin alphabet, about 50 bits. */
export const JOIN_KEY_LENGTH = 10;

// --- names (SA-15) ---------------------------------------------------------------------------

/** A ZWJ that does not join two emoji (a family, a profession): removed like any other invisible character. */
const LONE_ZWJ = /(?<!\p{Extended_Pictographic}️?)‍|‍(?!\p{Extended_Pictographic})/gu;

/**
 * A team name as stored and shown (audit SA-15): NFKC (so full-width and other compatibility
 * letters become plain ones), with control, zero-width and bidirectional characters removed
 * (except ZWJ inside an emoji) and runs of spaces made one. Length is counted after this.
 */
export function cleanTeamName(v: string): string {
  return v.normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "‍" ? c : ""))
    .replace(LONE_ZWJ, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** The key that makes two names the same team (SA-15): the clean name, case-folded, with every invisible joiner gone. */
export function teamNameKey(name: string): string {
  return cleanTeamName(name).replace(/‍/g, "").toUpperCase().toLowerCase();
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = cleanTeamName(v);
  return len(name) >= 1 && len(name) <= 30 ? name : null;
}

export function roomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return code;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function randomId(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}

// --- limits on wrong codes (SA-01, SA-14), kept in memory only --------------------------------

/** Wrong room codes and rejoin codes in the last minute, and the pause on typed joins. */
export class JoinGuard {
  /** Wrong rejoin tries in the last minute, keyed `c:<connId>` and `ip:<address>`. */
  readonly rejoinTries = new Map<string, number[]>();
  /** Wrong room codes in the last minute (SA-01), keyed `c:<connId>`, `ip:<address>` and `all`. */
  readonly joinTries = new Map<string, number[]>();
  /** Joins by typed room code are paused until this server time (SA-01); 0 when not paused. */
  pausedUntil = 0;

  /** Recent tries in a limiter map, dropping ones older than a minute. */
  recent(map: Map<string, number[]>, key: string, now: number): number[] {
    const list = (map.get(key) ?? []).filter((t) => t > now - MINUTE);
    if (list.length) map.set(key, list); else map.delete(key);
    return list;
  }

  /** Adds a try now under each key. */
  record(map: Map<string, number[]>, keys: string[], now: number): void {
    for (const key of keys) map.set(key, [...this.recent(map, key, now), now]);
  }

  /** Drops keys with no try in the last minute once a map grows, so it cannot only grow (REVIEW finding 8). */
  prune(now: number): void {
    for (const map of [this.rejoinTries, this.joinTries]) {
      if (map.size < 1_000) continue;
      for (const [key, list] of map) if (!list.some((t) => t > now - MINUTE)) map.delete(key);
    }
  }

  /** A new night or a new room code: wrong room codes start again (rejoin tries are kept). */
  resetJoins(): void {
    this.joinTries.clear();
    this.pausedUntil = 0;
  }
}

/** Move codes (11.3): short-lived, in memory only, so a restart drops them. */
export type MoveCodes = Map<string, { teamId: string; expires: number }>;

// --- joining (11.1, 11.2a) -------------------------------------------------------------------

function rightRoomCode(r: NightReader, a: Record<string, unknown>): boolean {
  return typeof a.roomCode === "string" && a.roomCode.trim().toUpperCase() === r.m!.night.roomCode;
}

/** True if the join carries this night's join key (from the QR code or join link). */
function hasJoinKey(r: NightReader, a: Record<string, unknown>): boolean {
  const key = r.state.joinKey;
  return !!key && typeof a.joinKey === "string" && a.joinKey.trim().toUpperCase() === key;
}

/** Checks on a join that need no change: a clean name, not already in a team, name free, room left. */
function joinCheck(r: NightReader, actor: TeamActor, a: Record<string, unknown>): { ok: true; name: string } | Refusal {
  const name = cleanName(a.name);
  if (!name) return fail("bad_args", "Team names are 1 to 30 characters.");
  if (actor.teamId && r.m!.teams.get(actor.teamId)?.removedAt === null) return fail("bad_args", "This phone is already in a team.");
  const nameKey = teamNameKey(name);
  if (r.teams().some((t) => t.nameKey === nameKey)) return fail("team_has_phone");
  if (r.teams().length >= r.quiz.settings.maxTeams) return fail("night_full");
  return { ok: true, name };
}

/**
 * Room code limits (SA-01), before the unit of work. A join with the night's join key skips them
 * all: that is how phones that scanned the QR code get in while someone is guessing. A typed
 * code is limited per connection, per IP and in total; while any limit applies, every typed join
 * answers too_many_tries, right code or not, so the answer says nothing about the code.
 * `paused` is called when the total is reached (the host is told).
 */
export function joinPrecheck(r: NightReader, guard: JoinGuard, actor: TeamActor, a: Record<string, unknown>, paused: () => void): CommandResult | null {
  if (!hasJoinKey(r, a)) {
    const now = r.now();
    const connKey = `c:${actor.connId}`;
    const ipKey = actor.ip ? `ip:${actor.ip}` : null;
    if (now < guard.pausedUntil) return fail("too_many_tries");
    if (guard.recent(guard.joinTries, connKey, now).length >= JOIN_TRIES) return fail("too_many_tries");
    if (ipKey && guard.recent(guard.joinTries, ipKey, now).length >= JOIN_TRIES_PER_IP) return fail("too_many_tries");
    if (!rightRoomCode(r, a)) {
      guard.prune(now);
      guard.record(guard.joinTries, ipKey ? [connKey, ipKey, "all"] : [connKey, "all"], now);
      if ((guard.joinTries.get("all")?.length ?? 0) >= JOIN_TRIES_TOTAL) {
        guard.pausedUntil = now + JOIN_PAUSE_MS;
        guard.joinTries.delete("all");
        paused();
      }
      return fail("room_code");
    }
  }
  const check = joinCheck(r, actor, a);
  return check.ok ? null : check;
}

function newRejoinCode(w: Work): string {
  const used = new Set([...w.m.teams.values()].map((t) => t.rejoinCode));
  for (;;) { const c = randomCode(6); if (!used.has(c)) return c; }
}

export function teamJoin(w: Work, actor: TeamActor, a: Record<string, unknown>): CommandResult {
  const n = w.m.night;
  if (!hasJoinKey(w.read, a) && !rightRoomCode(w.read, a)) return fail("room_code");
  const check = joinCheck(w.read, actor, a);
  if (!check.ok) return check;
  const name = check.name;
  const nameKey = teamNameKey(name);
  const used = new Map<number, number>();
  for (const t of w.read.teams()) used.set(t.colour, (used.get(t.colour) ?? 0) + 1);
  let colour = 1;
  for (let c = 1; c <= TEAM_COLOURS; c++) if ((used.get(c) ?? 0) < (used.get(colour) ?? 0)) colour = c;
  const token = randomToken();
  const team: TeamRec = {
    id: `t-${randomId(8)}`, name, nameKey, colour, tokenHash: sha256(token), rejoinCode: newRejoinCode(w),
    jokerRound: null, joinedAt: w.now(), removedAt: null,
  };
  w.m.teams.set(team.id, team);
  w.dirty.teams.add(team.id);
  w.s.flash = w.flash("team_joined", team.id, { team: name });
  w.setLine("lobby", "lobby", { n: w.read.teams().length });
  return { ok: true, result: { teamId: team.id, token, nightId: n.id } };
}

// --- rejoining and moving (11.2, 11.3) -------------------------------------------------------

/** The team a rejoin or move code names, or null (no side effects). */
function rejoinTarget(r: NightReader, moveCodes: MoveCodes, a: Record<string, unknown>): { team: TeamRec; code: string; viaMove: boolean } | null {
  const code = typeof a.code === "string" ? a.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]+$/.test(code) || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  let team: TeamRec | undefined;
  const move = moveCodes.get(code);
  if (move && move.expires > r.now()) team = r.m!.teams.get(move.teamId);
  const viaMove = !!team;
  if (!team && code.length === 6) team = r.teams().find((t) => t.rejoinCode === code);
  return team && team.removedAt === null ? { team, code, viaMove } : null;
}

/** Rejoin limits and code lookup, before the unit of work (SA-04): a refusal here never copies the night. */
export function rejoinPrecheck(r: NightReader, guard: JoinGuard, moveCodes: MoveCodes, actor: TeamActor, a: Record<string, unknown>): CommandResult | null {
  const now = r.now();
  const connKey = `c:${actor.connId}`;
  const ipKey = actor.ip ? `ip:${actor.ip}` : null;
  if (guard.recent(guard.rejoinTries, connKey, now).length >= REJOIN_TRIES) return fail("too_many_tries");
  const ipTries = ipKey ? guard.recent(guard.rejoinTries, ipKey, now).length : 0;
  const target = rejoinTarget(r, moveCodes, a);
  // Move codes (8 characters, made by the host for one team) skip the IP limits (SA-14).
  if (!target?.viaMove && ipTries >= REJOIN_HARD_PER_IP) return fail("too_many_tries");
  if (target) return null;
  guard.prune(now);
  guard.record(guard.rejoinTries, ipKey ? [connKey, ipKey] : [connKey], now);
  return fail(ipTries >= REJOIN_TRIES_PER_IP ? "too_many_tries" : "bad_code");
}

export function teamRejoin(w: Work, actor: TeamActor, a: Record<string, unknown>): CommandResult {
  const target = rejoinTarget(w.read, w.moveCodes, a);
  if (!target) return fail("bad_code");   // the pre-check found it; kept for direct callers
  const { team, code } = target;
  if (target.viaMove) w.moveCodes.delete(code);
  const token = randomToken();
  team.tokenHash = sha256(token);
  team.rejoinCode = newRejoinCode(w);
  w.dirty.teams.add(team.id);
  w.bye({ teamId: team.id, reason: "moved", keepConn: actor.connId });
  return { ok: true, result: { teamId: team.id, token, nightId: w.m.night.id } };
}

// --- host team commands (H-06, 11.3, D1) ------------------------------------------------------

/** An active (not removed) team by id, or null. */
export function activeTeam(r: NightReader, id: unknown): TeamRec | null {
  if (typeof id !== "string") return null;
  const t = r.m!.teams.get(id);
  return t && t.removedAt === null ? t : null;
}

export function teamRename(w: Work, a: Record<string, unknown>): CommandResult {
  const team = activeTeam(w.read, a.teamId);
  if (!team) return fail("not_found", "That team could not be found.");
  const name = cleanName(a.name);
  if (!name) return fail("bad_args", "Team names are 1 to 30 characters.");
  const key = teamNameKey(name);
  if (w.read.teams().some((t) => t.id !== team.id && t.nameKey === key)) return fail("name_taken");
  team.name = name;
  team.nameKey = key;
  w.dirty.teams.add(team.id);
  return OK;
}

export function teamRemove(w: Work, a: Record<string, unknown>): CommandResult {
  const team = activeTeam(w.read, a.teamId);
  if (!team) return fail("not_found", "That team could not be found.");
  team.removedAt = w.now();
  team.tokenHash = null;
  // Free the name for a new team: name_key is unique per night (6.2), so a removed team's key gets its id appended.
  team.nameKey = `${team.nameKey}#${team.id}`;
  w.dirty.teams.add(team.id);
  w.bye({ teamId: team.id, reason: "removed" });
  w.setLine("lobby", "lobby", { n: w.read.teams().length });
  return OK;
}

export function teamMoveCode(w: Work, a: Record<string, unknown>): CommandResult {
  const team = activeTeam(w.read, a.teamId);
  if (!team) return fail("not_found", "That team could not be found.");
  const now = w.now();
  for (const [c, v] of w.moveCodes) if (v.expires <= now || v.teamId === team.id) w.moveCodes.delete(c);
  let code: string;
  do code = randomCode(8); while (w.moveCodes.has(code));
  w.moveCodes.set(code, { teamId: team.id, expires: now + MOVE_CODE_TTL_MS });
  return { ok: true, result: { code, url: `${w.publicUrl}/m/${code}` } };
}

/** New room code and join key for the open night, keeping the teams (D1): for a code that has leaked. */
export function newRoomCode(w: Work): CommandResult {
  const n = w.m.night;
  let code = n.roomCode;
  while (code === n.roomCode) code = roomCode();
  n.roomCode = code;
  w.s.joinKey = randomCode(JOIN_KEY_LENGTH);
  w.dirty.night = true;
  w.after(() => w.guard.resetJoins());
  return { ok: true, result: { roomCode: code } };
}
