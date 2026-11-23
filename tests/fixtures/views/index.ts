// Loads every view fixture: name ("tv/leaderboard-20") -> view.
import { join } from "node:path";
import type { View } from "../../../src/shared/protocol.ts";

export const FIXTURE_DIR = import.meta.dir;

export async function loadFixtures(): Promise<Map<string, View>> {
  const names = [...new Bun.Glob("{host,tv,team}/*.ts").scanSync({ cwd: FIXTURE_DIR })].sort();
  const out = new Map<string, View>();
  for (const file of names) {
    const mod = await import(join(FIXTURE_DIR, file));
    out.set(file.replace(/\.ts$/, ""), mod.default as View);
  }
  return out;
}
