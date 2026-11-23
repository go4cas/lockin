import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, DEFAULTS, ensureDataDir, isLocalDevUrl, parseArgs, parsePublicUrl, resolveConfig } from "../../src/server/config.ts";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "lockin-cfg-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("parseArgs", () => {
  test("defaults to serve", () => {
    expect(parseArgs([])).toEqual({ command: "serve", flags: {} });
  });
  test("reads commands and flags in both forms", () => {
    expect(parseArgs(["serve", "--port", "9000", "--public-url=https://quiz.example.com", "--data", "/d", "--bind", "0.0.0.0"])).toEqual({
      command: "serve", flags: { port: "9000", publicUrl: "https://quiz.example.com", data: "/d", bind: "0.0.0.0" },
    });
    expect(parseArgs(["reset-password", "--data", "/d"]).command).toBe("reset-password");
    expect(parseArgs(["setup-code"]).command).toBe("setup-code");
    expect(parseArgs(["--version"]).command).toBe("version");
  });
  test("rejects unknown commands, unknown flags and missing values", () => {
    expect(() => parseArgs(["launch"])).toThrow(ConfigError);
    expect(() => parseArgs(["--mode", "local"])).toThrow("Unknown option --mode");
    expect(() => parseArgs(["--port"])).toThrow("needs a value");
  });
});

describe("resolveConfig precedence (TECH-SPEC 4.2)", () => {
  test("defaults, with the public URL required", () => {
    const cwd = tmp();
    expect(() => resolveConfig(parseArgs([]), {}, cwd)).toThrow("No public URL is set");
    const c = resolveConfig(parseArgs(["--public-url", "https://quiz.example.com/"]), {}, cwd);
    expect(c).toEqual({ dataDir: join(cwd, "lockin-data"), port: DEFAULTS.port, bind: "127.0.0.1", publicUrl: "https://quiz.example.com" });
  });

  test("flag beats environment beats config.json beats default", () => {
    const cwd = tmp();
    const dataDir = join(cwd, "data");
    ensureDataDir(dataDir);
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ port: 7001, bind: "10.0.0.1", publicUrl: "https://file.example.com" }));
    const args = (...a: string[]) => parseArgs(["--data", dataDir, ...a]);

    let c = resolveConfig(args(), {}, cwd);
    expect([c.port, c.bind, c.publicUrl]).toEqual([7001, "10.0.0.1", "https://file.example.com"]);

    const env = { LOCKIN_PORT: "7002", LOCKIN_BIND: "0.0.0.0", LOCKIN_PUBLIC_URL: "https://env.example.com" };
    c = resolveConfig(args(), env, cwd);
    expect([c.port, c.bind, c.publicUrl]).toEqual([7002, "0.0.0.0", "https://env.example.com"]);

    c = resolveConfig(args("--port", "7003", "--bind", "127.0.0.1", "--public-url", "https://flag.example.com"), env, cwd);
    expect([c.port, c.bind, c.publicUrl]).toEqual([7003, "127.0.0.1", "https://flag.example.com"]);
  });

  test("the data folder comes from the flag, then LOCKIN_DATA, then the default", () => {
    const cwd = tmp();
    const url = ["--public-url", "https://q.example.com"];
    expect(resolveConfig(parseArgs(url), { LOCKIN_DATA: "envdata" }, cwd).dataDir).toBe(join(cwd, "envdata"));
    expect(resolveConfig(parseArgs([...url, "--data", "flagdata"]), { LOCKIN_DATA: "envdata" }, cwd).dataDir).toBe(join(cwd, "flagdata"));
  });

  test("plain-English errors for bad values", () => {
    const cwd = tmp();
    expect(() => resolveConfig(parseArgs(["--public-url", "https://q.example.com", "--port", "99999"]), {}, cwd)).toThrow("whole number from 0 to 65535");
    expect(() => resolveConfig(parseArgs(["--public-url", "quiz.example.com"]), {}, cwd)).toThrow("not a web address");
    expect(() => resolveConfig(parseArgs(["--public-url", "https://q.example.com/quiz"]), {}, cwd)).toThrow("no path");
    expect(() => resolveConfig(parseArgs(["--public-url", "ftp://q.example.com"]), {}, cwd)).toThrow("must start with https://");
    const dataDir = join(cwd, "d");
    ensureDataDir(dataDir);
    writeFileSync(join(dataDir, "config.json"), "{ not json");
    expect(() => resolveConfig(parseArgs(["--data", dataDir, "--public-url", "https://q.example.com"]), {}, cwd)).toThrow("is not valid JSON");
  });

  test("parsePublicUrl keeps only the origin", () => {
    expect(parsePublicUrl("https://Quiz.Example.com:443/", "x")).toBe("https://quiz.example.com");
    expect(parsePublicUrl("http://localhost:8080", "x")).toBe("http://localhost:8080");
  });

  test("isLocalDevUrl: only plain-http localhost skips the Secure cookie", () => {
    expect(isLocalDevUrl("http://localhost:8080")).toBe(true);
    expect(isLocalDevUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isLocalDevUrl("https://localhost:8080")).toBe(false);
    expect(isLocalDevUrl("http://192.168.1.20:8080")).toBe(false);
    expect(isLocalDevUrl("https://quiz.example.com")).toBe(false);
  });
});

describe("ensureDataDir (TECH-SPEC 4.4, 5.1)", () => {
  test("creates the data folder and its subfolders, and is safe to repeat", () => {
    const d = join(tmp(), "nested", "data");
    ensureDataDir(d);
    ensureDataDir(d);
    for (const sub of ["", "theme/assets", "quizzes", "backups"]) expect(existsSync(join(d, sub))).toBe(true);
  });
});
