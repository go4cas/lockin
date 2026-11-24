// Release thread: the server setup files in deploy/ (docs/RELEASE.md).
// The backup and restore scripts are run for real against a temporary data folder whose
// database is still open with writes in its write-ahead log, as on a quiz night.

import { describe, expect, test, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const DEPLOY = join(ROOT, "deploy");
const SCRIPTS = ["setup.sh", "backup.sh", "restore.sh"];
const has = (cmd: string) => Bun.spawnSync(["sh", "-c", `command -v ${cmd}`]).exitCode === 0;
// On CI these must run, not skip: ci.yml installs sqlite3 and shellcheck if the runner lacks them.
const CI = !!process.env.CI;
const HAS_SQLITE = CI || has("sqlite3");
const HAS_SHELLCHECK = CI || has("shellcheck");
const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "lockin-deploy-"));
  temps.push(d);
  return d;
};
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function run(args: string[]) {
  const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}
const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);

describe("deploy scripts", () => {
  test.each(SCRIPTS)("%s parses and is executable", (s) => {
    const r = run(["bash", "-n", join(DEPLOY, s)]);
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
    expect(statSync(join(DEPLOY, s)).mode & 0o111).not.toBe(0);
  });

  test.skipIf(!HAS_SHELLCHECK)("shellcheck finds nothing", () => {
    const r = run(["shellcheck", ...SCRIPTS.map((s) => join(DEPLOY, s))]);
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
  });

  test("setup writes a loopback bind and never opens a port", () => {
    const s = readFileSync(join(DEPLOY, "setup.sh"), "utf8");
    expect(s).toContain("LOCKIN_BIND=127.0.0.1");
    expect(s).not.toMatch(/ufw allow|iptables -A|0\.0\.0\.0 *$/m);
    expect(s).toContain("sha256sum -c");
  });

  test("setup refuses a port another app uses and checks it is Lock-In that answers", () => {
    const s = readFileSync(join(DEPLOY, "setup.sh"), "utf8");
    expect(s).toContain('ss -Hltnp "sport = :$port"');
    expect(s).toContain(`*'"app":"lockin"'*`);
    // Retention goes to Lock-In's own namespace, never the shared journal.
    expect(s).toContain("/etc/systemd/journald@lockin.conf");
    expect(s).not.toContain("journald.conf.d");
  });
});

describe("systemd units", () => {
  const unit = readFileSync(join(DEPLOY, "systemd/lockin.service"), "utf8");
  const lines = new Set(unit.split("\n").map((l) => l.trim()));

  test("the server restarts forever and runs as its own user (SA-09)", () => {
    for (const want of ["Restart=always", "RestartSec=1", "StartLimitIntervalSec=0", "User=lockin", "Group=lockin"]) expect(lines.has(want)).toBe(true);
  });

  test("the hardening list from SA-09 is there", () => {
    for (const want of ["NoNewPrivileges=yes", "ProtectSystem=strict", "ReadWritePaths=/var/lib/lockin", "PrivateTmp=yes", "MemoryMax=1G", "CapabilityBoundingSet=", "UMask=0077", "StateDirectoryMode=0700"]) {
      expect(lines.has(want)).toBe(true);
    }
    // Bun's JIT needs writable, executable memory.
    expect(unit).not.toMatch(/^MemoryDenyWriteExecute=yes/m);
  });

  test("only this machine can connect (SA-06)", () => {
    expect(lines.has("IPAddressAllow=localhost")).toBe(true);
    expect(lines.has("IPAddressDeny=any")).toBe(true);
    expect(unit).toContain("ExecStart=/usr/local/bin/lockin serve --data /var/lib/lockin");
  });

  test("the backup runs as lockin without network, from a daily timer", () => {
    const b = readFileSync(join(DEPLOY, "systemd/lockin-backup.service"), "utf8");
    expect(b).toMatch(/^User=lockin$/m);
    expect(b).toMatch(/^PrivateNetwork=yes$/m);
    expect(readFileSync(join(DEPLOY, "systemd/lockin-backup.timer"), "utf8")).toMatch(/^Persistent=true$/m);
  });

  test("logs go to their own namespace and share the CPU (shared server)", () => {
    expect(lines.has("LogNamespace=lockin")).toBe(true);
    expect(lines.has("CPUQuota=150%")).toBe(true);
  });

  test("journal retention is 30 days (SA-17)", () => {
    expect(readFileSync(join(DEPLOY, "journald-lockin.conf"), "utf8")).toMatch(/^MaxRetentionSec=30day$/m);
  });
});

describe.skipIf(!HAS_SQLITE)("backup and restore", () => {
  /** A data folder like a running server's: 0700 folders, 0600 files, a database with unflushed WAL writes. */
  function dataFolder() {
    const data = join(temp(), "data");
    for (const d of ["", "quizzes/pilot", "theme/assets", "backups"]) mkdirSync(join(data, d), { recursive: true, mode: 0o700 });
    writeFileSync(join(data, "auth.json"), '{"hash":"x"}\n', { mode: 0o600 });
    writeFileSync(join(data, "quizzes/pilot/quiz.json"), '{"title":"Pilot"}\n', { mode: 0o600 });
    writeFileSync(join(data, "backups/old-note.txt"), "not backed up\n", { mode: 0o600 });
    const db = new Database(join(data, "lockin.db"));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA wal_autocheckpoint = 0");
    db.exec("CREATE TABLE answers (team TEXT, answer TEXT)");
    db.exec("INSERT INTO answers VALUES ('Quizzy Rascals', 'Paris')");
    chmodSync(join(data, "lockin.db"), 0o600);
    return { data, db };
  }

  test("a backup holds the WAL's writes and keeps the modes; restore brings it back", () => {
    const { data, db } = dataFolder();
    try {
      expect(statSync(join(data, "lockin.db-wal")).size).toBeGreaterThan(0);
      // Two older archives; with --keep 2 the oldest goes.
      for (const n of ["lockin-backup-20200101-000000.tar.gz", "lockin-backup-20200102-000000.tar.gz"]) writeFileSync(join(data, "backups", n), "", { mode: 0o600 });
      const r = run([join(DEPLOY, "backup.sh"), "--data", data, "--keep", "2"]);
      expect(r.code).toBe(0);
      const archives = readdirSync(join(data, "backups")).filter((f) => f.endsWith(".tar.gz")).sort();
      expect(archives.length).toBe(2);
      expect(archives[0]).toBe("lockin-backup-20200102-000000.tar.gz");
      const archive = join(data, "backups", archives[1]!);
      expect(mode(archive)).toBe("600");
      expect(mode(join(data, "backups"))).toBe("700");

      const listing = run(["tar", "-tvzf", archive]).out;
      expect(listing).not.toContain("old-note.txt");
      expect(listing).not.toContain("lockin.db-wal");
      for (const line of listing.trim().split("\n")) expect(line).toMatch(/^(-rw-------|drwx------) /);

      // Restore into a fresh server's folder, which already has its own backups.
      const target = join(temp(), "data");
      mkdirSync(join(target, "backups"), { recursive: true, mode: 0o700 });
      writeFileSync(join(target, "backups/keep-me.txt"), "x");
      writeFileSync(join(target, "setup-code"), "ABCD2345", { mode: 0o600 });
      const rr = run([join(DEPLOY, "restore.sh"), archive, "--data", target, "--no-service"]);
      expect(rr.code).toBe(0);
      const restored = new Database(join(target, "lockin.db"), { readonly: true });
      expect(restored.query("SELECT answer FROM answers").all()).toEqual([{ answer: "Paris" }]);
      restored.close();
      expect(readFileSync(join(target, "quizzes/pilot/quiz.json"), "utf8")).toContain("Pilot");
      expect(mode(target)).toBe("700");
      expect(mode(join(target, "auth.json"))).toBe("600");
      expect(mode(join(target, "lockin.db"))).toBe("600");
      expect(mode(join(target, "quizzes/pilot"))).toBe("700");
      expect(readFileSync(join(target, "backups/keep-me.txt"), "utf8")).toBe("x");
      // What was there is moved aside, not deleted.
      const aside = readdirSync(join(target, "..")).find((f) => f.startsWith("data.before-restore-"));
      expect(aside).toBeDefined();
      expect(readFileSync(join(target, "..", aside!, "setup-code"), "utf8")).toBe("ABCD2345");
    } finally {
      db.close();
    }
  });

  test("restore refuses an archive with paths outside its folder", () => {
    const dir = temp();
    mkdirSync(join(dir, "lockin-backup-20260101-000000"), { mode: 0o700 });
    writeFileSync(join(dir, "lockin-backup-20260101-000000/lockin.db"), "");
    writeFileSync(join(dir, "evil.txt"), "x");
    const bad = join(dir, "bad.tar.gz");
    expect(run(["tar", "-C", dir, "-czf", bad, "lockin-backup-20260101-000000", "evil.txt"]).code).toBe(0);
    const target = join(temp(), "data");
    const r = run([join(DEPLOY, "restore.sh"), bad, "--data", target, "--no-service"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("outside");

    const notOurs = join(dir, "other.tar.gz");
    expect(run(["tar", "-C", dir, "-czf", notOurs, "evil.txt"]).code).toBe(0);
    const r2 = run([join(DEPLOY, "restore.sh"), notOurs, "--data", target, "--no-service"]);
    expect(r2.code).not.toBe(0);
    expect(r2.out).toContain("does not look like a Lock-In backup");
  });

  test("backup refuses a folder that is not a Lock-In data folder", () => {
    const r = run([join(DEPLOY, "backup.sh"), "--data", temp()]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("no lockin.db");
  });
});
