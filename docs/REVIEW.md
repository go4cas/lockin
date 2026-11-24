# Lock-In: pilot release review

Independent review of `main` at `bed9010` (B0 to B9 merged, PRs 6 to 17), 2026-11-24. The reviewer did not build any of it and judged only from the repository, the test run and a night played against the compiled binary. **No code was changed.** This file is written to be handed to a separate code review and security audit.

## Summary: fails and findings, most severe first

Nothing found blocks a pilot night on its own. The code meets almost every MVP "Done when"; what is left is mostly release work and checks on real hardware that cannot be done in a repo.

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | **Release blocker** | No `docs/RELEASE.md` or run sheet yet: S-03 (reset steps "written in the release run sheet"), S-08 (backups) and S-01 ("runs behind a Cloudflare tunnel") cannot pass until the Release thread lands. | expected, Release thread |
| 2 | **Release blocker** | Real-hardware checks still owed: T-01 (one real smart-TV browser), P-01 (current and previous iOS Safari and Android Chrome), P-10 and B7 (install and open full screen on a real phone). | Cas, before `v1.0.0` |
| 3 | **Release blocker** | Licence not chosen. REQUIREMENTS (Open questions) and NOTES say it must be settled before `v1.0.0`. The repo is public with no `LICENSE`. `package.json` is still `0.1.0`. | repo root |
| 4 | Medium (security, design), **fixed** | **The room code is not a secret from the internet.** `/display`, the display WebSocket and `/qr/join.svg` need no sign-in and all carry the room code, so anyone who knows the address can join as a team and follow questions live from home. There is no rate limit on `team.join`. A stranger could fill the lobby with junk teams (the host can remove them) or play remotely. | `src/server/qr/index.ts:38`, display view `night.roomCode` |
| 5 | Medium (security), **fixed** | **Rejoin-code guessing is limited per connection, not per client.** The 5-a-minute limit is keyed by connection id, so opening a new WebSocket resets it. A correct guess takes over a team and kicks its phone. With 30 teams, about 30 million guesses are expected per hit: unlikely in one night at normal rates, but there is no cap on connections or messages per IP. | `src/server/night/engine.ts:1103` |
| 6 | Low (security, DoS) | No per-IP cap on WebSocket connections or command rate. Every command, even a refused rejoin, `structuredClone`s the whole night model before running, and accepted ones write to SQLite. B9 showed one phone sending 2,000 changes did not slow others, but a flood from many sockets was not tested. | `src/server/ws.ts`, `engine.ts:294` |
| 7 | Low (security) | `CF-Connecting-IP` is trusted on every request. If the port is reachable other than through the tunnel (for example `--bind 0.0.0.0`), the login and setup-code rate limits can be bypassed by sending a new header each time. **Verified**: 7 wrong logins with different headers all got `401`, never `429`. Safe with the default `127.0.0.1` bind behind `cloudflared`; the run sheet should say never to expose the port. | `src/server/app.ts:125` |
| 8 | Low (robustness), partly fixed | Memory maps that only grow: `rejoinTries` (per connection id, never pruned) and `RateLimiter.blockedUntil`. `RateLimiter` clears every failure count once 10,000 keys exist, which resets everyone's count. | `engine.ts:122`, `src/server/auth.ts:48-66` |
| 9 | Low | Team names allow invisible and look-alike characters (zero-width space, bidi controls), so "Quizzy Rascals" plus a zero-width space is a different team. The host can rename or remove, so this is cosmetic. | `engine.ts:1065` |
| 10 | Low | Upload size checks trust `Content-Length`. A chunked upload is read fully into memory before its size is checked. Host-only, and Bun's default body cap applies. | `src/server/quizzes/index.ts:95`, `src/server/branding/index.ts:109` |
| 11 | Low (release note) | The binary targets `bun-linux-x64`, which needs a CPU with AVX2. Check the VPS CPU (`grep avx2 /proc/cpuinfo`) or build `bun-linux-x64-baseline`. SQLite runs `synchronous=NORMAL`: a power cut, but not a process kill, could lose the last writes (B9 noted this). | `scripts/build.ts`, `src/server/db.ts:17` |
| 12 | Nit | `can.lock` stays `true` after a sudden-death question is revealed, so a Lock button can be enabled when locking does nothing. | `engine.ts:491-492` |
| 13 | Nit | H-13 mark changes are written to `mark_changes`, but neither the history API nor any screen shows them. That meets "kept in the night's history" at the data level only. | `src/server/night/index.ts:175` |
| 14 | Nit | The manifest gives the venue logo as `512x512` whatever its real size. | `src/server/phone/index.ts:47` |
| 15 | Nit | With no planned start, the display lobby still says "Starting soon" in its header. The long prize text is cut off on the display at 1920 px (expected), but nothing shows the full text. | `public/display/display.mjs:801` |
| 16 | Nit | While the server is down, the console's team list still says "Connected". The yellow reconnecting banner covers this. | `public/host/run/` |
| 17 | Doc drift | See "Spec and doc drift" below: four small items, none of which change behaviour. | docs |

### Status after the security-fix PR (2026-11-24)

For the separate code review and security audit: the findings above are as the review found them. This is where each one stands now.

| # | Status | What changed |
|---|---|---|
| 4 | **Fixed** (Cas chose display pairing) | An unpaired display sees only a 4-digit pairing code; the host types it on the console. `/qr/join.svg` needs a host session or a paired display's token. Unbound phone sockets no longer get the room code or questions (a second leak found while fixing this). Joining was already lobby-only. Still open by design: someone in the pub can pass the code on before Quiz Start (the host can remove teams). No rate limit on `team.join` was added: pub phones share one IP, and finding 6 covers floods. TECH-SPEC 12.6, `src/server/display/pairing.ts`, `tests/display/pairing.test.ts`. |
| 5 | **Fixed** | Wrong rejoin codes count per connection (5 a minute) and per client IP (10 a minute, across connections). Reconnecting no longer resets it. `engine.ts` `teamRejoin`; tests in `tests/night/engine.test.ts` and `tests/e2e/hardening.test.ts` ("REVIEW finding 5"). The IP is `CF-Connecting-IP`, so finding 7 applies to it as to login. |
| 8 | Partly fixed | `rejoinTries` is now pruned (empty keys dropped, and stale ones once it passes 1,000 keys). `RateLimiter` is unchanged. |
| 1-3, 6, 7, 9-17 | Open | Not changed in this PR (release work, real-hardware checks, Low and Nit items). |

The flaky e2e test from PR #18 (`tests/e2e/night.test.ts` reading a phone's view before its update arrived) is fixed too.

What was **not** found, and was looked for: XSS (team names, prizes and quiz text are rendered as text everywhere; checked by a test in the browser too), path traversal (every file route checks the name with a strict regex before `join`, and `safeRelative` blocks `..`, hidden and empty path parts), host commands from team or display sockets, a host hello without a session, upgrades and mutating requests from another origin, answers after the lock, answers leaking to the display or to other teams.

### Status after the audit Batch 1 PR (2026-11-24)

Cas commissioned an external security audit and code review of main @ 8060221. The audit is in `docs/SECURITY-AUDIT.md` with a status line per finding. This PR fixes audit Batch 1 (SA-01 to SA-05) plus SA-07, and code review items LI-011, LI-014 and LI-015.

| # | Status | What changed |
|---|---|---|
| 4 | **Fixed further** (SA-01, D1) | The audit found the room code could be guessed in about 12 s, since `team.join` had no limit. Wrong room codes are now limited per connection, per IP and in total; the QR code carries a join key that gets past the limits; the host has "New room code". Unbound phones get only what the join page needs (SA-07, D3). Pairing codes are 6 digits, expire, are capped and are never evicted or moved (SA-03, D2). |
| 6 | **Fixed** (SA-04, LI-011) | Caps on sockets (600 total, 120 per IP), a message budget per socket, 32 KB frames, 1 MB backpressure. Team commands are checked before the night is copied; a repeat answer writes nothing. Host-only updates are sent at most every 250 ms. |
| 10 | **Fixed** (SA-02, LI-015) | The audit showed this was not host-only: sign-in used the same reader. Bodies are counted in bytes as they are read and refused with 413 at each route's limit; `maxRequestBodySize` is set. |
| new | **Fixed** (SA-05) | Bun 1.4.5 minimum in engines and CI; `serve` refuses an older runtime; weekly check for a newer 1.4.x. |
| new | **Fixed** (LI-014) | Pairing writes change memory only after `displays.json` is written. |
| 1-3, 7-9, 11-17 | Open | Unchanged. Audit Batch 2 and 3 (SA-06, SA-08 to SA-21) and D4 to D6 come later. |

## How this was checked

| Check | Result |
|---|---|
| `bun test` (Bun 1.4.4) | **675 pass, 0 fail**, 7,530 `expect()` calls, 38 files, 72.3 s |
| `bun run typecheck` | clean |
| `bun run build` | `dist/lockin-linux-x64` (110 MB), 71 embedded files |
| Night on the built binary, from an empty data folder (own script, not B9's) | 52 checks, all as expected except the one rate-limit bypass check (finding 7). Scripts and output: project files `review/run.ts`, `review/result.txt` |
| Three-way tie and sudden death on the binary, per-round lock, rejoin on a new phone | 21 checks, all pass: `review/sd.ts`, `review/result-sd.txt` |
| Browser run on the binary (Playwright, Chromium): console, display 1920×1080, phone 390×844, a team named `<img src=x onerror=alert(1)>`, a prize `<script>…`, kill and restart the server, old-browser check forced | Names and prizes show as text, no dialog fired, no page errors. Display, phone and console show their reconnecting states and come back on their own. The old-browser page shows the plain message. Screenshots: `review/shots/` |
| Every display fixture at 1920×1080 and 1280×720 (17 fixtures), console at 1280×800 and 768×1024, phone at 390×844 and 360×640 | Display: **no scrolling and no errors on all 34**. Console and phone scroll vertically only (allowed). No horizontal scroll anywhere: `review/fit-results.txt` |

The live night covered: setup with the setup code, a quiz built through the API (text, choice, closest, year, number, and sudden-death questions), a joker played from the lobby, a second phone refused, a late team refused after Quiz Start, timer pause and +15 s, the lock, a late answer refused, marking groups ordered by nearness, "J.F.K." accepted once and saved back to the quiz file, reveal blocked while marks were pending, halftime, a dispute that changed round wins, Quiz End, history, a restart with history intact, and the login rate limit.

---

## MVP features against REQUIREMENTS.md "Done when"

Key: **P** pass, **F** fail, **~** partial, **M** manual check still owed (cannot be checked from the repo). Evidence is a test name (in quotes, from the file named), a line from the live run (`run:` or `sd:`), or `file:line`.

### Shared and server

| ID | Criterion | | Evidence |
|---|---|---|---|
| S-01 | One build, one Linux x64 executable, no runtime deps | P | `bun run build`; `package.json` has no `dependencies`; tests/packaging/binary.test.ts runs it from an empty folder |
| | Runs on a VPS behind a Cloudflare tunnel | M | No VPS run yet (Release). Bind defaults to `127.0.0.1`; see finding 7 |
| | One process serves everything; no device-to-device traffic | P | `src/server/app.ts` (one `Bun.serve`) |
| | No secrets or venue data in repo or binary | P | `.gitignore`; fixtures use "The Example Arms"; no `LICENSE` (finding 3 is separate) |
| S-03 | First run asks for a password before anything else | P | `/host` redirects to `/host/setup`; tests/server/auth.test.ts "status says setup is needed…" |
| | Every host page and action needs a session; display and phone never get host actions | P | Router `{host:true}`; `ws.ts` runCommand; tests/e2e/hardening.test.ts "team and display connections can run no host command"; run: "host hello without cookie refused" |
| | Signed in at least 24 h | P | 7-day cookie, renewed on use; auth.test.ts "sessions last 7 days and are renewed on use" |
| | Password never plain text, never in repo | P | argon2id in `<data>/auth.json` (mode 0600); auth.test.ts "stored only as an argon2id hash" |
| | Reset from the server, steps in the run sheet | ~ | `lockin reset-password` works (auth.test.ts "reset-password removes…"); run sheet not written yet (finding 1) |
| S-04 | Server decides the lock; late answer rejected and phone told | P | engine.ts answerSubmit; run: "answer after lock -> too_late" |
| | Change any number of times; last before lock counts | P | engine.test.ts "show, answer, change answer…" |
| | Nothing from the phone can extend the lock | P | Only `this.now()` is compared with `locksAt` |
| | Test: 1 ms before counts, after does not | P | engine.test.ts "S-04: an answer 1 ms before locksAt counts, one at locksAt does not" |
| S-05 | Same browser reconnects as the same team, no input | P | hardening.test.ts "a reconnect storm: 30 phones…"; browser run (phone back after restart) |
| | New phone rejoins with code or host move | P | sd: "rejoin with code", "old phone told moved", "old rejoin code no longer works"; engine.test.ts "move code works once…" |
| | Rejoin works after Quiz Start | P | sd: rejoin ran in asking |
| | Display and console reconnect and show current state | P | browser run screenshots `display-back.png`, console back after restart |
| | Each screen shows "reconnecting" | P | `host-reconnecting.png`, `phone-offline.png`, `display-reconnecting.png` |
| | Restart loses no accepted answer, mark or score | P | engine.test.ts "a new engine on the same database…"; e2e kill -9 tests; note finding 11 for power loss |
| S-06 | 1 point, no negative, no speed | P | standings.test.ts "1 point per correct answer…" |
| | Closest scoring as set (closest, ties all score; range) | P | rules tests; run: closest 6/8/10 scored only 8 |
| | Joker doubles, also after mark changes | P | run: joker round 4 points from 2 correct; standings.test.ts joker tests |
| | Joker once per night, any round, before it starts | P | run: "joker twice refused"; engine `JOKER_PHASES` |
| | Sudden death adds no points | P | sd: totals unchanged after sudden death |
| S-07 | Rank by points; tie breaker by round wins, shown | P | standings.test.ts; run after dispute: round wins changed with marks |
| | Still level → shared unless sudden death | P | sd: "3-way tie" all `shared` |
| | Still tied after maximum → shared | P | standings.test.ts "…none right until the maximum: they share" |
| | Tests: shared round win, joker round win, three-way tie | P | standings.test.ts (each named) |
| S-08 | Quiz End saves date, quiz, teams, answers, marks, round scores, jokers, sudden death, positions | P | `results`, `answers`, `sudden_deaths`, `nights.quiz_snapshot`; run: "history detail" |
| | Survives restart; covered by backup | ~ | run: "history survives restart"; backup is Release (finding 1) |
| | Host sees past nights with final standings | P | `/host/history`, run: "history lists night" |
| | No personal data | P | Schema 6.2: name, colour, token hash |
| S-09 | Quiz = plain JSON + images, written by the builder | P | `quizzes/<id>/quiz.json`, media/ |
| | Theme = plain file + assets | P | `theme/theme.json`, `theme/assets/` |
| | Copied quiz folder appears | P | QuizStore.list rescans; B3 tests |
| | Formats documented | P | TECH-SPEC 5.2 to 5.4 |
| | Quizzes and themes never only in the DB | P | DB holds snapshots only |
| S-10 | One random line, never the same twice in a row | P | tests/branding/copy.test.ts; engine.test.ts "a pool never repeats its last line" |
| | Placeholders filled; missing value skips the line | P | copy.test.ts |
| | Theme can replace or add pools | P | `mergePools`; theme `copy` |
| | No line gives away an answer | P | Lines are picked with only team, pub, round, n and seconds; no answer is passed in |
| S-11 | 30 teams, full 6×5, no dropped answers | P | tests/load: 990 acked, 900 stored, 0 dropped |
| | Host sees answers within 1 s | P | p95 103 ms, max 106 ms |
| | Layouts for 20, still work at 30 | P | Fixture run: display leaderboard-20 and -30 fit with no scroll at both sizes |

### Host console

| ID | Criterion | | Evidence |
|---|---|---|---|
| H-01 | Lists quizzes with title, rounds, last edited | P | `/api/quizzes` shape; library.js |
| | Create, open, duplicate, rename, delete (with confirmation) | P | B3 tests tests/quizzes/api.test.ts; delete moves to `.trash/` |
| | Not-ready quiz marked and cannot open a night | P | engine.test.ts "a quiz that is not ready is refused…" |
| H-02 | Add, edit, reorder, delete rounds and questions; titles; all settings | P | builder.js; B3 screenshots |
| | New quiz is 6×5 with defaults | P | run: "new quiz default shape 6x5" (question lock, 60 s) |
| | Autosave, visibly saved | P | builder autosave (B3) |
| | Works on laptop and tablet, no hand-editing | P | B3 screenshots at 1280 and 768 (project files `b3-screenshots/`) |
| | Not editable while a night uses it | P | `423 quiz_in_use` (store `inUse`) |
| H-03 | Text and image media; text, choice, number, closest, date or time answers; host note; room to grow | P | formats.ts validators; run used each type; unknown kinds make a quiz not ready (5.2) |
| H-04 | Browser spellcheck on question, option, answer fields; no internet | P | builder.js:352, 412, 442, 448, 466, 566 (`spellcheck="true"`) |
| H-05 | Pick a ready quiz, open a night; display and phones go to lobby | P | run: "night open", "display lobby" |
| | Console shows room code, join QR, display address, teams (name, colour, phones) | P | `host-lobby.png` |
| | One night at a time | P | `one_open_night` unique index; `night_open` error |
| | Prizes set here | P | `night.update`; console "Edit prizes" |
| | Planned start optional | P | console "Planned start" field |
| H-06 | Rename any time; shows on display and phone | P | engine.test.ts "rename and remove…" |
| | Remove before Quiz Start, confirmed | P | `team.remove` lobby only; console menu |
| | Move to a new phone with code or QR; old phone cut off | P | engine.test.ts "move code works once…"; `/qr/move/:code.svg` |
| | See disconnected teams | P | "0 teams offline" chip, per-team status (`host-lobby.png`) |
| H-07 | Quiz Start closes joining, needs a team | P | run: "join after start refused"; engine.test.ts "quiz.start needs a team" |
| | Quiz End after the last round or sudden death: winner, history, close | P | run and sd |
| | Early end asks and still saves | P | engine.test.ts "quiz.end early from the middle of a round…"; console confirmation (B5) |
| H-08 | Jokers for the round shown before it starts | P | `TeamChip.jokerThisRound`, round intro screen |
| | Console shows text, answer, note, timer, count (not answers) | P | run: "host view has answer+note", "host answered count 3" |
| | Per-question timer, early lock | P | run |
| | Pause, resume, +15 s; display and phones follow within 1 s | P | run; protocol.test.ts; B9 latency |
| | "Everyone has answered" shown, timer keeps running | P | console asking screen (B5) |
| | Hide-answers switch | P | public/host/run/state.js, asking.js (`secret` class); host-run screenshot `hide-answers.png` |
| H-09 | Per-round: questions stay open, round timer after the last, lock together once | P | engine.test.ts "earlier questions stay open…"; sd ran in per-round mode |
| H-10 | Auto-mark choice, number, closest, date | P | run: choice and closest auto-marked |
| | Normalised exact match auto-correct | P | run: "the john f kennedy" auto-correct |
| | Others grouped, close matches first with nearest | P | run: groups ordered 0.86 then 0.21 |
| | Accept adds to accepted answers and marks every team in group | P | run: "J.F.K." accepted |
| | "JFK" moderation case | P | run: group key `jfk` marked correct |
| | Mark during or after a round | P | `MARK_PHASES` includes asking |
| | Reveal blocked until all marked, count shown | P | run: "reveal blocked while pending" |
| | Accepted answers saved to quiz file | P | run: "accepted answer saved to quiz file" |
| H-11 | Reveal one at a time; leaderboard after; phones show score and place; skip reveal | P | run; `leaderboard.show` from marking |
| H-12 | Halftime standings until next round; "none" means no break | P | run: "halftime after round 1"; sd quiz had "none" and no halftime |
| H-13 | Change any mark until Quiz End | P | run: dispute on round 2 after the reveal |
| | Scores, positions, joker update straight away | P | run: "after dispute" |
| | Each change kept in history | ~ | Stored in `mark_changes` (verified in the DB), not shown anywhere (finding 13) |
| H-14 | Console offers sudden death for tied position in scope | P | sd: "sd needed" |
| | Separate sudden-death list: text, choice, closest | P | `QuizFile.suddenDeath`, validator |
| | Only tied teams answer; others see it's on; one right takes it | P | sd: outsider refused (e2e); "phones: B sees in SD"; outcome "won" |
| | Max or list runs out → shared | P | standings.test.ts "the sudden-death list running out…" |
| | More than two tied: only the wrong drop out | P | sd: "after SD1: two right, C out" |
| H-15 | Prize text per place, venue default, per night | P | venue.json `prizes`, `night.update` |
| | Shown on display lobby, holding, halftime, winner; phones lobby, halftime, end; nothing when none | P | `display-lobby.png`, `phone-lobby.png`; display and phone fixtures |
| | No awarding | P | — |
| H-16 | Name, logo, colours, fonts (bundled or upload), background | P | brand.js; `/api/theme/assets` |
| | Live preview | P | `/api/theme/preview.css`, brand.js previews |
| | Saving writes theme file; screens update | P | protocol.test.ts "saving the theme sends every screen a fresh view…" |
| | Venue name fills `{pub}` | P | engine `pick` passes `pub` |
| | Default theme without branding | P | idle display screenshot |
| | Readability warnings, allowed | P | brand.js contrast warnings (B4) |
| H-17 | Holding page from N minutes before start until Quiz Start | P | display logic `holdingFrom`; fixture lobby-holding |
| | Panels chosen; empty panels skipped | P | venue.json `holding.panels`; display logic |
| | Open to more panels | P | Unknown panels ignored (5.4) |
| | Opened late → straight to holding page | P | 7.4 logic in display.mjs |

### Display

| ID | Criterion | | Evidence |
|---|---|---|---|
| T-01 | One address, no sign-in | P | `/display`; note finding 4 |
| | No interaction after opening | P | Browser run: everything driven from the host |
| | Fills 1920×1080 and 1280×720, no scroll | P | Fixture run: 34 of 34 |
| | Supported smart-TV and cast setups; real TV checked | M | Baseline test passes; real TV owed (finding 2) |
| | Older TV gets a plain message | P | `display-oldbrowser.png` (forced failure) |
| | Waiting screen with no night | P | `display-idle.png` |
| T-02 | QR and room code readable; teams in colours; lines and prizes | P | `display-lobby.png` |
| T-12 | Holding page panels with QR and code; countdown to 1 s; "starting soon"; bundled guide; baseline CSS | P | display fixtures; baseline test; guide is CSS in `public/display` |
| T-03 | Round, number, text, picture, options, timer; count only; `last_seconds`; 200 chars readable | P | fixtures asking, asking-image; engine `fireLastSeconds` |
| T-04 | Padlock with `locked` or `all_locked`; up to 2 s late; never early; no audio | P | run: "display locked moment"; NOTES B6 (plays if under 5 s old) |
| T-05 | Question then answer; `reveal` line; count right | P | run: "display reveal"; `RevealItem.rightCount` |
| T-06 | Position, name, colour, total, round score, joker mark; bottom-up; one line; 20 fit, 21-30 paged | P | fixtures; `display-leaderboard-30-1280.png` (places 21-30 first) |
| T-07 | Halftime standings, line, prizes | P | fixture halftime |
| T-08 | Own look and copy, names tied teams; shows like T-03 and T-04; ends with outcome | P | sd: lines "Still deadlocked…", "Deadlock broken…" |
| T-09 | Winner line, standings, last place, prizes, goodbye; shared first names all | P | sd: final lines; engine `winner_shared` |
| T-10 | Venue theme and "Powered by Lock-In" on every screen | P | Screenshots |
| T-11 | Discreet reconnecting, returns on its own, no reload | P | `display-reconnecting.png`, `display-back.png` |

### Team phone

| ID | Criterion | | Evidence |
|---|---|---|---|
| P-01 | QR or typed code opens the join page | P | `/j/:room`, `/`; `phone-join.png` |
| | Name 1-30 unique, colour assigned | P | engine `cleanName`, colours |
| | After start: told plainly | P | run: "The quiz has started, so new teams can't join. Ask the host." |
| | Full: told plainly | P | hardening.test.ts "a full night refuses the next team" |
| | Current and previous iOS Safari and Android Chrome | M | Only Chromium checked here (finding 2) |
| P-02 | Second phone, same name: told plainly, pointed to rejoin code | P | run: message text quoted above |
| | No viewer mode | P | — |
| P-03 | Clear states for every phase; pre-quiz countdown, prizes, guide link | P | team fixtures; `phone-lobby.png` |
| P-04 | Play before a round, with confirmation; locked after start; status shown; `joker_played` line | P | run; phone joker screen (B7) |
| P-05 | Inputs per type, image; change until lock with "received"; per-round navigation; one-handed, dark, 44 px | P | phone fixtures; B7 tests tests/phone/logic.test.ts |
| P-06 | "Answers locked" with the answer or nothing sent; late shown as not counted | P | team fixture asking-locked; `TeamAnswer.counted` |
| P-07 | Position, total, round score, joker; final position | P | run: "team final position" |
| P-08 | Offline bar, resumes on its own | P | `phone-offline.png`, `phone-back.png` |
| | Rejoin code always on team menu; works on another phone | P | sd: rejoin |
| | Offline answer not sent and shown so | P | B7 (11.5); phone disables inputs offline (NOTES decision) |
| P-09 | Only tied teams answer; others see who is in it | P | sd and e2e |
| P-10 | Manifest, icons, full screen on iPhone and Android with venue name and logo | ~/M | Manifest served with venue name and logo (finding 14); install on real phones owed |
| | Optional | P | — |
| | Opens to join page or back into the night | P | Service worker routes phone pages; token rejoin |
| | Guide on phone and holding page | P | phone "Show me", display install panel |
| | No offline queue | P | sw.js never answers for the server |

### Quality bar

| Criterion | | Evidence |
|---|---|---|
| Bun + TS; ArrowJS core vendored, vanilla CSS, no other frameworks | P | tests/vendor-arrow.test.ts (checksums); no dependencies |
| Display readable, no sound needed | P | Screenshots; no audio used |
| Phones dark, 44 px targets | P | phone.css; B7 |
| Plain-English host messages | P | Every error message read in engine.ts and routes is plain English |
| Copy from pools | P | Lines come from `CopyPicker` |
| No secrets or venue data | P | — |
| `bun test` passes | P | 675 pass |

---

## Build plan "Done when" (TECH-SPEC 14)

Shared criteria for every build PR (14.2): typecheck and tests pass on `main` (P). No runtime dependencies, nothing new in `public/vendor/` beyond Arrow (P, vendor-arrow test). Browser baseline and no-HTML-sink test pass (P). Path ownership was not re-audited per PR, but the NOTES record each agreed contract change (B0 `main.ts` option for B8, `/vendor/*` route by B3, `/display` module by B6, `HistoryDetail` in `protocol.ts`).

| Plan item | Criterion | | Evidence |
|---|---|---|---|
| **B0** | package.json, strict tsconfig, .gitignore, CI on PRs | P | `.github/workflows/ci.yml` runs typecheck and tests |
| | Contracts and validators with tests | P | src/shared/*, tests/shared/formats.test.ts |
| | `serve` needs a public URL; config precedence; data folder | P | config.ts `resolveConfig`; B0 tests |
| | Migration runner, schema 6.2 | P | src/server/migrations/001_init.sql; DB test |
| | Router, static, tokens, security headers, ping | P | http.ts, static.ts; CSP header equals 12.4 |
| | Auth: setup code, login, logout, rate limit, cookie, CLI | P | tests/server/auth.test.ts (17 tests); finding 7 |
| | `/ws`: hello per role, host needs session, ping, 5 s hello timeout, cmd routing | P | tests/server/ws.test.ts |
| | ws-client.js and clock.js | P | tests/shared/ws-client.test.ts |
| | Host shell with login, setup, nav | P | public/host/ |
| | Module folders with `register` | P | src/server/*/index.ts |
| | Test helpers, baseline test, fixtures incl. 20 and 30 teams, fixture server | P | tests/helpers, tests/fixtures/views |
| **B1** | Every command in 7.2 with phase rules and errors, tested | P | engine.test.ts, protocol.test.ts |
| | Both lock modes end to end | P | protocol.test.ts; e2e question and round |
| | S-04 fake-time test | P | named above |
| | Write-through and restart recovery incl. expired timer | P | engine.test.ts restart tests |
| | Views match 10.3; display and team privacy tested | P | engine.test.ts "through a whole night the display never carries answers…"; B9 privacy checks |
| | Marking via Rules; `saveAcceptedAnswer` | P | run: accepted answer saved |
| | Joker, Quiz Start, one phone per team, rejoin and move codes | P | engine tests; finding 5 |
| | Sudden death via sd.start, sd.ask, sd.reveal | P | sd |
| | Quiz End results; history API incl. open night; mark changes logged | P | run; finding 13 |
| | Lines and flashes from CopyPicker, no repeats | P | engine.test.ts copy lines |
| | Coalesced view sends | P | protocol.test.ts "answer submissions are coalesced…" |
| **B2** | Pure Rules, no I/O | P | src/server/rules/ |
| | Every listed test case | P | tests/rules/ (standings.test.ts names each) |
| **B3** | Atomic store, copied folder appears, not-ready problems | P | quizzes tests |
| | Every `/api/quizzes*` route incl. 409, 423 | P | api.test.ts; run: "stale save 409" |
| | Builder: all actions, settings, answer types, image resized in browser | P | builder.js, image.js; B3 screenshots |
| | Arrow draft and watch() autosave | P | builder.js |
| | Autosave about 1 s with "Saved" or a problem | P | builder.js |
| | Spellcheck | P | H-04 above |
| | 1280×800 and 768×1024 screenshots | P | project files `b3-screenshots/` |
| | `saveAcceptedAnswer` exported | P | quizzes/index.ts |
| **B4** | Theme and venue stores with validation and defaults | P | branding tests |
| | `/theme.css`, derived colours tested, themeVersion | P | theme-css.test.ts, derive.test.ts (507 inputs) |
| | Asset uploads checked by type and size, generated names, served per 12.4 | P | assets.ts sniffing; `UPLOAD_CSP` + nosniff; finding 10 |
| | Branding page with live previews and warnings | P | brand.js |
| | Venue page: prizes, holding minutes and panels | P | brand.js venue tab |
| | CopyPicker rules | P | copy.test.ts |
| **B5** | Renders HostView for every phase; `can` drives buttons; dialogs survive new views | P | tests/host-run/logic.test.ts; NOTES B5; finding 12 |
| | Lobby screen and Open display | P | `host-lobby.png` |
| | Asking screen, per-round script | P | host-run screenshots |
| | Marking screen | P | screenshots; run |
| | Team tools | P | teams.js |
| | Disputes from the standings | P | results.js + history API |
| | Sudden death and Quiz End with early confirmation | P | deadlock.js, results.js |
| | History list | P | public/host/history/ |
| | Plain English, reconnecting banner, screenshots at both sizes | P | `host-reconnecting.png`; tests/host-run/screenshots/ |
| **B6** | Every phase and fixture at both sizes, no scroll, no interaction | P | Fixture run 34/34 |
| | Arrow, baseline test, tokens and theme, keyed rows | P | display.mjs; baseline test |
| | `check.js` old-browser page | P | `display-oldbrowser.png` |
| | Every screen per Design | P | docs/screenshots/b6, own screenshots |
| | Bundled install guide | P | No external URLs in public/display |
| | Credit and reconnecting badge | P | screenshots |
| | Screenshots, desktop and Cast tab | ~ | Desktop yes; Cast tab not evidenced (finding 2) |
| **B7** | Arrow; a new view never clears a typed answer or focus | P | NOTES B7 focus test; tests/phone/ |
| | Every TeamView phase and fixture | P | tests/phone/screens/ |
| | Token storage, auto rejoin, team menu, `/m/:code`, "moved" screen | P | sd; phone logic tests |
| | Offline bar and "not sent" | P | `phone-offline.png` |
| | Dark, 44 px, 390×844 screenshots | P | tests/phone/screens/ |
| | Manifest, icons, shell-only service worker; install checked by hand | ~/M | sw.js reviewed; install by hand owed |
| **B8** | QR encoder, byte mode, ECC M, v1-10, vectors decoded | P | tests/qr/encode.test.ts, vectors.json |
| | QR routes with host-only checks | P | qr/index.ts (join public by design, see finding 4) |
| | `/api/server` | P | host-only |
| | `bun run build` embeds files; binary test from empty folder | P | tests/packaging/binary.test.ts; own build |
| **B9** | Load test at 30 teams, numbers in PR | P | 0 dropped, p95 103 ms |
| | E2E both lock modes incl. kill and restart | P | tests/e2e/night.test.ts, hardening.test.ts |
| | Every view privacy-checked | P | 81 display and 405 team views (question), 73 and 370 (round), 0 problems |
| | Findings in NOTES | P | NOTES "B9 … findings" |

---

## Security notes for the audit

Where to look first, in order:

1. **Who can reach a night without signing in** (finding 4). `/display`, `GET /qr/join.svg` and a `display` hello on `/ws` are open to anyone. That is by design for the TV (T-01, "no sign-in"), but it means the room code protects nothing against a remote visitor. Options for Cas: accept it for the pilot (the address is not advertised), add a rate limit and lobby-only checks to `team.join`, or give the display a one-time pairing code from the console.
2. **Team takeover by guessing** (finding 5). `team.rejoin` limits tries per connection (`engine.ts:1103`), so a script that reconnects gets unlimited tries. Moving the count to the client IP (as login does) would close it.
3. **Flooding** (findings 6, 8). No per-IP limit on WebSocket connections, messages or `team.join`. Each command clones the whole night model (`engine.ts:294`) and accepted ones write to SQLite.
4. **Proxy trust** (finding 7). `CF-Connecting-IP` is believed on every request.
5. **Checked and fine:** host session cookie (`HttpOnly; SameSite=Strict; Secure` off only on localhost, 32 random bytes, only the SHA-256 is stored); argon2id password in a 0600 file; setup code needed for every setup, compared in constant time and rate-limited; `Origin` must equal `publicUrl` for every mutating request and every WebSocket upgrade (verified live); a host session is re-checked on every host command, so `reset-password` from another process signs consoles out at their next command; uploads are sniffed by first bytes, stored under generated names and served with `nosniff` and a `sandbox` CSP, so a script inside an SVG logo cannot run; `/media/q/:id` is served only once the question is shown (or to the host); every file route checks names with a strict regex; no HTML sinks outside the vendored Arrow (baseline test); Arrow `${}` slots render text (verified with an `<img onerror>` team name and a `<script>` prize, no dialog fired); page CSP matches 12.4.

## Spec and doc drift

- TECH-SPEC 1.1 still says Design "may add a 'hide answers' switch … so it goes to Cas first (open question 15.2)". It was decided and built (15.2, H-08). The sentence is stale.
- TECH-SPEC 15.3 (does a round where everyone scores 0 have a winner?) is still marked "Cas to confirm". The code follows the spec (no winner), tested in standings.test.ts.
- TECH-SPEC 9.1's route table has no row for `GET /vendor/*` (3.4 and NOTES describe it). `GET /api/theme` also returns `problems`, which 9.2 does not list (NOTES B4 records it).
- NOTES B5: the console has no "display connected" indicator because `HostView` has no display count. That is not a REQUIREMENTS criterion, just a gap worth knowing.
- BRIEF.md is out of date, as NOTES already records (repo "starts private", closest-guess tiebreaker). REQUIREMENTS wins, so no action is needed.

## Not covered by this review

Line-by-line code quality (left to the separate review), per-PR path ownership, real phones, real TVs, Cast, the VPS and Cloudflare setup, and the copy pools' tone.
