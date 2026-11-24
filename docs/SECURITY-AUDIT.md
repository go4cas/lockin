<!-- Imported 2026-11-24 from the external audit Cas commissioned (main @ 8060221). Status lines are kept up to date by the fix PRs. -->

# Lock-In: security audit

Independent security audit of `go4cas/lockin` at `main` `8060221` (after PR #20, the security-fix PR), 2026-11-24. It covers the server, the three browser clients, the vendored and bundled libraries, the runtime, the build and CI. **No code was changed.** This file is written for the implementation agent: every finding has an ID, the place in the code, the evidence, a fix and a "Done when" list that can be turned into tests.

## How to use this file (implementation agent)

1. Read the summary table, then the findings in the batch you were given. Do not start on another batch.
2. Evidence before fixes: for each finding marked **Verified: yes**, first write a failing test that shows the behaviour described under "Evidence", then fix it. For findings marked **Verified: code**, read the cited lines and confirm the reasoning before changing anything. If a finding does not hold on the current `main`, say so and skip it.
3. Fixes marked **Contract: yes** change `src/shared/protocol.ts`, `EngineState`, the data folder format or a TECH-SPEC rule. Those need Cas's agreement (see "Decisions for Cas"). Do the parts that need no decision, and stop for the rest.
4. Keep the project rules: no runtime dependencies, nothing new in `public/vendor/`, plain-English messages, `bun run typecheck` and `bun test` pass.
5. When a finding is fixed, update its **Status** line here, and update TECH-SPEC section 12 and NOTES where the behaviour they describe changes.
6. Line numbers are for commit `8060221`. If the file has moved on, find the code by the function name given.

Severity scale: **High** = a stranger on the internet can stop or spoil a night, or read what they should not, with little effort. **Medium** = needs more effort or luck, or the damage is limited. **Low** = hardening, or needs a second failure first. **Nit** = correctness with no realistic attack.

## Method

| What | Result |
|---|---|
| Read every file in `src/` and `scripts/`, every page script in `public/` (except tests' fixtures), the vendored Arrow, CI and the docs' security sections | done |
| `bun test` on Bun 1.4.4 | 685 pass, 0 fail, 39 files |
| `bun audit` | no vulnerabilities, 5 packages (all dev-only types) |
| Vendored Arrow against the npm tarball `@arrow-js/core@1.0.6` | tarball integrity equals `vendor.json`; `index.mjs`, the chunk and the types are byte-identical; 1.0.6 is the latest release |
| Secrets in git history (94 commits, all branches) | none found; no data-folder file was ever committed |
| Live checks against `bun src/server/main.ts serve` on loopback, with small scripts using `Origin: <publicUrl>` | results quoted under each finding's "Evidence" |

Limits: everything was run on loopback, with no Cloudflare tunnel in front. Rates through the tunnel will be lower than the numbers here, and Cloudflare will absorb plain volume floods, but none of the findings below depend on volume that Cloudflare would stop by default. Real phones, real TVs, the VPS and the Cloudflare settings were not checked.

## Summary

| ID | Severity | Finding | Verified | REVIEW.md | Batch | Contract |
|---|---|---|---|---|---|---|
| SA-01 | **High** | The room code can be guessed in seconds: `team.join` has no limit, so a stranger can join or fill the lobby | yes | extends 4 | 1 | part B: yes |
| SA-02 | **High** | Request bodies are read into memory up to 128 MB before any size check, without sign-in | yes | corrects 10 | 1 | no |
| SA-03 | **Medium** | A flood of unpaired display sockets drops the TV's pairing code and can hand it to another socket | yes | new (in the fix for 4) | 1 | small |
| SA-04 | **Medium** | No limit on WebSocket connections or messages; every command clones the night | yes | upgrades 6 | 1 | no |
| SA-05 | **Medium** | The runtime is one security release behind, and `engines` allows older vulnerable versions | lookup | new | 1 | no |
| SA-06 | Low (Medium if the port is reachable directly) | `CF-Connecting-IP` is trusted from any peer; it now also keys the rejoin limit | yes | 7 | 2 | no |
| SA-07 | Low | A phone that is not in a team still gets team names, standings, lines and night details | yes | new (in the fix for 4) | 2 | view contents |
| SA-08 | Low | Host login: per-IP limit only, no cap on password hashing at once, limiter forgets everyone at 10,000 keys | yes | extends 8 | 2 | no |
| SA-09 | Low | An exception in a timer ends the process; the scheduler does not re-arm after a job throws | yes (runtime) | new | 2 | no |
| SA-10 | Low | The data folder and `lockin.db` are readable by every user on the server | yes | new | 2 | no |
| SA-11 | Low | The display's pairing token travels in a URL; tokens never expire and cannot be revoked one by one | code | new (in the fix for 4) | 2 | D5 |
| SA-12 | Low | A host socket keeps getting host views after its session ends by expiry; sessions have no absolute lifetime | code | new | 2 | no |
| SA-13 | Low | Missing response headers: HSTS, `no-store` on the API, tighter CSP, `development: false` | yes | new | 3 | TECH-SPEC 12.4 |
| SA-14 | Low | The per-IP rejoin limit lets one phone lock every phone on the pub Wi-Fi out of rejoining | code | side effect of 5 | 3 | no |
| SA-15 | Low | Team names: look-alike and invisible characters, no Unicode normalising | code | 9 | 3 | no |
| SA-16 | Low | CI and release: actions pinned by tag, no permissions block, no release build, no SECURITY.md | code | part of 3 | 3 | no |
| SA-17 | Low | No log line for failed sign-ins, limiter trips, pairings or joins | code | new | 3 | no |
| SA-18 | Nit | Venue name and tagline go through `String.replace` replacement patterns (`$&`, `` $` ``) | yes | new | 3 | no |
| SA-19 | Nit | `preview.css` error comment can be closed early (`**//`) | yes | new | 3 | no |
| SA-20 | Nit | Question image names use a 16-bit hash; old uploads are never removed | code | near 10 | 3 | no |
| SA-21 | Nit | Small items: `{constructor}` in copy lines, `?fixture=` in the production client, `jpeg` type on theme assets | code | new | 3 | no |

Nothing here lets a stranger become the host, run a host command, read answers before the reveal, or run script in someone's browser. The serious problems are about **who can get into a night** and **how easily the server can be knocked over during one**.

## Threat model used

- **Assets:** a night running without interruption; fair play (no answers early, no answers after the lock, no team impersonation); the host password and session; the quiz files (they hold the answers).
- **Attackers:** (1) anyone on the internet who knows the address, which is public once a QR code has been on a TV; (2) a player in the pub, who has the room code and one team token; (3) someone with a shell account on the same VPS.
- **Trust boundary:** the host console is trusted once signed in. The display is trusted once paired. Phones are never trusted.

---

## Findings

### SA-01 · High · The room code can be guessed in seconds

- **Status:** fixed in the audit Batch 1 PR (parts A and B; Cas agreed D1 on 2026-11-24). Wrong room codes: 3 a minute per connection, 10 per IP, 30 in total, then typed joins pause for 60 s and the console warns; the join key in the QR code gets past the limits; "New room code" (`night.newRoomCode`). Checks run before `run()`. Tests: `tests/night/join-limits.test.ts`. TECH-SPEC 11.2a, 12.6.
- **Verified:** yes
- **Where:** `src/server/night/engine.ts` `teamJoin` (line 1080, the check at 1082), `ROOM_ALPHABET` (line 20), room code made at 642-643; `blocked()` lets `team.join` through in the lobby (line 530); `command()` and `run()` (lines 554-560, 297-339).
- **What happens:** the room code is 4 letters from a 19-letter alphabet: 130,321 codes. `team.join` with a wrong code answers `room_code` and nothing counts the tries, per connection, per client or in total. A join with a right code and an empty name answers `bad_args` instead, so the code can be confirmed without creating a team. TECH-SPEC 12.6 says "the room code is what keeps strangers out of the night"; it does not.
- **Evidence:** against a local server with a night in the lobby, 4 sockets sending `team.join` with an empty name found the code after 16,574 tries in 1.5 s (about 10,900 tries a second). The whole space takes about 12 s at that rate. With the code, a script joined 30 junk teams, and a real team then got `night_full`: "This quiz is full. Ask the host." The host can remove teams, but a script rejoins faster than a person can click.
- **Impact:** anyone on the internet can (a) fill the lobby so no real team can join, before every night, for as long as they like; (b) join and play from home; (c) undo the point of display pairing (REVIEW finding 4), since the code is what pairing protects.
- **Fix, part A (no contract change, do this first):**
  1. Count wrong room codes like wrong rejoin codes. Per connection: 3 wrong in a minute, then `too_many_tries`. Per client IP: 10 a minute. In total: 30 a minute across all clients; while that is tripped, joins by typed code answer `too_many_tries` for 60 s.
  2. Make the check before `run()`, so a wrong code never clones the night (see SA-04). `blocked()` cannot see the args; add a cheap pre-check in `command()` for `team.join` and `team.rejoin`.
  3. Answer `room_code` for a wrong code whatever the other args are (it does already), and keep one message for both "wrong" and "limited by total" so the total limit is not an oracle.
  4. Show the host a line when the total limit trips ("Someone is guessing the room code"), and write a log line (SA-17).
  5. Do not cap successful joins per IP: a pub's phones often share one address and join in a burst when the host says "join now". Instead give the host a way out once a code has leaked: a "New room code" action that changes the code (and the join key from part B) and keeps the teams, next to "Remove". It is a new host command, so it goes with decision D1.
- **Fix, part B (contract change, recommended, decision D1):** the total limit in part A can itself be tripped on purpose, which blocks typed joins. So give real phones a path that does not depend on a guessable code: a **join key** in the QR code and join link.
  1. On `night.open`, make `joinKey = randomCode(10)` (about 50 bits). Keep it in `EngineState` as an optional field, like `finalStandingsAt`, so no migration is needed.
  2. `NightInfo.joinUrl` becomes `<publicUrl>/j/<roomCode>-<joinKey>`. The QR code already encodes `joinUrl`. `parsePath` in `public/phone/logic.mjs` splits the two; the phone sends `team.join { roomCode, joinKey, name }`.
  3. A join with the right `joinKey` skips the total limit (it still counts per connection and per IP if the key is wrong). A join with only the typed code stays under part A's limits.
  4. Never send `joinKey` to an unbound phone or an unpaired display (the same rule as the room code).
- **Done when:**
  - 20 wrong codes on one socket give at most 3 `room_code`, then `too_many_tries`.
  - Wrong codes on fresh sockets from one IP stop at 10 in a minute.
  - Wrong codes from many IPs stop at 30 in a minute in total, and the host view carries the warning.
  - A wrong-code `team.join` leaves `state.seq` unchanged and does not call `structuredClone` (spy or count).
  - A right code with an empty or bad name, sent after the limit has tripped, also answers `too_many_tries` (no oracle).
  - (Part B) while the total limit is tripped, a join with the right `joinKey` still succeeds and a typed-code join does not.
  - TECH-SPEC 11 and 12.6 describe the limits and what the room code does and does not protect.

### SA-02 · High · Request bodies are read into memory up to 128 MB before any size check

- **Status:** fixed in the audit Batch 1 PR. Bodies are counted in bytes while read and refused with 413 at the route limit; `maxRequestBodySize` set. 8 x 20 MB chunked logins grew the server by about 1.3 MB. Tests: `tests/server/body-limits.test.ts`. TECH-SPEC 12.2. Also closes code review LI-015.
- **Verified:** yes
- **Where:** `src/server/http.ts` `readJsonBody` (lines 42-53); `src/server/app.ts` `Bun.serve` options (lines 177-186, no `maxRequestBodySize`); `src/server/auth-routes.ts` (setup line 19, login line 40); uploads in `src/server/quizzes/index.ts` (lines 93-109) and `src/server/branding/index.ts` (lines 107-129).
- **What happens:** `readJsonBody` trusts `Content-Length`, then calls `req.text()`, which reads the whole body. A body sent with chunked encoding has no `Content-Length`, so the size check passes and Bun buffers it up to its default limit of 128 MB. `/api/auth/login` and `/api/auth/setup` need no session, so anyone can do this. (The second check compares `text.length`, which counts UTF-16 units, not bytes.) REVIEW finding 10 rated this Low and host-only; the host-only part is true for uploads, not for sign-in.
- **Evidence:** 8 parallel `POST /api/auth/login` requests, each 100 MB chunked with a spoofed `Origin`, all answered `400`. The server's resident memory went from 53 MB to 857 MB and stayed there. Fifteen or so would exhaust a 1 to 2 GB VPS and the kernel would kill the process mid-night.
- **Fix:**
  1. Set `maxRequestBodySize` in `Bun.serve` to the largest real body: 5 MB image plus multipart overhead, so `6 * 1024 * 1024`. Confirm with a test that Bun then refuses a larger chunked body (expected `413`).
  2. Rewrite `readJsonBody(req, maxBytes)` to read `req.body` as a stream, count bytes, and stop (cancel the reader, answer `413`) as soon as the count passes `maxBytes`. Do not rely on `Content-Length`. Compare bytes, not string length.
  3. Use small limits where bodies are small: 4 KB for `/api/auth/*`, 64 KB for theme, venue and quiz-title routes, 2 MB only for `PUT /api/quizzes/:id`.
  4. For the two upload routes, keep the `Content-Length` early refusal, and rely on step 1 for chunked bodies.
- **Done when:** a 10 MB chunked `POST /api/auth/login` is refused with `413` (or the connection is closed) before the body is fully read; the process's memory does not grow by more than a few MB during 8 such requests at once; a 3-byte-per-character JSON body just over the limit in bytes is refused; existing auth, quiz and branding tests pass.

### SA-03 · Medium · A flood of unpaired display sockets breaks pairing and can hand the TV's code to someone else

- **Status:** fixed in the audit Batch 1 PR; the per-display unpair (`display.unpair { id }`) followed in the audit Batch 2 PR with SA-11. Codes are never evicted or moved; 20 waiting in total and 5 per IP; 6 digits, expire after 10 minutes and are re-sent at once (D2); `display.pair` returns ip and connectedFor and the console shows them; host updates coalesced to one per 250 ms; pairing writes commit after the file write (code review LI-014). Tests: `tests/server/ws-limits.test.ts`, `tests/display/pairing.test.ts`. TECH-SPEC 12.6.
- **Verified:** yes
- **Where:** `src/server/display/pairing.ts` `codeFor` (lines 62-75, the eviction at 66-71), `claim` (lines 81-91), `PAIR_CODE_DIGITS = 4`; `src/server/display/index.ts` (the authoriser at lines 77-81; a host broadcast on every display connect and disconnect at lines 82-87); `src/server/ws.ts` (no connection cap).
- **What happens:** every unpaired display socket holds one of 10,000 pairing codes. When 5,000 are held, `codeFor` deletes the oldest half "rather than loop for a free code". The real TV's entry is among the oldest. Its code is then free and is given to a later socket, while the TV still shows it (the TV only gets a new code when the next state is broadcast, and in the idle phase there may be none).
- **Evidence:** a TV socket showed `9371`. One address opened 5,000 more unpaired display sockets in 9.9 s; none was refused. The host typing `9371` got "No display is showing that code". After 900 more short-lived sockets, another socket held `9371`; the host typing it again got `{"paired":2}`, the TV stayed unpaired, and the other socket received a `paired` token and the full display view with the room code. Each of those 5,000 connects also sent every host console a fresh host view.
- **Impact:** a stranger can stop the host pairing the TV, and with up to about a 50% chance per attempt receives the pairing instead. A stolen pairing lasts until "Unpair every display".
- **Fix:**
  1. Never evict or reuse a code while its connection is open. Cap waiting unpaired displays instead: 20 in total and 5 per client IP. Past the cap, the new socket gets no code (`pairing: { code: "" }` and the page says "Too many screens are waiting. Reload this page in a minute.") or is closed. The hub-wide caps in SA-04 back this up.
  2. Make the code 6 digits (decision D2: TECH-SPEC 12.6 says 4), and let it expire: after 10 minutes the connection gets a new code and a fresh state.
  3. Whenever a connection's code changes or is dropped, send that connection its state at once.
  4. Tell the host what was paired: return the display's client IP and how long it has been connected in the `display.pair` result, and show "Paired a display at 203.0.113.7, connected 2 minutes ago. Not your TV? Unpair it." Add a per-display unpair (`display.unpair { id }`) next to "Unpair every display".
  5. Coalesce the host-only broadcasts from display connects and disconnects (at most one every 250 ms).
- **Done when:** with 25 unpaired display sockets open, the first one's code still pairs the first one; socket 21 has no code; no code is ever held by two open sockets or moved from one to another (property test over random opens and closes); 1,000 display connects send a host socket far fewer than 1,000 states.

### SA-04 · Medium · No limit on WebSocket connections or messages; every command clones the night

- **Status:** fixed in the audit Batch 1 PR. 600 sockets in total and 120 per IP (429 at upgrade); 20-message burst then 10 a second per non-host socket, then bye(protocol); 32 KB frames; 1 MB backpressure closes the socket; team commands pre-checked before the night is copied, repeat answers are no-ops; host-only updates coalesced. Load test (30 teams, one IP), reconnect storm and flood pass. Tests: `tests/server/ws-limits.test.ts`, `tests/night/join-limits.test.ts`, `tests/e2e/hardening.test.ts`. TECH-SPEC 12.4. Also closes code review LI-011.
- **Verified:** yes
- **Where:** `src/server/ws.ts` (`websocket` options at lines 189-192; `open` at 193-199; `send` at 98-100; nothing counts connections or messages); `src/server/night/engine.ts` `run` (line 298: `structuredClone(this.m)` before the command is even validated); `src/server/night/index.ts` (a host broadcast through `engine.touch()` on every bound team connect and disconnect, lines 136-144).
- **What happens:** there is no cap on sockets in total, per client IP, or before `hello` (those live 5 s). There is no cap on messages per socket. Every command, including one that will be refused, copies the whole night (the quiz snapshot and every answer) and, if accepted, writes to SQLite. Sends ignore backpressure: Bun's default lets up to 16 MB queue for each socket that is not reading, then drops messages without closing it.
- **Evidence:** 5,000 sockets from one address were accepted (SA-03). Refused commands ran at about 10,900 a second over 4 sockets, each one cloning the night (SA-01). REVIEW finding 6 rated this Low on the grounds that a flood from many sockets was not tested; it works, and it is the engine behind SA-01 and SA-03.
- **Fix:**
  1. In `Hub`, count open sockets in total (cap 600) and per client IP (cap 120: a full pub on one Wi-Fi address is 30 phones, a few displays and a console, with room for reconnect overlap). Refuse the upgrade with `429` in `handleRequest` when over the cap, so no socket is created.
  2. Give each connection a token bucket: 20 messages burst, 10 a second refill, pings included. Over the limit: `bye("protocol")`.
  3. Set `maxPayloadLength` to 32 KB (the largest real message, `night.open` with 30 prizes of 80 four-byte characters, is about 11 KB), `backpressureLimit` to 1 MB and `closeOnBackpressureLimit: true`.
  4. Validate before cloning. Move argument and state checks for `team.join`, `team.rejoin`, `joker.play` and `answer.submit` into a pure pre-check that returns the failure without entering `run()`. Only clone when the command is about to change something. An `answer.submit` that repeats the same value already returns early; do that before the clone too.
  5. Coalesce host-only presence broadcasts (`engine.touch()`) to at most one every 250 ms.
- **Done when:** the 121st socket from one IP is refused at upgrade; 100 messages in one second get `bye` with reason `protocol`; a refused team command does not call `structuredClone`; a socket that never reads is closed once 1 MB is queued; the load test (`tests/load/night.test.ts`, 30 teams) still passes with the limits on, including a reconnect storm.

### SA-05 · Medium · The runtime is one security release behind, and `engines` allows older vulnerable versions

- **Status:** fixed in the audit Batch 1 PR. engines `>=1.4.5 <1.5.0`, CI on 1.4.5, `serve` refuses an older Bun (`src/server/runtime.ts`), the binary test checks the embedded runtime, and a weekly CI job (`bun-release-check.yml`) fails when a newer 1.4.x is out. The rebuild rule is in TECH-SPEC 12.4; it goes into the run sheet with the Release thread.
- **Verified:** by lookup (release notes and advisories; not tested against Lock-In)
- **Where:** `package.json` `engines.bun` (`>=1.4.0 <1.5.0`); `.github/workflows/ci.yml` line 15 (`bun-version: 1.4.4`); `scripts/build.ts` (the compiled binary carries the Bun runtime it was built with).
- **What happens:** Bun 1.4.5 (2026-11-19) is a security release. It updates llhttp (the HTTP/1.1 parser, which is on Lock-In's request path), SQLite (Lock-In's database), BoringSSL, c-ares and lsquic. The repo and CI are on 1.4.4. Separately, `engines` accepts 1.4.0 to 1.4.3, and public advisories for CVE-2026-111497 (the Brotli decoder flaw) list every Bun before 1.4.4 as affected. Whether Lock-In's own code path reaches Brotli decoding was not checked; the point is that the allowed range should not include those versions.
- **Why it matters here:** Lock-In ships as one binary with the runtime inside. A fix in Bun does nothing until the binary is rebuilt and redeployed.
- **Fix:**
  1. `engines.bun`: `>=1.4.5 <1.5.0`. CI: `bun-version: 1.4.5`. Bump `@types/bun` only if needed (it is already 1.4.5).
  2. At start, compare `Bun.version` with a minimum constant and refuse to serve (or log a clear warning) below it.
  3. In the release run sheet (REVIEW finding 1): "When Bun publishes a security release, rebuild and redeploy." Add a weekly scheduled CI job that fails when the pinned Bun is not the latest 1.4.x, so it is noticed.
- **Done when:** `bun --version` in CI prints 1.4.5 or later; the binary test asserts the embedded runtime version; the run sheet has the rebuild rule.
- **Sources:** https://bun.com/blog/bun-v1.4.5 (dependency table); CVE-2026-111497 write-ups naming Bun 1.4.4 as the fixed version, for example https://www.aikido.dev/blog/node2shell-nodejs-brotli-rce-cve-2026-111497.

### SA-06 · Low (Medium if the port is reachable directly) · `CF-Connecting-IP` is trusted from any peer

- **Status:** fixed in the audit Batch 2 PR. `clientIp(header, peer)` believes the header only from a loopback peer and only when it parses as an IP; start warns when the bind is open and the public URL is https. Live: 6 wrong logins with 6 header values from a non-loopback peer now give five `401` and a `429` (on main: all `401`). Tests: `tests/server/audit-batch2.test.ts`. TECH-SPEC 12.2. Closes REVIEW finding 7.
- **Verified:** yes
- **Where:** `src/server/app.ts` `clientIp` (lines 127-129).
- **What happens:** the header is believed whoever sends it. Every per-IP limit hangs on it: login, setup code, and since PR #20 the rejoin limit.
- **Evidence:** 12 wrong logins with 12 different header values: twelve `401`, no `429`. 30 wrong rejoin codes with 30 header values: thirty `bad_code`, no `too_many_tries` (from one real address without the header: 10, then limited). This needs the port to be reachable without going through Cloudflare, for example `--bind 0.0.0.0`, which the README suggests for trying phones on the same Wi-Fi.
- **Fix:**
  1. Split out a pure `clientIp(headerValue, peerAddress)`: use the header only when the peer is loopback (`127.0.0.0/8`, `::1`, `::ffff:127.0.0.1`), which is always the case behind `cloudflared` on the same machine, and only when the value parses as an IP address. Otherwise use the peer address.
  2. At start, if `bind` is not loopback and `publicUrl` is `https`, log: "This port is open to the network. Lock-In expects to sit behind the tunnel on 127.0.0.1."
- **Done when:** unit tests cover loopback peer with header (header wins), non-loopback peer with header (peer wins), and a malformed header (peer wins); existing tests that send the header over loopback still pass.

### SA-07 · Low · A phone that is not in a team still gets team names, standings and night details

- **Status:** fixed in the audit Batch 1 PR (Cas agreed D3). An unbound phone gets only phase, venue, `night.started` and the lobby line; the privacy watch checks every unbound view in the e2e night. The media-key note is not done (informational). TECH-SPEC 10.2, 12.6.
- **Verified:** yes
- **Where:** `src/server/night/views.ts` `teamView` (lines 246-291): only `roomCode` and `joinUrl` are blanked for an unbound socket (line 252). `teams` (line 284), `standings` (287), `lines` (289) and the shared `flash` (272-274) are sent to everyone. Also `src/server/night/index.ts` `GET /media/q/:questionId` (lines 159-178).
- **What happens:** anyone who opens a socket with role `team` and no token gets the night id, quiz title, planned start, prizes, round count and title, team count, every team's id, name and colour in the lobby, "team joined" flashes, the public standings after each round, and the winner and last-place lines.
- **Evidence:** an unbound socket received all 30 team names in the lobby, plus `quizTitle`, `prizes`, `roundCount`, `lockMode` and `holdingPanels`.
- **Impact:** a stranger can follow who is playing and who is winning. Team names are the only thing close to personal data that Lock-In holds.
- **What the join page needs** (checked in `public/phone/screens.mjs` and `logic.mjs`): `phase`, `venue`, `night.started` and `lines.lobby`. Nothing else.
- **Fix:** for an unbound socket build a minimal view: keep `phase`, `venue`, and a `night` with only `started` meaningful (empty strings, `[]`, `0`, `null` and `false` for the rest); `teams: []`, `standings: null`, `flash: null`, `suddenDeath: null`, and `lines` empty except `lobby`. The `TeamView` type does not change; TECH-SPEC 10.3 and 12.6 should say what an unbound phone gets.
- **Related, informational:** `/media/q/:questionId` serves a shown question's picture to anyone who knows the question id. Ids are random (`q-` plus 8 characters) and only reach bound phones and paired displays, so this is not guessable; but ids stay the same when a quiz is reused or duplicated, so last month's player can fetch this month's pictures once each question is shown. If that matters, add a per-night media key to the URL in the views.
- **Done when:** `tests/e2e/privacy.test.ts` (or `tests/helpers/privacy.ts`) checks every view sent to an unbound team socket through a whole night and finds no team id or name, no standings, no flash, no line other than `lobby`, and no quiz title; the join, rejoin and "joining closed" screens still render (phone fixtures).

### SA-08 · Low · Host login: per-IP limit only, and no cap on password hashing at once

- **Status:** fixed in the audit Batch 2 PR. At most 2 password hashes at once with 8 waiting, then `429 busy` (not a wrong try); blocks double from 1 to 15 minutes and reset on a good sign-in; past 10,000 keys the oldest are dropped, not everyone. No global lock-out. Confirmed on main: after 10,001 other keys an IP's fifth failure did not block it, and a second block was again 1 minute. Hint "use a passphrase" on the setup page (D4). The Cloudflare rule on `/api/auth/*` goes in the run sheet (Release thread). Tests: `tests/server/audit-batch2.test.ts`. TECH-SPEC 12.1, 12.2. Closes the `RateLimiter` part of REVIEW finding 8.
- **Verified:** yes
- **Where:** `src/server/auth.ts` `RateLimiter` (lines 44-70; `failures.clear()` at line 64; `blockedUntil` is never pruned); `src/server/auth-routes.ts` login (lines 37-51).
- **What happens:** the only brake on password guessing is 5 failures a minute per client IP. Guesses from many addresses are not slowed at all. Each guess runs argon2id with Bun's defaults (`m=65536,t=2,p=1`: about 100 ms of CPU and 64 MiB of memory); nothing in Lock-In limits how many run at once. When the limiter holds 10,000 keys it forgets every failure count.
- **Evidence:** one wrong login took 103 ms; 16 at once took 869 ms, during which the event loop's other work waits on the hashing threads. The limiter bypass is under SA-06.
- **Fix:**
  1. Put a small semaphore around `Bun.password.verify` and `hash`: 2 at once, a queue of 8, then `429` with "Lock-In is busy. Try again in a moment."
  2. Make the lock-out grow per IP: 1 minute, then 2, 4, 8, up to 15, reset by a good sign-in.
  3. Replace `failures.clear()` with dropping the oldest keys (insertion order of the `Map`), and prune expired `blockedUntil` entries on the same pass.
  4. Do not add a global lock-out: it would let a stranger lock the host out. The host's 7-day session already covers a night.
  5. Run sheet: a Cloudflare rate-limiting rule on `/api/auth/*`, and a note that the host password should be a long passphrase.
- **Done when:** 20 logins at once never run more than 2 hashes at a time (count with an injected hasher); the sixth failure blocks for 1 minute and the next block for 2; at 10,001 keys the newest failure counts are still there.

### SA-09 · Low · An exception in a timer ends the process

- **Status:** fixed in the audit Batch 2 PR. The scheduler catches and logs a failing job and always re-arms; every timer and interval runs through `safely()`; a lock that cannot be saved is retried every 2 s; `serve` logs uncaught errors and exits 1. Confirmed on main: a job that threw ended the process with exit code 1 before the next job ran. The systemd unit goes in the run sheet (Release thread). Tests: `tests/server/audit-batch2.test.ts`. TECH-SPEC 12.4.
- **Verified:** yes for the runtime behaviour, by reading for the paths
- **Where:** `src/server/night/scheduler.ts` `runDue` (lines 42-51: a job that throws skips `arm()`), `arm` (lines 60-66); the engine's timer jobs (`fireLock`, `fireLastSeconds`, `fireLobbyLine`, `fireFinal`, lines 421-450 of `engine.ts`), each of which calls `run()`, which writes to SQLite and then builds and sends views; the coalescing timer in `src/server/night/index.ts` (line 112). No `uncaughtException` or `unhandledRejection` handler exists in `src/`.
- **What happens:** commands are wrapped in `try`/`catch` by the hub. Timer callbacks are not. On Bun 1.4.4 an exception thrown inside `setTimeout` prints the error and exits with code 1. So a failed write (disk full, database busy past 5 s) or any bug in view building, reached from the lock timer, stops the server in the middle of a question. State is durable, so a restart recovers, but nothing in the repo restarts it yet (REVIEW finding 1).
- **Fix:**
  1. In `ClockScheduler.runDue`, run each job in `try`/`catch`, log the error, and always re-arm.
  2. Wrap the coalescing broadcast callback the same way.
  3. In `main.ts`, add `process.on("uncaughtException")` and `("unhandledRejection")` handlers that log with a timestamp and exit 1 (a clean restart is safer than running on in an unknown state).
  4. Run sheet: a systemd unit with `Restart=always`, `RestartSec=1`, its own user, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=<data folder>`, `PrivateTmp=yes` and `MemoryMax`.
- **Done when:** a scheduler test with a job that throws shows the next job still fires; a test with a database that fails on write during `fireLock` shows the process is still serving and the lock is retried or reported.

### SA-10 · Low · The data folder and database are readable by every user on the server

- **Status:** fixed in the audit Batch 2 PR. `serve` sets umask 077; the data folder and subfolders are made 0700 and an owned folder is set to 0700 at start; `lockin.db`, `-wal` and `-shm` are set to 0600; `writeTextAtomic` removes a stale temp file and ends with the asked mode. Confirmed on main: `lockin.db` and `lockin.db-wal` were 0644 and `quizzes/` 0755. Tests: `tests/server/audit-batch2.test.ts`. TECH-SPEC 12.4.
- **Verified:** yes
- **Where:** `src/server/config.ts` `ensureDataDir` (lines 131-136, default mode); `src/server/db.ts` `openDb`; `src/server/files.ts` `writeTextAtomic` (lines 15-20: a fixed `<name>.tmp`, and `mode` only applies when the temp file is new).
- **Evidence:** after a first start the data folder was `drwxr-xr-x` and `lockin.db` `-rw-r--r--`. `auth.json`, `setup-code` and `displays.json` are `0600` as intended. The database holds rejoin codes in plain text (a team takeover for any local user), session and team token hashes, and the quiz snapshot with every answer. `quizzes/*/quiz.json` (the answers) is world-readable too.
- **Fix:** create the data folder with mode `0700` and, at start, `chmod` it to `0700` if this process owns it; `chmod 0600` on `lockin.db` after opening, and on `lockin.db-wal` and `lockin.db-shm` if they already exist (SQLite creates new ones with the database's mode); in `writeTextAtomic`, remove any stale temp file first, write it with the wanted mode, `chmod` it, then rename.
- **Done when:** a test starts the server on an empty folder and checks the modes of the folder, the database, its `-wal` file and `auth.json`.

### SA-11 · Low · The display's pairing token travels in a URL, never expires and cannot be revoked singly

- **Status:** fixed in the audit Batch 2 PR (with D5). The display fetches the QR with `Authorization: Bearer <token>` and shows it as a `data:` image; `?d=` is no longer accepted. Pairings carry an id and `lastSeenAt`; unused for 90 days they are refused at hello and dropped; `display.unpair { id }` and a per-display list on the console. D5: a display opened from the signed-in console is paired by the session, with no stored token, and signing out unpairs it. Real browser (`tests/e2e/audit-batch2-browser.ts`): none of the TV page's requests carried the token. Tests: `tests/display/pairing.test.ts`, `tests/qr/routes.test.ts`. TECH-SPEC 12.6.
- **Verified:** by reading
- **Where:** `public/display/display.mjs` line 290 (`/qr/join.svg?r=<room>&d=<token>`); `src/server/qr/index.ts` lines 39-44; `src/server/display/pairing.ts` (`issue`, `unpairAll`; no expiry, no last-used time); `src/server/display/index.ts` lines 77-81 (a display opened from a signed-in browser is issued a stored token, which stays in that browser's `localStorage` after the host signs out).
- **What happens:** the token is a long-lived bearer secret that shows the room code and every question as it is asked. In a query string it ends up in proxy and access logs and in browser history. `Referrer-Policy: no-referrer` stops it leaking by referrer, which is good.
- **Fix:**
  1. In `display.mjs`, fetch the QR with `fetch("/qr/join.svg", { headers: { Authorization: "Bearer " + token } })` and show it as a `data:image/svg+xml` URL (the CSP already allows `data:` images). On the server read the token from the header and drop `?d=`. Do not switch to authorising by `?r=<roomCode>`: that would be another unlimited room-code oracle (SA-01).
  2. Store `lastSeenAt` with each paired hash; drop pairings unused for 90 days; add the per-display unpair from SA-03.
  3. Decision D5: for a display opened from a signed-in browser, mark the connection paired for as long as the session lives and issue no stored token. Signing out then unpairs it.
- **Done when:** no request URL from the display page contains the token (browser test reading the page's requests); `GET /qr/join.svg` with the header works and with `?d=` alone does not; a pairing older than the limit is refused at `hello`.

### SA-12 · Low · A host socket outlives a session that ends by expiry

- **Status:** fixed in the audit Batch 2 PR. A once-a-minute sweep sends `bye signed_out` to host sockets whose session ended and deletes ended rows; host socket messages renew the session; a session ends 30 days after sign-in however much it is used. Tests (fake clock): `tests/server/audit-batch2.test.ts`. TECH-SPEC 12.2.
- **Verified:** by reading
- **Where:** `src/server/ws.ts` (`runCommand` re-checks the session at lines 274-279; `broadcastState` at 163-165 does not); `src/server/auth.ts` `checkSession` (lines 166-183: sliding 7 days, renewed only by HTTP requests; expired rows are deleted only when their cookie is presented again).
- **What happens:** `signOut` closes host sockets when a session is deleted (logout, password reset). When a session simply expires, an open host socket keeps receiving host views, which carry the answers, until it sends a command. Sessions slide forever with no absolute limit, and the table only shrinks when an expired cookie comes back.
- **Fix:** once a minute, close host sockets whose session is no longer alive, and delete expired rows; renew `last_seen_at` from host socket activity so a console left open during a night does not expire under the host; cap a session's total life at 30 days from `created_at`.
- **Done when:** with a fake clock, a host socket whose session passes its expiry gets `bye` with reason `signed_out` within a minute and no further state; an active host socket's session does not expire; a 31-day-old session is refused.

### SA-13 · Low · Response header gaps

- **Status:** open
- **Verified:** yes (headers read from a running server)
- **Where:** `src/server/http.ts` (`PAGE_CSP` line 25, `withSecurityHeaders` lines 56-70); `src/server/app.ts` `Bun.serve` options; `src/server/auth.ts` cookie (lines 204-210).
- **Gaps and fixes:**
  1. No `Strict-Transport-Security`. Send `max-age=31536000` when `publicUrl` is `https`.
  2. API JSON has no `Cache-Control`. Send `no-store` on everything under `/api/` (quizzes and history carry answers).
  3. CSP: add `base-uri 'none'; form-action 'self'; object-src 'none'; script-src 'self'`. Keep `style-src 'self' 'unsafe-inline'`: Arrow sets `style` attributes, and `style-src-attr` is not in the display baseline (Safari 14).
  4. Add `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  5. Pass `development: false` to `Bun.serve`. The default follows `NODE_ENV`, which the binary does not set, and development mode is for Bun's error pages.
  6. Name the cookie `__Host-lockin_host` when `Secure` is on (it already has `Path=/` and no `Domain`), so a sibling subdomain cannot plant one. Accept the old name for one release.
- **Done when:** `tests/server/http.test.ts` asserts each header on a page, an API response and an upload; TECH-SPEC 12.4 lists the new policy; the browser baseline test still passes on every page (the CSP change must not break the display or the phone).

### SA-14 · Low · The per-IP rejoin limit can lock a whole pub out of rejoining

- **Status:** open (side effect of the fix for REVIEW finding 5)
- **Verified:** by reading; the limit itself was confirmed (10 wrong codes, then `too_many_tries`)
- **Where:** `src/server/night/engine.ts` `teamRejoin` (lines 1105-1133), `REJOIN_TRIES_PER_IP = 10`.
- **What happens:** phones on the venue Wi-Fi share one address. One phone sending 10 wrong codes a minute keeps every other phone on that address from rejoining, including a team whose phone has just died. The host's move link uses the same command and the same limit.
- **Fix:** let a correct code through even when the IP is limited, and count only wrong ones (the per-connection limit of 5 still stops one socket hammering). With 6 characters from 31 the space is about 887 million, so 10 wrong tries a minute per IP stays safe. Move codes (8 characters, from the host) should skip the IP limit entirely.
- **Done when:** after 10 wrong codes from an IP, a right rejoin code and a right move code from the same IP still work, and an 11th wrong one is refused.

### SA-15 · Low · Team names: look-alike and invisible characters

- **Status:** open (REVIEW finding 9)
- **Where:** `src/server/night/engine.ts` `cleanName` (lines 1069-1073) and `nameKey = name.toLowerCase()` (line 1086).
- **Fix:** normalise names with NFKC; strip control characters, zero-width characters and bidirectional controls (`\p{Cc}`, `\p{Cf}`); build `nameKey` from the NFKC, case-folded name with spaces collapsed. Count length after cleaning. The same for `team.rename`.
- **Done when:** "Quizzy Rascals" plus a zero-width space, and the same name with a full-width letter, are both refused as the name of a second team; a name made only of invisible characters is refused.

### SA-16 · Low · CI and release

- **Status:** open
- **Where:** `.github/workflows/ci.yml`; repo root.
- **Gaps and fixes:**
  1. Pin `actions/checkout` and `oven-sh/setup-bun` to commit SHAs, with the tag in a comment.
  2. Add `permissions: contents: read` at the top of the workflow.
  3. Add Dependabot (or Renovate) for `github-actions` and `bun`.
  4. Add a release workflow that builds `dist/lockin-linux-x64` on a tag, publishes it with a SHA-256 file and a GitHub build attestation. Today the binary is built on a laptop, so nobody can tie a binary to a commit. Build `bun-linux-x64-baseline` too (REVIEW finding 11).
  5. Add `SECURITY.md` (how to report a problem privately) before the repo is announced, and the `LICENSE` (REVIEW finding 3).
  6. Turn on GitHub secret scanning and push protection for the repo.
- **Done when:** the workflow files show the pins and permissions; a tag produces a release with a checksum.

### SA-17 · Low · Nothing is logged when someone is attacking

- **Status:** open
- **Where:** `src/server/auth-routes.ts`, `src/server/night/engine.ts`, `src/server/display/index.ts`, `src/server/ws.ts`.
- **What happens:** the log has start-up lines, errors and "Host password set". A wrong password, a tripped limiter, a pairing, a refused upgrade or a burst of wrong room codes leaves no trace, so after a spoiled night there is nothing to look at.
- **Fix:** one line each, with the client IP and never the secret: failed sign-in, sign-in, sign-out, limiter tripped (which one), display paired and unpaired, team joined, removed or moved, connection refused by a cap. Rate-limit the log itself (at most one line per event type per IP per 10 s, with a count).
- **Done when:** tests capture `app.log` and see the lines; no line contains a password, token, setup code, rejoin code or room code.

### SA-18 · Nit · Venue name and tagline go through `String.replace` replacement patterns

- **Status:** open
- **Verified:** yes
- **Where:** `src/server/phone/index.ts` `personalise` (lines 73-85); `src/server/display/index.ts` `personalise` (lines 33-38).
- **What happens:** The call `page.replace("<title>Lock-In</title>", "<title>" + name + "</title>")` (written as a template string in the code) treats `$&`, `` $` `` and `$'` in the venue name as patterns. `escapeHtml` turns `'` into `&#39;`, which creates `$&` out of `$'`. A venue called ``The $` Arms`` gets the page's own head pasted into its title and into an attribute, which breaks the markup. Only the page's own fixed text can be inserted, and only the host can set the name, so this is not script injection.
- **Fix:** pass a function as the replacement in every `replace` that inserts data: `page.replace(marker, () => value)`.
- **Done when:** a theme named ``The $` Arms $' $&`` gives a page whose `<title>` and meta tag contain exactly that text, escaped.

### SA-19 · Nit · `preview.css` error comment can be closed early

- **Status:** open
- **Verified:** yes
- **Where:** `src/server/branding/index.ts` line 152: `.replace(/\*\//g, "")` runs once, so `**//` becomes `*/`.
- **Evidence:** `GET /api/theme/preview.css?theme={"format":"x**//\n body{background:red} /*"}` answered `400` with a body where the comment ends early and `body{background:red}` stands as CSS. Browsers do not apply a stylesheet from a `400`, the route needs a host session, and the cookie is `SameSite=Strict`, so nothing can use this today.
- **Fix:** do not echo input into the comment. Answer `/* This theme is not valid. */` and return the problems as JSON from a separate call if the page needs them (or replace every `*` and `/` in the echoed text).
- **Done when:** the request above returns a body with one comment and nothing after it.

### SA-20 · Nit · Question image names and upload clean-up

- **Status:** open
- **Where:** `src/server/quizzes/store.ts` `saveMedia` (lines 222-236): the file is `<questionId>-<first 4 hex of SHA-256>.<ext>` and is not written if that name exists.
- **What happens:** two different pictures for one question collide once in 65,536 uploads, and then the old picture is silently kept. Replaced and orphaned pictures are never deleted, and there is no limit on how many a quiz folder holds.
- **Fix:** use 16 hex characters; when a draft is saved, delete media files in the folder that no question refers to (not while the quiz is in use by a night).
- **Done when:** a store test uploads two pictures crafted to share a 4-hex prefix and gets two files; saving a draft removes an unreferenced file.

### SA-21 · Nit · Small items

- `src/server/branding/copy.ts` `fillLine` (lines 44-55): `values[name]` finds inherited properties, so a theme line containing `{constructor}` prints "function Object() { [native code] }". Use `Object.hasOwn(values, name)`.
- `public/shared/ws-client.js` `defaultUrl` (lines 47-53) passes `?fixture=` through to `/ws`, and `public/phone/app.mjs` skips the service worker when it is present. Harmless (the real server ignores it), but it is test plumbing in the shipped client; gate it on `location.hostname` being `localhost` or `127.0.0.1`.
- `src/server/branding/index.ts` `CONTENT_TYPES` has no `jpeg`, although a hand-written theme may name a `.jpeg` logo (`validateTheme` allows it); it is then served as `application/octet-stream`.
- `src/server/night/store.ts` `historyList` runs two queries per night and returns every night ever; fine for a pub, worth a `LIMIT` before a venue has years of nights.

---

## Libraries and supply chain

| Component | Version | Where | Finding |
|---|---|---|---|
| Bun runtime (HTTP server, WebSocket, `bun:sqlite`, `Bun.password`, argon2id, embedded in the binary) | 1.4.4 in CI; `engines` 1.4.0 to 1.4.x | `package.json`, `ci.yml`, `scripts/build.ts` | **SA-05**: 1.4.5 is a security release (llhttp, SQLite, BoringSSL, c-ares, lsquic). Raise the floor and rebuild. |
| SQLite (inside Bun) | 3.53.4 in Bun 1.4.4, 3.54.1 in 1.4.5 | `src/server/db.ts` | Updated by SA-05. Every query in `src/` uses bound parameters; no string-built SQL was found. `WAL` and `synchronous=NORMAL` are a durability trade-off, not a security one (REVIEW finding 11). |
| `@arrow-js/core` | 1.0.6, vendored | `public/vendor/arrow/` | Byte-identical to the npm tarball; integrity matches `vendor.json`; latest release; no advisory found. Its one `innerHTML` use parses the developer's static template strings only; `${}` values become text nodes or attribute values (`setAttr`). It offers an `.innerHTML` property binding; no page uses it. **Keep it that way:** extend `tests/browser-baseline.test.ts` to fail on `.innerHTML=` and `.innerhtml=` inside any Arrow `html` template, and on `href`, `src` or `style` attributes built from view text. Today those attributes only take server-made paths, numbers and `encodeURIComponent` output. |
| `typescript` 5.9.3, `@types/bun` 1.4.5 (with `bun-types`, `@types/node` 26.6.6, `undici-types` 8.9.0) | dev only | `bun.lock` | Types and the compiler; nothing ships. Lockfile has integrity hashes and CI uses `--frozen-lockfile`. `bun audit`: clean. TypeScript 7 exists; no security reason to move. |
| Bundled fonts (Caveat Brush, Alfa Slab One, Bebas Neue, Atkinson Hyperlegible) | WOFF2 | `docs/design/fonts/` | Each has its OFL licence file beside it and both are embedded in the binary. No provenance record (where each file was downloaded from, with a checksum); add one like `vendor.json`. |
| QR encoder | own code | `src/server/qr/encode.ts` | No dependency. Input is always `publicUrl` plus a server-made code; the SVG title is escaped. |
| GitHub Actions `actions/checkout@v4`, `oven-sh/setup-bun@v2` | tags | `ci.yml` | **SA-16**: pin to SHAs, add `permissions`. |
| Cloudflare tunnel | not in repo | TECH-SPEC 4.5 | Not audited. The run sheet should fix: bind stays `127.0.0.1`; a rate-limiting rule on `/api/auth/*` and on WebSocket upgrades to `/ws`; "Always Use HTTPS"; no caching rules that would cache `/api/` or `/media/`. |

## Cross-check of `docs/REVIEW.md`

| REVIEW finding | REVIEW status | This audit |
|---|---|---|
| 4: the room code is not a secret from the internet | fixed | **Partly.** Pairing works as designed, and an unpaired display or unbound phone gets no room code or questions (confirmed live). But the code can be guessed outright (SA-01), the pairing code pool has its own flaw (SA-03), unbound phones still get team names and standings (SA-07), and the token rides in a URL (SA-11). The line "No rate limit on `team.join` was added … finding 6 covers floods" is the gap. |
| 5: rejoin guessing limited per connection only | fixed | **Confirmed fixed** from one address (10 wrong, then limited across new sockets). It rests on the client IP (SA-06) and has a lock-out side effect (SA-14). |
| 6: no per-IP cap on connections or command rate | open, Low | **Medium** (SA-04). 5,000 sockets from one address and about 10,900 refused commands a second were accepted. |
| 7: `CF-Connecting-IP` trusted | open, Low | Agreed (SA-06), with a concrete fix. It now also covers the rejoin limit. |
| 8: maps that only grow | partly fixed | `rejoinTries` pruning is fine. `RateLimiter` is under SA-08. |
| 9: invisible and look-alike characters in team names | open, Low | Agreed (SA-15). |
| 10: upload size checks trust `Content-Length` | open, Low, "host-only" | **High** (SA-02). The same pattern is in `readJsonBody`, which the sign-in routes use with no session. |
| 11: AVX2, `synchronous=NORMAL` | open | Operations; build the baseline target in the release job (SA-16). |
| "Not found, and looked for": XSS, path traversal, host commands from other roles, cross-origin requests, answers after the lock, answers leaking | | **Agreed on every one**, checked again independently (next section). |

## Checked and found sound

- **Sign-in:** argon2id through `Bun.password`; `auth.json`, `setup-code` and `displays.json` are `0600`; the setup code is 8 characters (about 39 bits), compared in constant time and limited; sessions are 32 random bytes with only the SHA-256 stored; cookie is `HttpOnly; SameSite=Strict; Secure` (off only for `http://localhost`); logout and password reset close host sockets.
- **Cross-site requests:** every `POST`, `PUT`, `PATCH` and `DELETE`, and every WebSocket upgrade, needs `Origin` equal to `publicUrl` (missing, `null` and foreign origins all got `403`). No `GET` route changes state.
- **Roles:** the hub fixes the role at `hello`; a host `hello` needs a live session from the upgrade request; display sockets can send no command; team sockets can send only the four team commands, and those act only on the team bound to the socket; host commands re-check the session each time.
- **The lock:** `answerSubmit` compares only the server clock with `locksAt`; nothing from the client moves it.
- **Answer privacy:** display and team views never carry `answer`, `note`, `accepted` or marks before the reveal; a team view carries only that team's answers; `/media/q/:id` refuses hidden questions unless the host asks.
- **Paths:** quiz ids, media names and asset names are checked with strict patterns before any `join`; `safeRelative` refuses `..`, hidden and empty parts (encoded `..%2f` and `%2e%2e` requests got `404`); uploads are sniffed by their first bytes, stored under generated names and served with `nosniff` and a sandbox CSP.
- **HTML and CSS output:** no page script uses an HTML sink; the two server-side page fills escape their values (apart from SA-18); `theme.css` is built only from validated hex colours, bundled font ids and asset names.
- **SQL:** bound parameters throughout.
- **Secrets:** none in the repo, the history or the binary's inputs; `.gitignore` covers the data folder files.
- **Service worker:** caches the phone shell only, network first, same origin only; never caches `/api/`, `/media/`, `/host` or `/display` pages.

---

## Suggested batches

| Batch | When | Findings |
|---|---|---|
| 1 | before the pilot night | SA-01 (part A; part B if D1 is agreed), SA-02, SA-03, SA-04, SA-05 |
| 2 | before `v1.0.0` and before the repo is announced | SA-06, SA-07, SA-08, SA-09, SA-10, SA-11, SA-12 |
| 3 | hardening and tidy-up | SA-13 to SA-21 |
| Run sheet (Release thread) | with REVIEW finding 1 | systemd unit and hardening (SA-09), Cloudflare rules (SA-08, libraries table), "never expose the port" (SA-06), rebuild on Bun security releases (SA-05), data folder and backup permissions (SA-10), log retention (SA-17) |

## Decisions for Cas

Cas agreed all six recommendations on 2026-11-24 (recorded in NOTES.md). D1, D2 and D3 are built in the audit Batch 1 PR; D4 and D5 in the audit Batch 2 PR; D6 comes later.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Add a join key to the QR code and join link (`protocol.ts` `team.join` args, `NightInfo.joinUrl` shape, `EngineState`), and a "New room code" host command | Yes to both. Without the key, the only defence against guessing is a total limit that an attacker can trip to block typed joins. Without "New room code", a leaked code cannot be withdrawn. |
| D2 | Pairing code: 6 digits, expiring, with caps on waiting displays (TECH-SPEC 12.6 says 4 digits) | Yes. |
| D3 | What an unbound phone is sent (TECH-SPEC 10.3): only phase, venue, `night.started` and the lobby line | Yes. |
| D4 | Host password: keep the 8-character minimum, or raise it and say "use a passphrase" on the setup page | Keep 8, change the hint text; the limits in SA-08 do the work. |
| D5 | A display opened from the signed-in console is paired by the session, with no stored token | Yes. |
| D6 | `LICENSE` and `SECURITY.md` before the repo is announced | Yes (REVIEW finding 3). |

## Not covered

Real phones, real TVs and Cast; the VPS, `cloudflared` and Cloudflare account settings; backups; the copy pools' tone; performance beyond what the findings needed; the fixture server and test helpers as attack surface (they bind to loopback and do not ship).
