// Security event log (audit SA-17). One line per event with the client IP and never a
// secret: no password, token, setup code, rejoin or move code, pairing code or room code.
// The log itself is rate-limited: at most one line per event type and IP every 10 s; the
// ones held back are counted and the count is added to the next line (or to `flush`).

import type { Clock } from "./auth.ts";

/** Events this server logs. Names are stable so a log search can rely on them. */
export type SecurityEvent =
  | "signed_in" | "sign_in_failed" | "signed_out" | "setup_code_wrong" | "password_set"
  | "limiter_tripped" | "connection_refused"
  | "display_paired" | "display_unpaired" | "displays_unpaired_all"
  | "team_joined" | "team_rejoined" | "team_moved" | "team_removed";

/** One line per event type and IP in this window. */
export const SECURITY_LOG_WINDOW_MS = 10_000;
/** Keys kept before old ones are dropped, so a flood of addresses cannot grow the map without end. */
const MAX_KEYS = 10_000;

interface Entry { firstAt: number; held: number }

export class SecurityLog {
  private entries = new Map<string, Entry>();

  constructor(private clock: Clock, private write: (line: string) => void) {}

  /** Logs `Security: <event> from <ip>[: detail]`, or counts it if one was logged in the last 10 s. */
  event(type: SecurityEvent, ip: string, detail?: string): void {
    const now = this.clock.now();
    const key = `${type}|${ip}`;
    const e = this.entries.get(key);
    if (e && now - e.firstAt < SECURITY_LOG_WINDOW_MS) {
      e.held++;
      return;
    }
    const more = e && e.held > 0 ? ` (and ${e.held} more like it in the last 10 s)` : "";
    this.entries.delete(key);
    this.entries.set(key, { firstAt: now, held: 0 });
    if (this.entries.size > MAX_KEYS) this.drop();
    this.write(`Security: ${type} from ${ip}${detail ? `: ${clean(detail)}` : ""}${more}`);
  }

  /** Writes the counts of events held back in windows that have ended, and forgets old keys. */
  flush(): void {
    const now = this.clock.now();
    for (const [key, e] of this.entries) {
      if (now - e.firstAt < SECURITY_LOG_WINDOW_MS) continue;
      this.entries.delete(key);
      if (e.held > 0) {
        const bar = key.indexOf("|");
        this.write(`Security: ${key.slice(0, bar)} from ${key.slice(bar + 1)} (and ${e.held} more like it in the last 10 s)`);
      }
    }
  }

  private drop(): void {
    this.flush();
    // Still too many (all recent): drop the oldest, which a Map keeps first.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_KEYS) break;
      this.entries.delete(key);
    }
  }
}

/** Team names are free text: keep a log line on one line and short. */
function clean(s: string): string {
  const one = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim();
  return [...one].length > 80 ? [...one].slice(0, 80).join("") + "…" : one;
}
