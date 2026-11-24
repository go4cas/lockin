// Scheduler for the engine's timed events (TECH-SPEC 7.3): the lock at
// `locksAt`, the `last_seconds` line and the lobby line refresh. The engine
// takes a Clock and a Scheduler so tests run on fake time (13.1).

import type { Clock } from "../auth.ts";

export interface Scheduler {
  /** Runs `fn` once the clock reaches `time` (server ms). Returns a handle for cancel(). */
  at(time: number, fn: () => void): number;
  cancel(handle: number): void;
}

interface Job { id: number; time: number; fn: () => void }

/**
 * A scheduler driven by a Clock. Jobs fire from a real timer set for the
 * earliest job, and on `runDue()`, which runs every job whose time has come.
 * With the system clock this is just setTimeout; with a fake clock, tests move
 * the clock and call `runDue()`.
 */
export class ClockScheduler implements Scheduler {
  private jobs: Job[] = [];
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** `log` gets a job's error; a job that throws never stops the others or the timer (SA-09). */
  constructor(private clock: Clock, private log: (message: string) => void = (m) => console.error(m)) {}

  at(time: number, fn: () => void): number {
    const id = this.nextId++;
    this.jobs.push({ id, time, fn });
    this.arm();
    return id;
  }

  cancel(handle: number): void {
    this.jobs = this.jobs.filter((j) => j.id !== handle);
    this.arm();
  }

  /** Runs every job that is due, earliest first. */
  runDue(): void {
    try {
      for (;;) {
        const now = this.clock.now();
        const due = this.jobs.filter((j) => j.time <= now).sort((a, b) => a.time - b.time || a.id - b.id)[0];
        if (!due) break;
        this.jobs = this.jobs.filter((j) => j !== due);
        try {
          due.fn();
        } catch (e) {
          // SA-09: an exception thrown from a timer would end the process. Log it and go on.
          this.log(`A timed job failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        }
      }
    } finally {
      this.arm();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.jobs = [];
  }

  private arm(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.stopped || this.jobs.length === 0) return;
    const first = Math.min(...this.jobs.map((j) => j.time));
    const delay = Math.min(Math.max(0, first - this.clock.now()), 2_000_000_000);
    this.timer = setTimeout(() => { this.timer = null; this.runDue(); }, delay);
  }
}
