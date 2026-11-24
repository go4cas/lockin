# Lock-In: decisions and findings

Decisions from the Interview thread (and findings from later threads). Each entry says what was decided, why, and what it affects. Nothing here overrides REQUIREMENTS.md or TECH-SPEC.md once those exist; later threads update this file when a decision changes.

## Interview decisions

### 1. Who hosts (2026-11-23)

- **Host is non-technical pub staff by default.** Anything the host touches must be usable without tech knowledge. Cas may host, but design for staff.
- **Starting Lock-In is double-click.** No terminal, no config editing on the night. Affects Architecture (local-mode launch, first-run setup) and Release (run sheet).
- **Host reads questions aloud and the TV shows them too.** The TV is not a substitute for the host's voice, and the host console needs the question text (and the answer) in front of the host.
- **Marking happens both ways:** the host can mark during the round (between questions) or at the end of a round. Neither model is the only one; the console must support both.

### 2. Shape of a night (2026-11-23)

- **Team count, rounds, questions per round and quiz length are all configurable** by the quizmaster per quiz. Nothing is hard-coded.
- **Halftime placement follows from the number of rounds** (the quizmaster sets it; no fixed rule).
- **Lock timing is a config option: per question or per round.** Per question: each question has its own timer and locks on its own. Per round: answers stay open across the round and lock together at the end, like collecting paper sheets. Affects the "answers locked" moment (once per question vs once per round), reveal flow and the WS protocol.
- **Pilot pub sizing:** a typical night is about 6 teams of 4 people.
- **Default quiz: 6 rounds of 5 questions** (30 questions), configurable. Halftime defaults to after round 3 (assumption, not stated by Cas).
- **Design target (assumption, proposed by the interviewer, not contested):** layouts and load tests aim for up to 20 teams, with the app still working at 30. The TV leaderboard must stay readable at 20 teams.

### 3. The TV (2026-11-23)

- **Support at least smart-TV browsers and casting** as ways to get the TV display on screen. HDMI from a laptop is assumed to work anyway since it is just a browser.
- **The TV is shared.** Assume most pubs use the TV for streaming, ads ("spots") and music, so the quiz takes over the TV for the night and hands it back; it is not a dedicated quiz screen.
- **Host location: support both** the host laptop driving the TV and the host on a separate device, **but analyse before designing**. Architecture should compare the setups before Design commits to one console layout.
- **Do not assume the pub has speakers.** When the quizmaster creates a music or video round, the app shows a message telling them the round needs sound in the room.

Findings to carry forward (interviewer's notes, not decisions):
- Smart-TV browsers are often old engines with weak font, CSS and audio support and fussy remote-control input. The TV view should rely on basic CSS and must not need any interaction after it opens.
- Tab casting usually needs desktop Chrome and adds lag; a Fire stick does not cast a browser tab. The "answers locked" moment must look right with a second or two of lag on the TV.
- A smart TV or cast receiver must reach the Lock-In server, so it has the same network question as the phones (topic 4).

### 4. Network: local or hosted (2026-11-23)

- **The pilot runs in hosted mode** (VPS behind Cloudflare).
- **Pilot pub:** guest Wi-Fi with a password; good mobile signal inside.
- **"Local first" means the client devices, not local mode.** A client (team phone at least) keeps working when its connection to the server breaks and syncs when it comes back. Hosted is still the pilot mode; local mode stays in the one binary for venues that can use it.
- **Local-first clients are not MVP.** They are a Later feature. For Later, the interviewer's proposed rule (not yet agreed): the phone queues answers offline, the server accepts a late-synced answer only before that question or round is revealed, and the host sees it flagged "synced late" to accept or reject. Reason: a phone's clock cannot prove when an answer was typed, so an unflagged late answer invites Googling.
- **MVP behaviour (interviewer's default, stated to Cas):** the lock is strict and server-side; an answer counts only if it reached the server before the lock. A phone that loses its connection shows a clear "offline, reconnecting" state, and on reconnect the team gets back its identity, answers and score (the brief's "rejoin without losing score" core feature). TV and host console show "reconnecting" and resume where they left off.

How the devices connect (explained to Cas): no device talks to another device directly. Phones, TV and host console each talk only to the Lock-In server.
- Hosted: every device needs internet to reach the VPS. Guest isolation on the Wi-Fi does not matter. If the pub's internet drops, phones on mobile data carry on; the host laptop and TV (on pub Wi-Fi) lose the server until they reconnect.
- Local: the server is the host's laptop, so phones and TV must reach the laptop across the pub's Wi-Fi. No internet needed, but guest isolation (common on guest networks) blocks it outright, and phones on mobile data cannot reach it.

### 5. League, prizes and seasons (2026-11-23)

- **Two milestones, not one.** Cas distinguishes the **pilot** (first nights at the one pub) from the **product launch**. League, weekly standings and hall of fame are not needed for the pilot but are needed before launch. Requirements should make clear whether "MVP" means pilot or launch (see open questions).
- **Prizes:** an optional space to show the night's prizes (for example on the TV in the lobby, at halftime and at the winner moment). The app does not manage or award prizes; the host announces them.
- **Keep event history from day 1.** Every night's teams, scores and results are stored from the first pilot night, so a later league or hall of fame has real data. Affects the data model from B0 onward even though no league screens exist yet.
- **Reusing teams and members across nights is a bonus** (nice to have, not pilot).

### 6. The questions (2026-11-23)

- **A regular quizmaster (QM) writes the questions, a couple of days ahead.**
- **They are written on paper today.** So the QM types every question into Lock-In: the quiz builder must be a friendly screen a non-technical QM can use, not hand-edited Markdown or JSON. Plain files can still be the stored format, written by the builder. Import from other formats is not a pilot need.
- **No editing questions on the night.** Instead, a spelling and grammar check in the builder is a wanted feature, so mistakes are caught before the night.
- **Acceptable alternatives for typed answers are added by the QM while marking**, not listed up front. Interviewer's note: once the QM accepts an answer, the same (or fuzzily same) answer from other teams on that question should be accepted too, so the QM marks each distinct answer once.
- **AI help is wanted (interviewer suggests Later):** generating questions, and a new idea, checking the accuracy of the QM's questions and answers. The brief already lists an optional AI generator with host review. Points for Requirements/Architecture: it needs internet and an API key (a secret, so never in the repo), and it must stay optional so local mode and offline nights work without it.

### 7. Scoring and the joker (2026-11-23)

- **1 point per question.** A bonus question worth more is an idea for later.
- **No negative marking** (a wrong answer scores 0) and **speed never affects score**.
- **Joker is played before a round starts** and cannot be changed once the round begins. It can be played on the final round. Points in that round count double.
- **Ties need sudden death.** Cas's idea: one question at a time, repeated until one tied team gets it right and the other does not. Interviewer's note: "first right" can go many rounds if both teams keep getting questions right or wrong, so the QM needs a stock of tiebreak questions; a closest-number question settles it in one go and matches the brief's "closest-guess tiebreaker". Cas chose **right/wrong sudden death**: tied teams answer one question; if exactly one is right, it wins; otherwise ask another. **The QM sets the maximum number of sudden-death questions; still tied after that, the teams share the position.**
- **Sudden death gets its own branding** (Cas). Design should treat it as a key moment alongside join, locked, reveal, leaderboard, halftime and winner, with its own look and copy. Finding: the `tiebreak` copy pool includes "Closest guess wins. No pressure.", which no longer fits right/wrong sudden death; the copy review should fix it and consider a dedicated sudden-death pool.
- **Tie rule for positions:** if teams are level on points, the team with more round wins ranks higher; if still level, they share the position. Interviewer's note: "round win" needs defining (suggest: highest score in that round, joker included, shared top scores count as a win for each).
- **Configurable (both):** whether sudden death applies to first place only or to other places too, and whether a closest-number question scores the closest team only or every team within a range.

### 8. Joining and team names (2026-11-23)

- **No name approval or rude-word filter.** The QM can rename a team from the console.
- **A second phone joining an existing team** either joins as a viewer or gets a "this team already has a phone" message; **configurable**. Default to be set by Requirements (interviewer suggests viewer, since teammates will want to see the question).
- **Replacing a team's phone:** the team's phone shows a short rejoin code, and the host can also move a team to a new phone from the console. The team keeps its name, answers and score.
- **No late joining.** The night has explicit **Quiz Start** and **Quiz End** events. Joining is open before Quiz Start and closed after it (rejoining an existing team still works). Quiz End closes the night and is the point where results are saved to history (topic 5).

### 9. Open source and venue branding (2026-11-23)

- **The `lockin` repo is already public** (the brief says it "starts private"; that is out of date). Everything committed here is public from now on, so the no-secrets, no-venue-data rule applies to every commit, including these notes.
- **Release path:** build and test in the public repo up to `v1.0.0`, then take it to the pilot pub. So the pilot runs `v1.0.0`.
- **A private, branded pilot repo exists.** Interviewer's recommendation (pending Cas's agreement): do not fork the code for the pilot. Treat a venue's branding as data: uploaded through the host's settings screen, stored on the server's data folder as plain files, and covered by backups. A private repo is then only useful, if at all, for the venue's own data (theme files, quiz packs, deploy settings), never a copy of the code. This keeps one codebase and avoids a fork that drifts.
- **Venue themes are made by non-technical people** (pub staff, designers). So branding needs a settings screen (name, logo, colours, fonts, TV background, copy lines) rather than hand-editing a theme file. The theme file stays the stored format, and can be exported and imported.
- **The pilot pub uses its own branding**, with the small "Powered by Lock-In" credit.
- **Licence: decide later** (Cas, 2026-11-23). The repo stays public without a licence for now; the recommendation below stands for when it is picked up.

#### Licence recommendation

What matters here: Lock-In is a server app that venues self-host or that someone could run as a paid hosted service; it has no runtime dependencies, so there are no licence-compatibility constraints; and venues' own themes and quiz packs are data, not code, so no licence touches them.

- **AGPL-3.0 (recommended).** Free for any pub to run, modified or not. Anyone who runs a *modified* version as a service for others must publish their changes. Stops a company taking Lock-In, improving it in private and selling it as a closed hosted service. Cas, as copyright holder, can still run a paid hosted version. Cost: some companies avoid AGPL code, and if Cas ever wants to sell other licences, outside contributions need a contributor agreement.
- **MIT or Apache-2.0.** Anyone can do anything, including a closed paid service built on it. Most adoption and least friction; Apache-2.0 adds a patent grant. Choose this if wide reuse matters more than keeping improvements open.
- **MPL-2.0.** A middle ground: changes to Lock-In's own files must be shared when distributed, but the network-service loophole stays open, so it does not stop a closed hosted service.

## Requirements decisions (2026-11-23)

- **MVP means the pilot** (`v1.0.0`). Ranks are MVP, Launch (needed before the public launch), Later and Won't (Cas chose this on the Requirements thread).
- **Cas added:** more answer types (free text, multiple choice, number, closest number, date or time); image, sound and video questions; the AI question generator and AI verifier; QM moderation of equivalent free-text answers ("JFK" for "John F Kennedy"); a configurable pre-quiz holding page (countdown, registered teams, a guide to adding Lock-In to the phone's home screen, a brand animation); prizes on TV and phones.
- **Ranking:** image questions, the new answer types, moderation, the holding page, the home-screen (PWA) install and prizes on phones are MVP. Sound and video questions and both AI features are Launch (Cas confirmed), because sound needs speakers (topic 3) and AI needs internet and an API key (topic 6).
- **Proposed by Requirements, confirmed by Cas:** host login, removing a team, pausing or extending the timer, copy-pool editing and theme export moved to Launch, browser spellcheck for the pilot with grammar check Later, and the defaults table in REQUIREMENTS.md.

- **Changes on review (Cas, 2026-11-23):** the joker is off by default; one phone per team with no viewer mode (a second phone gets a "this team already has a phone" message), replacing the configurable choice in topic 8; ties are two named steps, the **tie breaker** (most round wins, automatic) and then **sudden death**.

## Architecture decisions and findings (2026-11-23)

Full detail in [TECH-SPEC.md](TECH-SPEC.md).

- **Host setup (N3, settled by Architecture):** the pilot's recommended setup is one laptop on HDMI with the TV as an extended display, plus an optional tablet or phone for the host. The console is designed laptop-first (1280 px) and must work on a tablet (768 px); it assumes it is never shown on the TV, and has an "Open TV screen" button. Several host devices can be signed in at once.
- **TV support (T-01):** tested before `v1.0.0`: laptop over HDMI, Chrome "Cast tab" to a Chromecast or Google TV, and the pilot pub's own TV browser. Targeted but untested: Samsung Tizen 2018+, LG webOS 4+, Android TV, Fire TV Silk, AirPlay or Miracast extension. TV code follows a Chromium 56 / Safari 11 baseline (no CSS grid, no flex `gap`, no `?.`, classic scripts), enforced by a test.
- **Server restart (S-05):** confirmed at low cost. Every change is written to SQLite before it is acknowledged.
- **Theme file:** stores Design's branding inputs (name, logo, four colours, two fonts, TV background, copy overrides); the server expands them into `--brand-*` CSS properties, agreed with Design.
- **Full views over the WebSocket:** the server sends each client its whole view after every change, which makes reconnecting simple and keeps answers off the TV and other teams' phones.

- **Local mode moved to Later (Cas, 2026-11-23).** Hosted only for the pilot and the launch; local mode must not hold up the launch. Reasons: install friction for non-technical hosts (unsigned-app warnings on macOS and Windows unless paid signing, firewall prompts), guest Wi-Fi isolation and phones on mobile data cannot reach a laptop, home-screen install needs HTTPS, and Windows and Mac builds to test. Lock-In stays one binary (Linux x64), so local mode can be added later without a redesign (TECH-SPEC 4.8). REQUIREMENTS S-01 is now hosted only; S-02 is Later.
- **Hosting:** stay on a VPS behind a Cloudflare tunnel rather than Cloudflare Workers and Durable Objects (discussed with Cas): Workers would be a stack change, move quizzes and themes out of plain files, and make self-hosting harder.

Findings:
- **Home-screen install needs HTTPS.** Hosted mode has it through Cloudflare.
- **Round win with all-zero scores:** the spec says such a round has no winner (Cas to confirm).

## Design findings and decisions (2026-11-23)

From the Design thread; detail and evidence in [docs/design/](design/README.md).

- **Chalkboard is the default theme, adjusted.** Its colours pass contrast on the TV (chalk on blackboard 14.7:1), but chalk-coloured text on coral or teal fails (2.1:1, 1.8:1), so labels on filled colours are dark. Surfaces are now derived from background and text, so a venue only picks four colours.
- **Fonts:** a textured chalk font loses about half its contrast at the back of the room (simulation in docs/design/img/test-font-distance.png). Default display font is Caveat Brush (solid brush strokes), used only for moment titles and host-voice lines. Body font is Atkinson Hyperlegible (made for legibility; distinct I/l/1). Both are bundled (OFL), so screens never depend on an outside font service.
- **TV sizes come from viewing distance.** Everything a team must read is comfortable to about 5 to 6 m on a 55" TV, and the timer, lock and room code to 10 m or more. Long picture questions are the weakest case, covered by the host reading aloud and the phone showing the question.
- **TV CSS baseline** (with Architecture): Chromium 56 / Safari 11. No grid, flex gap, clamp() or color-mix() on the TV; a test checks it. Content stays inside a 5% overscan-safe area.
- **Team colours:** 8, cycled by join order. Some pairs merge for colour-blind viewers, so a team is always its colour dot plus its name.
- **Venue branding:** the branding screen sets name, logo, four colours, two fonts and the TV background; the server derives the rest (docs/design/branding.md). Low-contrast or light choices get plain-word warnings but can be saved (H-16).
- **Sudden death is branded "Deadlock"**, with "Sudden death" always on screen too, in a fixed black-and-ember look that ignores the venue theme. Cas confirmed the name (2026-11-23).
- **Logo changed (Cas, 2026-11-23):** the question-mark shackle could read as a bent padlock, so the mark is now a normal closed padlock with a "?" cut into the body, its dot as the keyhole (docs/design/logo/).
- **Copy pools:** `tiebreak` split into `tie_breaker` and `sudden_death`; added `sudden_death_again`, `sudden_death_won`, `sudden_death_shared` and `winner_shared`; two lines fixed. `no_answer` has no screen in `v1.0.0`. Placement rules in docs/design/copy-review.md.
- **Mirrored HDMI risk:** if the host laptop mirrors its screen to the TV, the room sees the answers. The console has a "Hide answers on this screen" switch; the release run sheet should tell hosts to use an extended display.

## B0 foundation: findings (2026-11-23)

Built against TECH-SPEC as changed by PR 5 (hosted only). None of these change a contract type; they are details the spec left open, recorded so later threads find them.

- **How modules plug in.** `src/server/app.ts` builds the `App` every module's `register(app)` receives: `route()`, `ws` (the socket hub), `auth`, `db`, `clock`, `files`, `onStart`/`onStop`, and `services`. `createApp()` calls every module's `register`, and `main.ts` (the CLI) only calls `startServer()`, so no build thread edits either file. The spec put the `register` calls in `main.ts`; they moved one file down so tests can start a server without the CLI.
- **Cross-module services.** `app.services` holds `rules` (B2), `copyPicker` (B4) and `quizStore.saveAcceptedAnswer` (B3). Each module sets its own entry in `register` and reads others' only when it needs them, so register order does not matter.
- **The engine's hooks into the socket hub (B1).** `app.ws.setCommandHandler`, `setViewProvider`, `setTeamTokenResolver`, `onConnect`, `onDisconnect`, `connections(role)`, `sendState`, `broadcastState`. The hub already enforces roles: a TV can send no command, a team only `team.join`, `team.rejoin`, `joker.play` and `answer.submit`, a host every other command (not the team ones), and a host command re-checks the session.
- **Setup code file.** The setup code lives in `<dataDir>/setup-code` (mode 0600), so `lockin setup-code`, a separate process, prints the code the running server checks. It is made at start if missing, removed when the password is set, and renewed by `lockin reset-password`. It is not in the 5.1 layout and is git-ignored.
- **The data folder cannot come from `config.json`**, because that file lives inside it. Flag, `LOCKIN_DATA`, then `./lockin-data`.
- **Secure cookie.** Left off only when the public URL is plain `http://` on localhost or 127.0.0.1 (development); on any other address it is on.
- **HTTP error codes for auth** (the spec names none): `already_set`, `setup_needed`, `bad_setup_code`, `weak_password`, `bad_password`, `too_many_tries` (429), `signed_out` (401), `forbidden_origin` (403). A wrong setup code counts towards the same 5-a-minute limit as a wrong password.
- **Additions to `src/shared/`** (new exports, no changed types): `PHASES`, `COMMAND_NAMES`, `TEAM_COMMANDS`, `View`, `Flash` (typed from the prose in 10.4), `emptyLines()`, `DEFAULT_QUIZ_SETTINGS`, `defaultTheme()`, `defaultVenue()`, `HOLDING_PANELS`, `BUNDLED_FONTS`. `validateQuiz(json, { folderId?, mediaExists? })` takes an optional second argument for the folder-name and image checks; `validateTheme` and `validateVenue` return `{ ok: true, value } | { ok: false, problems }`. Missing settings, theme fields and venue fields take their defaults; wrong values are problems.
- **Spec gap for B1:** `EngineState.lines` in 7.5 uses a `Line` type that is not defined anywhere. B1 owns that file and should define it (probably `string`).
- **`ws-client.js` behaviour the spec did not fix:** reconnecting stops after `bye` with `moved`, `removed`, `signed_out` or `protocol`, and carries on after `night_closed`. A new `welcome` resets `seq` ordering, so a restarted server's first state always renders. When the page URL has `?fixture=`, it is passed on to `/ws` for the fixture server.
- **Design files served by B0:** `/static/shared/tokens.css` is `docs/design/tokens.css`; `/static/fonts/<id>.woff2` is `docs/design/fonts/<id>-400.woff2` (Design's files carry a weight, the spec names fonts by id), and other files in `docs/design/fonts/` by their own names; `/static/logo/<file>` is `docs/design/logo/`. The theme validator follows `branding.md`: any bundled font can be the display font, only `atkinson-hyperlegible` the body font. Host pages link `/theme.css`, which answers 404 until B4, so browsers log a harmless stylesheet warning until then.

## Rename: "TV" is now "Display" (2026-11-24)

- **Cas approved renaming the TV screen to "Display"** in docs and code, merged B0 contracts included. The screen may be a smart TV, a cast tab, a projector or a laptop's second screen, so "Display" names the role, not the hardware.
- **Contract changes:** WebSocket role `"tv"` is now `"display"`; `TvView` is `DisplayView`; the theme field `tvBackground` is `displayBackground`; the page is `GET /display` from `public/display/`, its QR code is `/qr/display.svg`, and `GET /api/server` returns `displayUrl`. Tokens `--tv-*` are `--display-*` and `--brand-tv-*` are `--brand-display-*`. Fixtures live in `tests/fixtures/views/display/`, and the wireframe is `docs/design/wireframes/display.html`. Version numbers (`protocol: 1`, `lockin.theme/1`) are unchanged, since nothing has shipped.
- **Kept as they are:** requirement IDs (`T-01` and so on), so references don't break. "TV" stays where it means the hardware (smart-TV browsers, old TVs, "55-inch TV", Fire TV) and in copy that teams read ("Eyes on the TV", "Watch the TV.", "On the TV if you need it."), because that is what people in a pub call it. The brief and the dated notes above are records, so they still say "TV".
- **Watch for:** "display" is also the typography word for the headline font (`--font-display`, `fonts.display`, the `.display` class). The two don't clash in code, but prose that says "the display font" means the headline font.

## Front-end: ArrowJS and modern displays (2026-11-24)

- **Cas approved ArrowJS core for every page** (host console, display and phones) instead of vanilla JS only. Reason: reactive templates keep typed answers, focus and open dialogs when a new view arrives, keyed lists make the leaderboard re-order easy, and the builder and branding pages get simpler state. It is a stack change and changes the merged TECH-SPEC contracts 3.1 to 3.3, 12.4 and 14.2.
- **Quiver is not used.** Cas's own router and app layer for Arrow needs the Navigation API (Safari 26.2+), which misses the previous iOS Safari that P-01 promises, and Lock-In's pages are routed by the server anyway.
- **Vendored, not a package.** `@arrow-js/core` 1.0.6 (MIT) is copied unchanged into `public/vendor/arrow/`, with its licence, source tarball integrity and SHA-256 per file in `vendor.json`; a test fails if a file changes. No CDN (Arrow's docs only show an unpinned esm.sh import), no npm dependency, no import map. `package.json` still has no `dependencies`.
- **Modern displays only.** The display baseline moves from Chromium 56 / Safari 11 to Chromium 86 / Safari 14 (roughly smart TVs from 2022 onwards). Arrow cannot meet the old baseline: even its classic-script build uses `?.`, `??`, `replaceChildren` and `queueMicrotask`. Older TVs use a laptop over HDMI or a Chromecast, and the display page tells them so (B6). A vanilla fallback display is Later, only if users report problems (TECH-SPEC 15.4). Cas: "start off with only support for newer displays ... we can circle back".
- **Checked before deciding:** the scanner in `tests/helpers/baseline.ts` was updated to the new baseline, and the vendored Arrow files pass it. Arrow renders `${}` values as text nodes and attribute values, and only uses `innerHTML` on the developer's static template strings, so the security rule (12.4) is reworded rather than weakened; a new test bans HTML sinks in our own page code. Arrow has no `eval`, so the CSP is unchanged.
- **Risks accepted:** Arrow spent about five years in alpha before 1.0 (2026-03-20), has one main author, and had no release after 1.0.6 (2026-04-01). Being vendored, it keeps working if upstream stops; updating it is a contract change.
- **B0 code:** `public/shared/` behaviour is unchanged. Its classic scripts are loaded before each page's Arrow module and only their header comments changed. Two small B0 edits were needed: `src/server/static.ts` serves `.mjs` as `text/javascript` (module scripts require it), and `tsconfig.json` maps `/vendor/*` so Arrow imports type-check.

## B1 night engine: findings (2026-11-24)

Built to TECH-SPEC 7, 8 (applying), 9 (media and history), 10 and 11 with no contract type changed. These are details the spec left open, decided in `src/server/night/` and pinned by tests in `tests/night/`.

- **Files.** `state.ts` (EngineState, `Line = string`, closing the B0 spec gap), `engine.ts` (commands, timer, marking, sudden death, Quiz End), `views.ts` (host, display and team views), `store.ts` (SQLite write-through and history queries), `scheduler.ts` (Clock-driven scheduler; tests call `runDue()` on fake time), `sources.ts` (quiz, venue and theme reads), `quiz.ts` (snapshot helpers), `index.ts` (hub wiring and routes). `engines.get(app)` gives tests the engine and scheduler.
- **Write-through.** Each command runs on the in-memory model, then writes the state row and every changed team, answer, sudden-death, mark-change and result row in one transaction before views and the ack go out. If the command fails or the write throws, memory goes back to a copy taken before the command.
- **Views go out before the ack** on the commanding connection, so a button re-enables with the new view already drawn. Answer submissions send the submitting phone its view at once and everyone else within 100 ms (one coalesced broadcast, not one timer per connection). Presence changes (a phone connects or drops) bump `seq` in memory and resend only host views.
- **Cross-module services.** Rules come from `app.services.rules` and copy from `app.services.copyPicker`, looked up on use. Without rules, `night.open` fails with `server_error`; without a copy picker, screens show no line. Restart recovery that needs rules and finds none waits and finishes on the next command or view. Accepted answers go to `app.services.quizStore.saveAcceptedAnswer` after the commit; until B3 merges they stay in the night's snapshot only (logged).
- **Quiz and venue reads.** The engine reads `quizzes/<id>/quiz.json` itself (read-only, `validateQuiz` with the folder and media checks), so it works before B3. Venue name, theme version and venue defaults come from B4's `branding(app)` store (falling back to reading `theme/theme.json` and `venue.json` if that export is ever missing); theme saves call `onThemeChange`, which sends every screen a fresh view with the new `themeVersion`.
- **Lines.** One line per slot, cleared when the phase moves on (for example `locked` clears at the next question). `round` and `question` both get the `round_start` line at round_intro; `question` clears when the first question shows (per-round mode) or each question shows (per-question mode), and gets `last_seconds` at `locksAt - 10 s`. `locked` uses `all_locked` with `{n}` when every team answered. Leaderboard lines use `leaderboardLine(before, after)` with standings without sudden-death outcomes; `{team}` is the new leader(s) for `lead_change` and `tie_breaker`, the biggest climber with `{n}` places for `big_climb`. `{pub}` is always the venue name.
- **Flashes.** `team_joined` and `joker_played` live in `state.flash`. `no_answer` flashes are kept per team in memory only (not persisted, they last 6 s), because one `flash` field cannot hold one per team. Views drop a flash older than 6 s.
- **Errors chosen where the spec named none.** Joining after Quiz Start is `joining_closed`; a name already in the night is `team_has_phone` on join and `name_taken` on rename; a phone already in a team joining again is `bad_args`. A shown-then-locked question, or a timer past `locksAt`, is `too_late`; a question not shown or not current is `question_closed`. A team outside sudden death answering it is `not_allowed`. `quiz.end` without `early` outside the natural end is `wrong_phase`. Team names are 1 to 30 characters (REQUIREMENTS), spaces collapsed.
- **Removed teams.** A removed team's `name_key` gets `#<teamId>` appended, so its name can be used again (`name_key` is unique per night in 6.2).
- **Move codes and rejoin tries** are kept in memory: a restart drops unused move codes (they last 10 minutes anyway) and resets the 5-a-minute count.
- **Sudden death.** Outcomes are replayed from the `sudden_deaths` rows in the order B2 documents (winner, still-tied teams, later drop-outs above earlier ones; the maximum reached gives one shared group first). After a position is decided, `sd.ask` moves on to the next position `suddenDeathNeeded` returns (scope `all`), so the host never goes back to the leaderboard. `sd.start` needs at least one sudden-death question in the quiz.
- **Quiz End.** Open questions are locked and auto-marked first. An early end ranks the rounds played so far. `last_place` is only set when the last position is not 1st.
- **Group keys.** Typed answers group by `rules.normalise(text)`; other types use `choice:<i>`, `number:<v>` or `datetime:<v>`, which is what `mark.group` takes as `key`.
- **History.** `GET /api/history/:nightId` follows the shape agreed with B5 and Cas (open night included, live standings for it); B5 adds the `HistoryDetail` type to `protocol.ts`, and B1 defines a matching local type until then. Sudden-death questions that were asked are included (Cas, 2026-11-24): they come last in `rounds` as `{ index: -1, title: "Deadlock" }` (shape agreed with B5), numbered 1.. across the night in the order asked, and their answers are in `answers`.
- **`tests/server/ws.test.ts`** (B0) had a test named "until B1 lands, every allowed command answers wrong_phase"; it now checks that a command needing a night answers `wrong_phase` with no night open.

## B4 branding, venue settings and copy: findings (2026-11-24)

- **One colour maths, three copies, one test.** Design's `docs/design/tools/derive.ts` is the reference. The branding page uses a plain-JS copy, `public/host/brand/derive.js`, and the server uses `src/server/branding/derive.ts`. The server cannot import the page's file: B8's binary embeds everything under `public/` as raw files, and `bun build --compile` then refuses to import one of them as a module. `tests/branding/derive.test.ts` checks all three give the same tokens and checks for 507 inputs.
- **How other modules use B4.** `branding(app)` from `src/server/branding/index.ts` gives `theme()`, `themeVersion()`, `venueName()`, `venue()` and `onThemeChange(fn)`. The copy picker is `app.services.copyPicker` as planned. B4 does not push new views when the theme is saved, because view `seq` belongs to B1: **B1 should call `onThemeChange` and broadcast**, so pages see the new `venue.themeVersion` and reload `/theme.css` straight away rather than on the next state change. `venue.name` in views is a string, and `venueName()` is null without a name; B1 decides what to send then (probably "").
- **Files are read on change.** The stores check `theme.json` and `venue.json` modification times on each read, so a theme copied in by hand is used without a restart (S-09). A file that fails validation is logged, the defaults are used, the console gets the problems in `GET /api/theme` (`problems`, an extra field), and the file is left alone until the host saves.
- **Copy pools.** `docs/brand/copy.en.json` is read through `app.files` (B8's rule), so the binary uses its embedded copy. Every array in the file is a pool named by its key (`voice.lobby` is `lobby`; the 12 `taglines` are pool `taglines`). `{pub}` defaults to the venue name when the engine does not pass one. A line with a placeholder the picker does not know is skipped rather than shown with braces.
- **Choices the spec left open:** `/api/theme/preview.css` is scoped to `.lockin-preview` and names uploaded fonts "Lock-In Preview Display/Body", so the preview never restyles the console; uploaded fonts in the real theme are "Lock-In Venue Display/Body". Uploads are named `<kind>-<10 hex of SHA-256>.<ext>`, so the same file gives the same name. A theme that names an asset that is not on disk is refused. Venue prizes are saved in place order, and two prizes for one place are refused. The holding page panels can be reordered as well as switched off (5.4 says they show in order).
- **Checked against B3's Arrow pitfalls (2026-11-24).** Every template a `${() => ...}` slot returns now has one wrapper element (two did not: the picture-background and uploaded-body-font branches). Lists that change (panels, prizes, warnings, preview prizes) are keyed, because an unkeyed or same-shape template kept its first text. A browser run switching tabs, font and background modes repeatedly, uploading, and adding, editing and removing prizes logged no errors.
- **Not done here:** old uploaded files are never deleted (they are small and content-named; clean-up could come with theme export, H-22). The PWA icon from the logo and the manifest are B7. The wireframe's "Host password" tab on Venue settings is **not in `v1.0.0`** (coordinator, asked by Cas, 2026-11-24): S-03 does not ask for a password change in the console, and `lockin reset-password` (B0) covers a forgotten one. A change-password option in the console is Later.
- **Found while building:** (1) `/vendor/*` has no server route on main yet, so every Arrow page, this one included, fails to load Arrow in a real browser until B3's route lands; screenshots here were taken with a local, uncommitted route. (2) Host pages load `/theme.css` (B0), so the console itself takes the venue's colours; a light theme makes the console light too. **Decided (Cas, 2026-11-24): branding applies on every client (team phones, console and display)**, so this stays as it is. (3) TECH-SPEC 3.4 was followed by a stale copy of the old Chromium 56 baseline table and text (left over from PR #8), contradicting 3.3; removed in PR #11 with the coordinator's OK, as it only matches what Cas approved in PR #8.

## B8 packaging and QR codes: findings (2026-11-24)

- **One B0 edit, approved by Cas (2026-11-24).** `main()` in `src/server/main.ts` takes an optional fourth argument, `appOptions`, passed to `startServer`. A compiled binary has no source folder on disk (`import.meta.dir` is `/$bunfs/root`, so B0's `diskSource()` would look in `/`), so the binary's entry passes a `FileSource` that reads the embedded copies. Dev and tests are unchanged.
- **How the binary is built.** `bun run build` (`scripts/build.ts compile`) lists the files to embed, writes `src/server/embedded.ts` (imports each file `with { type: "file" }`, maps it, then calls `main()` with that source), runs `bun build --compile --target=bun-linux-x64` and deletes `embedded.ts` again (it is also in `.gitignore`). The map is keyed by **repo-relative path** (`public/shared/ws-client.js`), because that is what B0's `FileSource` reads; TECH-SPEC 4.6 says "URL path", which is the same files under the names B0's routes already use.
- **Embedded:** all of `public/` (vendored Arrow included), `docs/brand/copy.en.json`, `docs/design/tokens.css`, `docs/design/fonts/` (WOFF2 and OFL licences) and `docs/design/logo/`. Hidden files are skipped. A new folder anywhere under `public/` is picked up with no change to the build.
- **Rule for every module:** read shipped files through `app.files` (for example B4 reading `docs/brand/copy.en.json`), never with `node:fs` relative to the repository. Anything read from disk works in `bun run dev` and silently fails in the binary. A file outside the embed list above needs a line added to `EMBED_ROOTS` in `scripts/build.ts`.
- **Binary size** is about 105 MB, almost all of it the Bun runtime.
- **The binary test** (`tests/packaging/binary.test.ts`) runs `bun run build`, copies only the binary into an empty temporary folder, starts it on a random port, and checks `/api/ping`, `/static/shared/ws-client.js`, every embedded static file byte for byte, a host page and a QR code. `/display` belongs to B6 and is not on main yet, so the test checks the binary answers exactly as the source does, and requires 200 once `public/display/index.html` exists. It only runs on Linux x64 (CI is).
- **QR mask choice differs between libraries.** For the same text, segno 1.6.6, python-qrcode 8.2 and Project Nayuki's reference encoder picked three different masks, because ISO 18004's rule 3 penalty is read differently. Every mask scans; the encoder follows Nayuki's reading, and `tests/qr/vectors.json` holds 23 of its matrices (versions 1 to 10, all 8 masks). With the mask fixed, python-qrcode gives the same matrices. segno also wrote an extra `0x00` codeword before the padding for short data, so it was not used as a reference. A separate decoder in the tests (format bits, unmasking, Reed-Solomon syndromes, byte mode) round-trips every length from 0 to 213 bytes.
- **Routes.** `/qr/join.svg` is public (the display shows it) and encodes `<publicUrl>/j/<roomCode>` for the open night, or `<publicUrl>/` when no night is open; `/api/server` reports `joinUrl` by the same rule. `/qr/display.svg`, `/qr/move/<code>.svg` and `/api/server` are host only. The move route checks only that the code looks like a move code (8 characters from the rejoin alphabet, any case); whether it is still valid is B1's check when the phone opens `/m/<code>`. QR responses are `Cache-Control: no-store` so an old night's room code is never shown from a cache. The room code is read from the `nights` table, so B8 needs nothing from B1.

## B2 rules: findings (2026-11-24)

Built to TECH-SPEC 8 with the `Rules` contract unchanged. These are details section 8 left open, decided in `src/server/rules/` and pinned by tests in `tests/rules/`, so B1 can rely on them.

- **Normalising.** Follows 8.1 literally, so `&` becomes `and` with no spaces added: "AT&T" is `atandt`, and "Rock&Roll" (`rockandroll`) does not match "Rock & Roll" (`rock and roll`). Tabs, newlines and other whitespace count as spaces. Hyphens are dropped, so "Spider-Man" is `spiderman`. An answer that normalises to nothing ("???") is never auto-marked correct.
- **Similarity** normalises both strings itself and counts code points; two empty strings are 1.
- **Review groups** (`groupText`) contain every answer passed in, grouped by normalised text, sorted by `nearest.similarity` descending, ties in the order received; groups with no accepted answer to compare go last. `display` is the first raw answer received.
- **Auto-marking.** A wrong answer type (for example a number for a choice question) or no value is `wrong`. Closest questions, and datetime questions set to `closest`, return `pending` from `autoMark`; the engine marks them with `markClosest` at the lock.
- **Datetime** values are read leniently: `1969-7-20`, `9:05` and `20:17:30` are accepted (seconds dropped). Invalid dates such as `2001-02-29` are `wrong`. Time distance does not wrap at midnight (23:50 to 00:10 is 1,420 minutes).
- **`markClosest`** uses the quiz's `closestScoring` for both closest-number and datetime-closest questions. A team in the map with no usable value is `wrong` and never counts as closest; teams not in the map are not in the result, so B1 marks missing answers `wrong` itself. Distances within 1e-9 count as equal. A spec that is not marked by closeness is auto-marked per value.
- **Sudden-death outcomes.** `SuddenDeathOutcome.order` lists the groups for that position best first, the way the helper in `tests/rules/standings.test.ts` (`playSuddenDeath`) builds it from `resolveSuddenDeath`: the winner, then the teams still tied for the next position, then teams that dropped out (later drop-outs above earlier ones). If the maximum is reached, the teams still in come first as one shared group. A shared group left by one outcome (for example 2nd place after a three-way tie) is decided by a separate outcome at that position, when the scope covers it.
- **Stale outcomes.** `rank` applies an outcome only when every team level at that position took part in it. If a mark change after sudden death (H-13) leaves different teams level there, the outcome is ignored and `suddenDeathNeeded` offers sudden death again.
- **Leaderboard line.** `tie_breaker` fires when the 1st-place row has `decidedBy: "tie_breaker"`, on every leaderboard where that holds (the copy picker already avoids repeating a line). `lead_change` fires when a team is in 1st that was not in 1st before, including a team catching a sole leader; a shared leader pulling clear is not a lead change. `close_race` needs at least two teams and a leader above 0 points, so an all-zero board gets no line. `big_climb` ignores teams that were not on the previous leaderboard. The first leaderboard (`before` null) can only get `tie_breaker` or `close_race`.

## Open questions

- **Licence.** Cas chose to decide later. Recommendation is AGPL-3.0 (see topic 9). Until a licence is added, the public repo is "all rights reserved" by default, so outsiders cannot legally reuse or contribute; settle it before inviting contributors and before `v1.0.0`.
- **Private pilot repo.** Recommendation is to drop it or keep it for venue data only, never a code fork (topic 9); Cas to confirm.
- **MVP = pilot or launch?** Cas has two milestones (pilot at `v1.0.0`, then product launch). Requirements should rank Pilot / Launch / Later / Won't, or define MVP as the pilot and list launch items separately.
- **How much is configurable for the pilot?** Cas answered "configurable" to many questions. Each option needs a sensible default so a non-technical host never touches settings, and Requirements should decide which options ship for the pilot and which stay fixed until later.
- **Host on the TV laptop or a separate device?** Analysed by Architecture (see above and TECH-SPEC 1.1): both work; laptop on HDMI is the pilot default.
- **"Members" vs "no account".** Reusing *members* across nights implies knowing individual players, while the brief says one device per team and no accounts. Decide before team history is designed (Later).
- **Defaults to confirm:** halftime after round 3; design target of 20 teams (working at 30); second phone joins as a viewer by default; definition of a "round win" for the tie rule.
- **Brief needs updating:** it says the repo "starts private" (it is public), lists a closest-guess tiebreaker (Cas chose right/wrong sudden death), and does not mention Quiz Start/End, prizes, sudden-death branding, spelling check or AI accuracy checks. The brief is raw material, so Requirements carries these forward rather than editing the brief.
