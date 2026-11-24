// SA-05: Lock-In ships with the Bun runtime inside the binary, so a Bun security release
// only helps once the binary is rebuilt. The server refuses to start on a runtime older
// than MIN_BUN (raise it with each Bun security release; package.json engines and CI match).

export const MIN_BUN = "1.4.5";

/** Compares dotted versions ("1.4.10" > "1.4.5"); pre-release tags are ignored. */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => v.split(/[-+]/)[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Why this runtime is too old to serve, or null if it is fine. */
export function runtimeProblem(version: string = Bun.version): string | null {
  return versionAtLeast(version, MIN_BUN)
    ? null
    : `this Bun is ${version}, and Lock-In needs ${MIN_BUN} or later for its security fixes. Update Bun (bun upgrade) and rebuild the binary.`;
}
