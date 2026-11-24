// SA-02 / LI-015: request bodies are counted in bytes while they are read, so a chunked
// body with no Content-Length (or a lying one) is stopped at the route's limit, not
// buffered up to Bun's 128 MB default.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BodyTooLarge, MAX_REQUEST_BODY, readBodyBytes, readJsonBody } from "../../src/server/http.ts";
import { startProcess, type ServerProcess } from "../helpers/process.ts";
import { TEST_PUBLIC_URL, startTestServer, type TestServer } from "../helpers/server.ts";

/** A body of `total` bytes sent in 64 KB chunks with no Content-Length (chunked). */
function chunked(total: number, fill = 0x20): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(64 * 1024).fill(fill);
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk.length, total - sent);
      sent += n;
      c.enqueue(n === chunk.length ? chunk : chunk.subarray(0, n));
    },
  });
}

/** Status of a request that may be cut off by the server mid-upload (counts as refused). */
async function statusOf(p: Promise<Response>): Promise<number | "closed"> {
  try {
    const res = await p;
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return "closed";
  }
}

describe("readBodyBytes / readJsonBody", () => {
  test("stops a stream at the byte limit and throws BodyTooLarge", async () => {
    const req = new Request("http://x/", { method: "POST", body: chunked(1_000_000), duplex: "half" } as RequestInit);
    await expect(readBodyBytes(req, 4096)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  test("refuses early when Content-Length is over the limit", async () => {
    const req = new Request("http://x/", { method: "POST", body: "x".repeat(5000) });
    await expect(readBodyBytes(req, 4096)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  test("counts bytes, not characters: 3-byte characters over the limit are refused", async () => {
    const text = JSON.stringify({ password: "€".repeat(1400) });   // ~1,415 characters, ~4,215 bytes
    expect(text.length).toBeLessThan(4096);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(4096);
    await expect(readJsonBody(new Request("http://x/", { method: "POST", body: text }), 4096)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  test("a body within the limit parses; malformed JSON is null", async () => {
    expect(await readJsonBody(new Request("http://x/", { method: "POST", body: '{"a":"€"}' }), 4096)).toEqual({ a: "€" });
    expect(await readJsonBody(new Request("http://x/", { method: "POST", body: "{nope" }), 4096)).toBeNull();
    expect(await readJsonBody(new Request("http://x/", { method: "POST", body: "[1]" }), 4096)).toBeNull();
  });
});

describe("routes refuse oversize bodies with 413", () => {
  let s: TestServer;
  let cookie: string;
  beforeAll(async () => {
    s = await startTestServer();
    cookie = await s.signIn();
  });
  afterAll(async () => { await s.stop(); });

  test("a chunked 10 MB POST /api/auth/login is refused", async () => {
    const st = await statusOf(s.fetch("/api/auth/login", { method: "POST", body: chunked(10 * 1024 * 1024), duplex: "half" } as RequestInit));
    expect([413, "closed"]).toContain(st);
  });

  test("a 3-byte-character login body just over 4 KB is 413, not 400", async () => {
    const res = await s.fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "€".repeat(1400) }) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("too_large");
  });

  test("theme JSON over 64 KB is 413", async () => {
    const res = await s.fetch("/api/theme", { method: "PUT", cookie, body: JSON.stringify({ theme: { name: "x".repeat(70_000) } }) });
    expect(res.status).toBe(413);
  });

  test("a chunked multipart picture upload over 5 MB is refused without a Content-Length", async () => {
    const quiz = await (await s.fetch("/api/quizzes", { method: "POST", cookie, body: JSON.stringify({ title: "Big" }) })).json();
    const boundary = "----lockin";
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`);
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(head); },
      pull: (() => { let n = 0; const chunk = new Uint8Array(64 * 1024); return (c: ReadableStreamDefaultController<Uint8Array>) => { if (n++ > 100) c.close(); else c.enqueue(chunk); }; })(),
    });
    const st = await statusOf(s.fetch(`/api/quizzes/${quiz.quiz.id}/media`, {
      method: "POST", cookie, body, duplex: "half", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    } as RequestInit));
    expect([413, "closed"]).toContain(st);
  });

  test("normal sign-in, theme and upload sizes still work", async () => {
    expect((await s.fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "correct horse battery" }) })).status).toBe(200);
    const quiz = await (await s.fetch("/api/quizzes", { method: "POST", cookie, body: JSON.stringify({ title: "Pics" }) })).json();
    const png = readFileSync(new URL("../../public/phone/icons/icon-192.png", import.meta.url));
    const form = new FormData();
    form.set("file", new Blob([png], { type: "image/png" }), "a.png");
    form.set("questionId", "q-abcd1234");
    const res = await s.fetch(`/api/quizzes/${quiz.quiz.id}/media`, { method: "POST", cookie, body: form });
    expect(res.status).toBe(200);
  });

  test("the server-wide ceiling fits the largest upload", () => {
    expect(MAX_REQUEST_BODY).toBeGreaterThanOrEqual(6 * 1024 * 1024);
    expect(MAX_REQUEST_BODY).toBeLessThan(8 * 1024 * 1024);
  });
});

describe("memory under oversize sign-in bodies (real process)", () => {
  let p: ServerProcess;
  beforeAll(async () => {
    p = await startProcess();
    await p.signIn();
  });
  afterAll(async () => { await p.kill(); });

  const rssKb = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p.proc.pid}/status`, "utf8"))?.[1] ?? 0);

  test("8 parallel 20 MB chunked logins grow the server by less than 40 MB", async () => {
    const before = rssKb();
    const results = await Promise.all(Array.from({ length: 8 }, () => statusOf(fetch(`${p.base}/api/auth/login`, {
      method: "POST", headers: { Origin: TEST_PUBLIC_URL }, body: chunked(20 * 1024 * 1024), duplex: "half",
    } as RequestInit))));
    for (const r of results) expect([413, "closed"]).toContain(r);
    const grew = (rssKb() - before) / 1024;
    console.log(`[SA-02] RSS grew ${grew.toFixed(1)} MB for 8 x 20 MB chunked logins`);
    expect(grew).toBeLessThan(40);
  }, 30_000);
});
