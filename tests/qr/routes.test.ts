// B8: /qr/join.svg, /qr/display.svg, /qr/move/:code.svg and /api/server (TECH-SPEC 9.1, 9.2).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestServer, TEST_PUBLIC_URL, type TestServer } from "../helpers/server.ts";
import { decodeQr, svgToMatrix } from "./decode.ts";

let s: TestServer;
let cookie: string;

beforeAll(async () => {
  s = await startTestServer();
  cookie = await s.signIn();
});
afterAll(() => s.stop());

async function qrText(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/svg+xml");
  expect(res.headers.get("cache-control")).toBe("no-store");
  return decodeQr(svgToMatrix(await res.text())).text;
}

function openNight(roomCode: string): void {
  s.app.db.run(
    "INSERT INTO nights (id, quiz_id, quiz_title, quiz_snapshot, room_code, status, opened_at, state) VALUES (?, 'q-test', 'Test quiz', '{}', ?, 'open', 0, '{}')",
    [`n-20261124-2000-${roomCode}`, roomCode],
  );
}
function closeNights(): void {
  s.app.db.run("UPDATE nights SET status = 'ended'");
}

describe("/qr/join.svg (public)", () => {
  test("with no night open, it points at the join page", async () => {
    expect(await qrText(await s.fetch("/qr/join.svg"))).toBe(`${TEST_PUBLIC_URL}/`);
  });

  test("with a night open, it carries the room code", async () => {
    openNight("BCDF");
    try {
      expect(await qrText(await s.fetch("/qr/join.svg"))).toBe(`${TEST_PUBLIC_URL}/j/BCDF`);
    } finally {
      closeNights();
    }
  });
});

describe("/qr/display.svg (host only)", () => {
  test("refuses a signed-out visitor", async () => {
    expect((await s.fetch("/qr/display.svg")).status).toBe(401);
  });
  test("encodes the display address", async () => {
    expect(await qrText(await s.fetch("/qr/display.svg", { cookie }))).toBe(`${TEST_PUBLIC_URL}/display`);
  });
});

describe("/qr/move/:code.svg (host only)", () => {
  test("refuses a signed-out visitor", async () => {
    expect((await s.fetch("/qr/move/23456789.svg")).status).toBe(401);
  });
  test("encodes the move link, upper-casing the code", async () => {
    expect(await qrText(await s.fetch("/qr/move/23456789.svg", { cookie }))).toBe(`${TEST_PUBLIC_URL}/m/23456789`);
    expect(await qrText(await s.fetch("/qr/move/abcdefgh.svg", { cookie }))).toBe(`${TEST_PUBLIC_URL}/m/ABCDEFGH`);
  });
  test("anything that is not a move code is not found", async () => {
    for (const bad of ["2345678.svg", "234567890.svg", "23456789.png", "23456789", "0OIL1234.svg", "%3Csvg%3E.svg"]) {
      expect((await s.fetch(`/qr/move/${bad}`, { cookie })).status).toBe(404);
    }
  });
});

describe("/api/server (host only)", () => {
  test("refuses a signed-out visitor", async () => {
    expect((await s.fetch("/api/server")).status).toBe(401);
  });
  test("reports version, data folder and addresses", async () => {
    const res = await s.fetch("/api/server", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: s.app.version,
      dataDir: s.dataDir,
      publicUrl: TEST_PUBLIC_URL,
      displayUrl: `${TEST_PUBLIC_URL}/display`,
      joinUrl: `${TEST_PUBLIC_URL}/`,
    });
    openNight("KMNP");
    try {
      expect((await (await s.fetch("/api/server", { cookie })).json()).joinUrl).toBe(`${TEST_PUBLIC_URL}/j/KMNP`);
    } finally {
      closeNights();
    }
  });
});
