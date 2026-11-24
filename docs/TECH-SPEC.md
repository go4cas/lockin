# Lock-In: technical spec

This is how Lock-In is built. It turns [REQUIREMENTS.md](REQUIREMENTS.md) into a design that build threads can implement in parallel without colliding. Where this file and REQUIREMENTS.md differ on *what* the product does, REQUIREMENTS.md wins; this file decides *how*. The decisions behind it are in [NOTES.md](NOTES.md), and the visual design is in `docs/design/`.

Sections 5 to 11 are **contracts**. The TypeScript blocks in them are normative: B0 copies them into `src/shared/` and build threads code against them. Once this file is merged, a contract changes only with Cas's agreement (project rule), recorded in NOTES.md.

## Contents

1. Decisions on the open items
2. System overview
3. Stack and code rules
4. Runtime: one binary, hosted
5. Data folder and file formats
6. Data model (SQLite)
7. The night: state machine
8. Marking, scoring and positions
9. HTTP routes
10. WebSocket protocol
11. Reconnect, rejoin and moving a team
12. Security
13. Testing
14. Build plan (B0 to B9)
15. Open questions

---

## 1. Decisions on the open items

### 1.1 Host on the TV laptop or on a separate device (N3)

Three setups are realistic. All talk only to the server, so the software supports every one of them; the question is which one the console layout and the run sheet are designed around.

| | A. One laptop, HDMI to the TV | B. Laptop on HDMI plus a host tablet or phone | C. Host device only; display on its own browser or a cast |
|---|---|---|---|
| Devices for the host | 1 | 2 | 1 (plus the display) |
| How the display gets the picture | Laptop's second screen (extended display), display page full screen | Same as A | Smart-TV browser, or "Cast tab" from desktop Chrome to a Chromecast |
| Display reliability | Best: a normal desktop browser, wired | Best | Weakest: the TV's own browser may be older than the baseline (1.2), cast lag of 1 to 2 s, remote-control typing |
| Host mobility | Tied to the TV's cable | Free to walk the room | Free |
| Risk | **Mirrored display shows the console, and its answers, to the room.** Moving a window to the display and making it full screen is fiddly for staff | Two devices to keep charged and signed in | Display setup on the night depends on the TV model |
| Network | Laptop needs the server (internet) | Same | Display needs the server too |

**Decision:**

- **The pilot's recommended setup is A**, upgraded to **B** when the host wants to walk around. It avoids smart-TV quirks on night one, and the laptop is needed anyway.
- **The console layout is designed for a laptop first (1280 px and up) and works on a tablet (768 px and up).** A phone-sized console is not a target for `v1.0.0`.
- **The console assumes it is never on the display.** To cut the mirroring risk in setup A, the console has an **"Open display" button** that opens `/display` in a new window, and the run sheet (Release) shows how to set "extend" rather than "mirror" on Windows and macOS. Design may add a "hide answers" switch on the console; that would be a small scope addition, so it goes to Cas first (open question 15.2).
- **Several host devices can be signed in at once** (S-03). Commands are applied in the order the server receives them, and every console shows the same state.

### 1.2 Smart TVs and casting (T-01)

**Decided by Cas (2026-11-24): the display supports modern browsers only.** The display page is an ArrowJS page like the console and the phones (3.1), and its baseline is Chromium 86 / Safari 14 class engines (3.3). That is roughly smart TVs from 2022 onwards, plus any current desktop browser or Chromecast. Pubs with an older TV use a laptop over HDMI or a Chromecast instead. A vanilla fallback display page for older TVs is **not** planned for `v1.0.0`; it can be added later if users report displays that don't work (15.4).

Support has three tiers:

| Tier | Setups | What it means |
|---|---|---|
| **Supported, tested before `v1.0.0`** | A laptop over HDMI with current Chrome, Edge, Firefox or Safari. "Cast tab" from desktop Chrome to a Chromecast or Google TV. The smart-TV browser and the streaming or casting device at the pilot pub (Cas reports a modern TV; models to confirm, 15.1). | Checked by hand on real hardware (T-01). |
| **Targeted, not tested** | Smart-TV browsers at or above the baseline in 3.3 (roughly Samsung Tizen and LG webOS models from 2022 onwards; check the browser version, not the year), Android TV and Google TV browsers with Chromium 86 or newer, current Fire TV Silk browser, AirPlay or Miracast screen extension from a laptop (behaves like HDMI). | The code follows the baseline in 3.3, so these should work; bugs are fixed when reported. |
| **Not supported** | Smart-TV browsers older than the baseline (use a laptop or Chromecast instead), casting a browser tab to a Fire TV stick (not possible), anything that needs input on the display (T-22). | The display page says so in plain English instead of showing a blank screen (B6). |

The display page does not need casting software of its own: Cast tab mirrors a Chrome tab, so it inherits the 1 to 2 s lag that T-04 already allows for.

### 1.3 Platforms and local mode (S-01, S-02)

**Local mode is Later (Cas, 2026-11-23).** It does not hold up the pilot or the launch. Until then Lock-In is built for one platform, **Linux x64**, and runs only in hosted mode on a VPS. The design keeps local mode possible: the server is one process with no dependency on the VPS or Cloudflare, so adding it later is the extra work listed in 4.8, not a redesign.

### 1.4 Server restart during a night (S-05)

Confirmed, at low cost. Every state change is written to SQLite in the same step that applies it, before the client gets its acknowledgement (section 6.3). `bun:sqlite` is synchronous and in WAL mode a write takes well under a millisecond, so this is cheap even at 30 teams answering at once. On start, the server reloads any open night and carries on (section 7.6).

### 1.5 Home-screen install (P-10)

A full web-app install needs a secure context (HTTPS). Hosted mode has HTTPS through Cloudflare, so P-10 works as written. (Local mode, when it comes, would only get a home-screen shortcut; see 4.8.)

---

## 2. System overview

```
           ┌──────────────── one Lock-In process ────────────────┐
 phones ───┤ HTTP: pages, static files, theme, media, REST (host) │
 Display     ───┤ WebSocket /ws: hello → state views ← commands        ├── data folder
 host   ───┤ Night engine (in memory, written through to SQLite)  │   (files + lockin.db)
           └──────────────────────────────────────────────────────┘
```

- **One process** serves every page and the one WebSocket endpoint. No device talks to another device (S-26).
- **Server-authoritative.** The night engine holds the night's state in memory, writes every change through to SQLite, and pushes each connected client a **view** of the state for its role (host, display or team). Clients render the view they are given and send commands; they never compute scores or decide the lock.
- **Full views, not deltas.** After every change the server sends each client its whole current view. Views are small (a 30-team leaderboard is a few kilobytes), and it makes reconnecting trivial: a client that reconnects gets the current view and renders it.
- **Plain files** hold quizzes, the theme and venue settings (S-09). **SQLite** holds nights, teams, answers, marks, history and host sessions.

---

## 3. Stack and code rules

### 3.1 Stack

- **Server:** Bun (pinned in `package.json` `engines` and in CI; currently 1.4.x) and TypeScript. Built-ins only: `Bun.serve` (HTTP and WebSocket), `bun:sqlite`, `Bun.password` (argon2id), `node:os`, `node:fs`, `node:crypto`.
- **Runtime dependencies: none.** `package.json` has no `dependencies`. `devDependencies` are limited to `typescript` and `@types/bun`, used only for `bun run typecheck`. The vendored Arrow files (above) are the one agreed exception in the browser; adding or updating any third-party code is a contract change that needs Cas.
- **Browser:** [ArrowJS](https://arrow-js.com) core, `@arrow-js/core` 1.0.6 (MIT), for reactive templates on every page: host console, display and phones (agreed with Cas 2026-11-24). It is **vendored unchanged** in `public/vendor/arrow/` (version, source and checksums in its `vendor.json`), served from our own server and embedded in the binary: no CDN, no npm package, no import map. It is the only third-party browser code. Quiver and other Arrow add-ons are not used. CSS is vanilla CSS. **No bundler or transpiler for browser code**, so what is in `public/` is what runs.
- **Tests:** `bun test`. CI runs `bun run typecheck` and `bun test` on every PR.

### 3.2 Repository layout and ownership

Each build thread owns the paths marked for it. A thread changes another thread's paths only through a contract change agreed with Cas. Paths marked B0 are shared contracts: after B0 merges, they change only by agreement.

```
package.json, tsconfig.json, bunfig.toml        B0
.github/workflows/ci.yml                        B0
scripts/build.ts                                B0 (dev run), B8 (compile and packaging)
scripts/fixture-server.ts                       B0
src/shared/protocol.ts                          B0  contract: WS envelope, commands, views (section 10)
src/shared/formats.ts                           B0  contract: quiz, theme, venue file types and validators (section 5)
src/shared/rules-api.ts                         B0  contract: marking and scoring function signatures (section 8)
src/server/main.ts                              B0  CLI, wires modules together
src/server/config.ts                            B0
src/server/http.ts, static.ts                   B0  router and static files
src/server/ws.ts                                B0  socket hub, hello, ping, auth of roles
src/server/auth.ts                              B0  host password, sessions, setup code
src/server/db.ts, src/server/migrations/        B0  schema (section 6); new tables need agreement
src/server/night/                               B1  engine, commands, views, persistence, history API
src/server/rules/                               B2  pure marking, scoring, positions
src/server/quizzes/                             B3  quiz store, media store, quiz REST
src/server/branding/                            B4  theme, venue settings, /theme.css, copy pools
src/server/qr/                                  B8  QR code encoder and /qr routes
public/shared/                                  B0  ws-client.js, clock.js, base.css, view helpers
public/host/index.html, host.css, nav           B0  console shell, login and setup pages
public/host/build/                              B3  library and builder
public/host/brand/                              B4  branding, venue and holding-page settings
public/host/run/, public/host/history/          B5  run the night, history list
public/display/                                      B6
public/phone/                                   B7  phone pages, manifest, service worker, install guide
public/vendor/                                  contract: vendored third-party browser code (ArrowJS, 3.1); changes only with Cas's agreement
tests/fixtures/views/                           B0  sample views per role and phase (section 13.2)
tests/<module>/                                 owned by the module's thread
tests/load/, tests/e2e/                         B9
```

Each server module exposes one `register(app: App)` function from its `index.ts`. B0 creates every module folder with an empty `register`, and `main.ts` already calls all of them, so no build thread edits `main.ts`.

### 3.3 Browser baselines

| Page | Must run on | So it may use |
|---|---|---|
| **Display** (`public/display/`, plus `public/shared/` and `public/vendor/`, which the display loads) | Chromium 86 and Safari 14 class engines: roughly smart TVs from 2022 onwards, Chromecast with Google TV, any current desktop browser (1.2) | **JS:** ES modules (`<script type="module">`, `import`/`export`, dynamic `import()`), `async`/`await`, `?.`, `??`, `??=`/`\|\|=`/`&&=`, object and array spread, classes without fields. **Not:** class fields or `#private`, top-level `await`, import maps, `.at()`, `structuredClone()`, `Object.hasOwn()`, `.findLast()`, `.toSorted()`/`.toReversed()`/`.toSpliced()`, `WeakRef`, regex lookbehind. **CSS:** grid (spaced with `grid-gap`), flexbox (spaced with margins), custom properties, `calc()`, `clamp()`/`min()`/`max()`, `vw`/`vh`, transforms, transitions, `@keyframes`, `conic-gradient()`, `@font-face` (WOFF2). **Not:** `gap`/`row-gap`/`column-gap` (flexbox `gap` is Safari 14.1), `aspect-ratio`, `:is()`/`:where()`/`:has()`, `:focus-visible`, `backdrop-filter`, `color-mix()`/`oklch()`/`lab()`, the `inset` shorthand, `@container`/`@layer`, `dvh`/`svh`/`lvh`. |
| **Phone** | Current and previous major Safari on iOS and Chrome on Android (P-01) | Modern JS (ES2022, modules) and CSS. Files from `public/shared/` and `public/vendor/` must still follow the display rules. |
| **Host console** | Current Chrome, Edge, Firefox and Safari on laptops; Safari and Chrome on tablets | Modern JS and CSS. |

A test (`tests/browser-baseline.test.ts`, B0) scans `public/display/`, `public/shared/` and `public/vendor/` for the banned JS and CSS above and fails the build if it finds any. The same test checks that no page code in `public/` (outside `public/vendor/`) uses an HTML sink such as `innerHTML` (12.4). `docs/design/tools/tokens.test.ts` runs the same CSS scanner on the display wireframe CSS.

Browser files may use JSDoc types with `// @ts-check` and `import('../../src/shared/protocol').DisplayView` style typedefs; they are type-checked by `bun run typecheck` but served unchanged. `tsconfig.json` maps `/vendor/*` to `public/vendor/*`, so `import { html } from "/vendor/arrow/index.mjs"` type-checks as written.

### 3.4 Front-end pattern (ArrowJS)

Every page follows the same pattern, so the console, display and phone code read alike. The server stays authoritative (2): Arrow only draws the view it is given and keeps the page's own short-lived UI state.

- **Pages are ES modules** that import Arrow by absolute path: `import { html, reactive, watch, component } from "/vendor/arrow/index.mjs"`. Import maps are not used (the display baseline does not have them).
- **The shared classic scripts stay as they are.** A page loads `public/shared/ws-client.js` and `clock.js` with plain `<script>` tags before its module and uses `window.LockIn` (B0). They keep `seq` ordering, reconnects and the clock; Arrow is not loaded by `public/shared/`. `view.js` helpers (`countdown`, `joinNames`, `teamColour`) are still used; its `el()`/`replace()` DOM helpers are not needed in Arrow pages.
- **One view store per page.** `const page = reactive({ view: null, status: "connecting" })`. The client's state callback does `page.view = view` with the whole view; Arrow redraws only what changed.
- **Live slots are functions.** Anything that comes from the view is written `${() => page.view.round.title}`. A bare `${value}` renders once and never updates, so it is only for constants.
- **Lists are keyed by stable ids** with `.key()` (team id, question id, round id, group id), so leaderboard rows, team lists and answer groups move instead of being rebuilt, and the display's leaderboard re-order animation works on the same nodes.
- **Local UI state lives in its own store, never inside `page.view`.** A typed answer, an open dialog, the builder's draft quiz and the branding page's unsaved colours sit in a separate `reactive()` object, so a new view from the server never clears what someone is typing or moves focus.
- **Reusable pieces are `component()`s** (countdown, answer inputs, leaderboard row, team chip), kept in the owning page's folder. A piece that two roles need goes to its own module under that role's folder and is shared by import, never copied.
- **Side effects use `watch()`**: playing a sound, starting a flash, scheduling the timer tick.
- **Text is data, never markup** (12.4). Arrow puts every `${}` value into a text node or an attribute value. Templates are always tagged template literals written in the source; data is never concatenated into a template or passed to an HTML sink. URLs in `href`/`src` come from the server's own routes, never from team input.
- **No business logic in the browser.** Pages never compute scores, marks, positions or the lock; they send commands and render views.

---

## 4. Runtime: one binary, hosted

### 4.1 Commands

The one executable, `lockin`, takes an optional subcommand:

| Command | What it does |
|---|---|
| `lockin` or `lockin serve` | Starts the server (what systemd runs on the VPS). |
| `lockin reset-password` | Removes the host password and prints a new setup code (S-03). |
| `lockin setup-code` | Prints the current setup code if no password is set. |
| `lockin --version` | Prints the version. |

### 4.2 Configuration

Precedence: command-line flag, then environment variable, then `config.json` in the data folder, then the default. The Release thread's systemd unit sets them; hosts never touch them.

| Key | Flag / env | Default | Notes |
|---|---|---|---|
| `dataDir` | `--data` / `LOCKIN_DATA` | `./lockin-data` | systemd sets `/var/lib/lockin` |
| `port` | `--port` / `LOCKIN_PORT` | 8080 | |
| `bind` | `--bind` / `LOCKIN_BIND` | `127.0.0.1` | Only the Cloudflare tunnel on the same machine connects |
| `publicUrl` | `--public-url` / `LOCKIN_PUBLIC_URL` | required | For example `https://quiz.example.com`. Used for QR codes, join links and the display address. The server refuses to start without it. |

`config.json` holds only these keys. It never holds secrets. (A `mode` key is reserved for local mode, 4.8.)

### 4.3 Data folder

- Set by `--data`, normally `/var/lib/lockin/` on the VPS.
- The host console's settings page shows the data folder's path. Moving Lock-In to another server is: install the binary, copy this folder, point the Cloudflare tunnel at the new server (RELEASE.md).

### 4.4 Start-up sequence

1. Read config, create the data folder and its subfolders if missing, open `lockin.db`, run migrations.
2. Load the theme, venue settings and the quiz list. A file that fails validation is reported in the log and on the console (quiz marked "not ready"); it never stops the server.
3. Reload an open night if there is one (7.6).
4. Start listening.
5. Log the public URL and, if no host password is set, the setup code.

### 4.5 Behind Cloudflare

- `cloudflared` on the same VPS forwards the public hostname to `127.0.0.1:<port>`. Cloudflare provides HTTPS and WSS.
- The client's IP for rate limits comes from `CF-Connecting-IP`.
- Cloudflare closes idle WebSockets after 100 s, so clients ping every 25 s (10.6).
- Static files get `Cache-Control: no-cache` with ETags, so Cloudflare and browsers never serve a stale app after an update.

### 4.6 Packaging

- `bun run build` (B8) runs `bun build --compile --target=bun-linux-x64`, producing `dist/lockin-linux-x64`.
- Everything in `public/` (including the vendored Arrow in `public/vendor/`; `.mjs` files are served as `text/javascript`, which module scripts require), `docs/brand/copy.en.json`, `docs/design/tokens.css`, bundled fonts and the default theme assets are **embedded in the binary** through a generated `src/server/embedded.ts` (a map from URL path to a file imported `with { type: "file" }`). In development (`bun run dev`) the same paths are served from disk.

### 4.7 Development

`bun run dev` starts the server from source with `--public-url http://localhost:8080` and `--bind 127.0.0.1`, serving `public/` from disk. To try phones on a laptop's Wi-Fi during development, run it with `--bind 0.0.0.0 --public-url http://<laptop address>:8080`.

### 4.8 Local mode (Later, S-02)

Not built until it is ranked again. Kept here so the work is known when it is:

- `--mode local`: bind `0.0.0.0`; `publicUrl` from the laptop's LAN address (private IPv4 on a physical interface, skipping loopback, link-local and virtual adapters; the host picks if there are several; a plain-English problem if there is none); open the browser at `/host`; a second launch opens the running one; data folder in the OS app-data folder.
- Builds for Windows x64 and macOS arm64, a macOS `.app` wrapper, a titled Windows console window.
- Setup from the laptop itself (loopback) may skip the setup code.
- Known costs: unsigned apps warn on first open (macOS Gatekeeper, Windows SmartScreen) unless signed, which costs money every year; the first run asks for firewall permission; guest Wi-Fi isolation and phones on mobile data cannot reach a laptop; phones get only a home-screen shortcut over plain HTTP.

---

## 5. Data folder and file formats

### 5.1 Layout

```
<dataDir>/
  config.json                  runtime config (4.2)
  auth.json                    host password hash (12.1); never in the repo
  lockin.db                    SQLite: nights, teams, answers, history, sessions
  venue.json                   venue settings (5.4)
  theme/
    theme.json                 venue theme (5.3)
    assets/                    logo, display background, uploaded fonts
  quizzes/
    <quizId>/
      quiz.json                the quiz (5.2)
      media/                   question images
  backups/                     written by the Release thread's backup script
```

All JSON files are written **atomically** (write to `<name>.tmp`, then rename) with two-space indentation and keys in a fixed order, so they diff cleanly in git. Copying a quiz folder into another Lock-In's `quizzes/` folder makes it appear in that library (S-09); the library rescans the folder each time it is listed.

### 5.2 Quiz file: `quizzes/<quizId>/quiz.json`

`quizId` is the folder name: lower-case letters, digits and hyphens, 1 to 60 characters, made from the title when the quiz is created (`friday-classics`, then `friday-classics-2` if taken). Renaming a quiz changes its title, not its folder.

```ts
// src/shared/formats.ts (contract)
export interface QuizFile {
  format: "lockin.quiz/1";
  id: string;                      // equals the folder name
  title: string;                   // 1..80 chars
  updatedAt: string;               // ISO 8601, set by the server on every save
  settings: QuizSettings;
  rounds: Round[];                 // 1..20
  suddenDeath: Question[];         // 0..20; answer types "text", "choice" or "closest" only (H-14)
}

export interface QuizSettings {
  lockMode: "question" | "round";              // default "question"
  timerSeconds: number;                        // 10..300, default 60
  halftimeAfterRound: "auto" | "none" | number; // default "auto" = after round ceil(rounds/2); number is 1-based
  joker: boolean;                              // default false
  maxTeams: number;                            // 2..30, default 30
  suddenDeathScope: "first" | "all";           // default "first"
  suddenDeathMax: number;                      // 1..10, default 3
  closestScoring: "closest" | "range";         // default "closest"
}

export interface Round {
  id: string;                      // "r-" + 8 chars [a-z0-9], stable for the quiz's life
  title: string;                   // 0..60 chars
  questions: Question[];           // 1..30
}

export interface Question {
  id: string;                      // "q-" + 8 chars [a-z0-9], stable across reordering
  text: string;                    // 1..300 chars
  note?: string;                   // host-only, 0..300 chars
  timerSeconds?: number;           // 10..300, overrides settings.timerSeconds
  media?: Media;
  answer: AnswerSpec;
}

export type Media =
  | { kind: "image"; file: string; alt?: string };   // file is relative to media/, e.g. "q-ab12cd34.jpg"
  // Launch adds { kind: "audio" | "video"; file: string } (H-24, H-25)

export type AnswerSpec =
  | { type: "text"; accepted: string[] }             // 1+; accepted[0] is the answer shown at reveal
  | { type: "choice"; options: string[]; correct: number }   // 2..6 options; correct is a 0-based index
  | { type: "number"; value: number }
  | { type: "closest"; value: number; range?: number }      // range used when closestScoring = "range"
  | { type: "datetime"; precision: "year" | "date" | "time";
      value: string;                                 // "1969" | "1969-07-20" | "20:17"
      scoring: "exact" | "closest"; range?: number }; // range in years, days or minutes by precision
```

Rules:

- **Readiness (H-01).** A quiz is ready when it validates, has at least one round, every round has at least one question, every question has text and a complete answer, and every media file exists. `validateQuiz(json)` returns `{ ok: true, quiz } | { ok: false, problems: { path: string; message: string }[] }`; messages are plain English ("Round 2, question 4 has no answer").
- **Forward compatibility.** An unknown `media.kind` or `answer.type` makes the quiz "not ready" with a message naming it; it never crashes the server. A breaking change bumps `format` to `lockin.quiz/2` and the server reads both.
- **Images (H-03).** The builder resizes images **in the browser** (canvas) to at most 1920×1080 and re-encodes them as JPEG (quality 0.85) or keeps PNG when the image has transparency, so the server needs no image library. The server checks the file's first bytes (JPEG, PNG or WebP), caps uploads at 5 MB, and names the file after the question id plus a short content hash (`q-ab12cd34-9f3a.jpg`).
- **Accepted answers added while marking (H-10)** are appended to `accepted` in the quiz file and in the running night's snapshot.

### 5.3 Theme file: `theme/theme.json`

The theme file stores the venue's **branding inputs**, not raw CSS. Design defines the inputs and how they expand into CSS custom properties (`docs/design/branding.md`, `docs/design/tokens.css`). Every field is optional; `null` or a missing field means "use the default theme".

```ts
// src/shared/formats.ts (contract)
export interface ThemeFile {
  format: "lockin.theme/1";
  name: string | null;                         // venue name, fills {pub}; 1..60 chars
  logo: string | null;                         // "assets/<file>", PNG, SVG or JPEG, <= 2 MB
  colours: {
    background: Hex | null;
    text: Hex | null;
    accent: Hex | null;
    accent2: Hex | null;
  };
  fonts: { display: FontRef | null; body: FontRef | null };
  displayBackground: { colour: Hex } | { image: string } | null;   // image: "assets/<file>", JPEG/PNG/WebP <= 5 MB
  copy: Record<string, { mode: "replace" | "add"; lines: string[] }>;  // key = copy pool key
}
export type Hex = string;                      // "#rrggbb", sRGB
export type FontRef = { bundled: string }      // display: "caveat-brush" (default), "alfa-slab-one", "bebas-neue",
                                               //   "atkinson-hyperlegible"; body: "atkinson-hyperlegible" (default)
                    | { file: string };        // "assets/<file>", WOFF2, WOFF or TTF <= 2 MB
```

- **`GET /theme.css`** is generated from the theme file: resolved `--brand-*` custom properties (derived colours such as surfaces, muted text, text-on-accent and lines are computed on the server as sRGB mixes using Design's formulas, because old TV engines have no `color-mix()`) and `@font-face` rules for uploaded fonts. Pages load `/static/shared/tokens.css` (the default theme) and then `/theme.css` on top.
- Theme asset files are served from `/theme/assets/<file>`. Bundled fonts are the WOFF2 files in `docs/design/fonts/` (OFL licensed, licences shipped alongside), embedded in the binary and served from `/static/fonts/<id>.woff2`.
- Every view carries `venue.themeVersion` (a hash of `theme.json`); when it changes, pages reload `/theme.css?v=<version>` (H-16 "from the next screen they show").
- Readability warnings (H-16) are computed on the branding screen with the contrast rules in `docs/design/`.
- Theme export and import (H-22, Launch) will zip `theme/`; nothing in the format stops that.

### 5.4 Venue settings: `venue.json`

```ts
// src/shared/formats.ts (contract)
export interface VenueFile {
  format: "lockin.venue/1";
  prizes: Prize[];                             // default prizes for new nights; default []
  holding: {
    minutesBefore: number;                     // 0..120, default 30
    panels: HoldingPanel[];                    // shown in this order; default all six
  };
}
export interface Prize { place: number; text: string }   // place 1.., text 1..80 chars
export type HoldingPanel = "countdown" | "teams" | "join" | "install" | "animation" | "prizes";
```

Unknown panel names are ignored, so more panels can be added later (H-17).

### 5.5 Copy pools

- The default pools are `docs/brand/copy.en.json` (embedded in the binary). The theme's `copy` replaces or adds to any pool by key.
- The engine asks for lines by **pool key**. Keys used by the engine (Design's copy review, `docs/design/copy-review.md`): `lobby`, `team_joined`, `round_start`, `last_seconds`, `locked`, `all_locked`, `no_answer`, `joker_played`, `reveal`, `lead_change`, `big_climb`, `close_race`, `halftime`, `tie_breaker`, `sudden_death`, `sudden_death_again` (everyone right or everyone wrong, next question follows), `sudden_death_won` (`{team}` took the place), `sudden_death_shared` (still tied after the maximum), `winner`, `winner_shared` (`{team}` is the names joined as "A, B and C"), `last_place`, `goodbye`. The old `tiebreak` pool is gone. A missing pool gives no line (the screen shows without one).
- **Selection rules:** a line containing `{n}` is skipped when `n < 2`. A leaderboard shows at most one line, chosen in this order: `tie_breaker` (only when the tie breaker decided 1st place), `lead_change` (1st place changed hands), `close_race` (top two within 1 point), `big_climb` (a team rose 3 or more places since the last leaderboard).
- Lines are picked on the server (B4's `CopyPicker`, section 8.6), so the display and phones agree and "never the same line twice in a row" holds per pool for the whole night.

---

## 6. Data model (SQLite)

### 6.1 Principles

- Quizzes, the theme and venue settings live in files (section 5). The database holds what happens on nights, plus host sessions.
- **History from night one (S-08):** nothing about a night is deleted. A night keeps a full **snapshot of the quiz** as it was used (including accepted answers added while marking), so history stays readable even if the quiz file is later edited or deleted.
- No personal data: a team is a name, a colour and a device token (S-08).
- Times are integers, milliseconds since the Unix epoch, from the server's clock.

### 6.2 Schema (migration `001_init.sql`, contract)

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);       -- schema_version

CREATE TABLE nights (
  id            TEXT PRIMARY KEY,          -- "n-" + YYYYMMDD-HHMM + "-" + 4 chars
  quiz_id       TEXT NOT NULL,
  quiz_title    TEXT NOT NULL,
  quiz_snapshot TEXT NOT NULL,             -- QuizFile JSON as used, updated when answers are accepted
  room_code     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','ended')),
  opened_at     INTEGER NOT NULL,
  planned_start INTEGER,                   -- nullable
  started_at    INTEGER,                   -- Quiz Start
  ended_at      INTEGER,                   -- Quiz End
  end_reason    TEXT CHECK (end_reason IN ('finished','early')),
  prizes        TEXT NOT NULL DEFAULT '[]',-- Prize[] JSON for this night
  state         TEXT NOT NULL              -- EngineState JSON (7.5), rewritten on every change
);
CREATE UNIQUE INDEX one_open_night ON nights(status) WHERE status = 'open';

CREATE TABLE teams (
  id           TEXT PRIMARY KEY,           -- "t-" + 8 chars
  night_id     TEXT NOT NULL REFERENCES nights(id),
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL,              -- lower-cased, trimmed, for uniqueness
  colour       INTEGER NOT NULL,           -- index into the theme's team colours (1-based)
  token_hash   TEXT,                       -- SHA-256 of the current device token; NULL while being moved
  rejoin_code  TEXT NOT NULL,
  joker_round  INTEGER,                    -- 0-based round index, NULL if not played
  joined_at    INTEGER NOT NULL,
  removed_at   INTEGER,                    -- removed before Quiz Start (H-06)
  UNIQUE (night_id, name_key),
  UNIQUE (night_id, rejoin_code)
);

CREATE TABLE answers (                     -- one row per team per question that has an answer or a mark
  night_id     TEXT NOT NULL REFERENCES nights(id),
  team_id      TEXT NOT NULL REFERENCES teams(id),
  question_id  TEXT NOT NULL,              -- a round question or a sudden-death question
  value        TEXT,                       -- AnswerValue JSON; NULL if the host marked a team that sent nothing
  received_at  INTEGER,                    -- server time of the last accepted submission
  changes      INTEGER NOT NULL DEFAULT 0, -- how many times the team changed it
  mark         TEXT NOT NULL DEFAULT 'pending' CHECK (mark IN ('pending','correct','wrong')),
  marked_by    TEXT CHECK (marked_by IN ('auto','host')),
  marked_at    INTEGER,
  PRIMARY KEY (night_id, team_id, question_id)
);

CREATE TABLE mark_changes (                -- every host change after the first mark (H-13)
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  night_id     TEXT NOT NULL, team_id TEXT NOT NULL, question_id TEXT NOT NULL,
  from_mark    TEXT NOT NULL, to_mark TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE sudden_deaths (               -- one row per sudden-death question asked
  night_id     TEXT NOT NULL REFERENCES nights(id),
  seq          INTEGER NOT NULL,           -- 1.. across the night
  position     INTEGER NOT NULL,           -- the position being decided
  team_ids     TEXT NOT NULL,              -- JSON array of teams in it for this question
  question_id  TEXT NOT NULL,
  right_ids    TEXT,                       -- JSON array, set at reveal
  PRIMARY KEY (night_id, seq)
);

CREATE TABLE results (                     -- written at Quiz End (S-08)
  night_id     TEXT NOT NULL REFERENCES nights(id),
  team_id      TEXT NOT NULL REFERENCES teams(id),
  position     INTEGER NOT NULL,
  shared       INTEGER NOT NULL,           -- 1 if the position is shared
  total        INTEGER NOT NULL,
  round_scores TEXT NOT NULL,              -- JSON number[] per round, joker applied
  round_wins   INTEGER NOT NULL,
  decided_by   TEXT NOT NULL CHECK (decided_by IN ('points','tie_breaker','sudden_death','shared')),
  PRIMARY KEY (night_id, team_id)
);

CREATE TABLE host_sessions (
  token_hash   TEXT PRIMARY KEY,           -- SHA-256 of the cookie value
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
```

Only the latest answer per team per question is kept (with a change count); the history needs "every answer and mark", not every keystroke. A rejected late answer is not stored.

### 6.3 Write-through

Every command that changes a night runs as one SQLite transaction (state row plus any team, answer or mark rows) **before** the acknowledgement and the new views go out. If the write fails, the command fails and memory is rolled back to the last written state. The database runs with `journal_mode=WAL` and `synchronous=NORMAL`.

---

## 7. The night: state machine

### 7.1 Phases

```ts
// src/shared/protocol.ts (contract)
export type Phase =
  | "idle"          // no night open (the display shows the venue's waiting screen)
  | "lobby"         // night open, before Quiz Start; holding page is a lobby sub-state (7.4)
  | "round_intro"   // round N is next; jokers can be played on it
  | "asking"        // round N's questions are being shown, answered and locked
  | "marking"       // round N is locked; host finishing marks
  | "reveal"        // round N's answers revealed one by one
  | "leaderboard"   // standings after round N
  | "halftime"      // break after the halftime round
  | "sudden_death"  // after the last round, deciding tied positions
  | "ended";        // Quiz End: winner, standings, goodbye
```

```
idle ─night.open─▶ lobby ─quiz.start─▶ round_intro ─round.start─▶ asking ─round.finish─▶ marking
                                            ▲                                   (all marked)│
                                            │                       reveal.start ◀──────────┤
                          round.next ───────┤                            │ reveal.next…     │ leaderboard.show
                                            │                            ▼                  ▼
                   halftime ◀─round.next── leaderboard ◀─────────────────┴──────────────────┘
                      └──round.next──▶ round_intro
leaderboard (last round) ─sd.start─▶ sudden_death ─quiz.end─▶ ended ─night.close─▶ idle
leaderboard (last round) ─quiz.end─▶ ended
any phase after lobby ─quiz.end {early:true}─▶ ended
```

### 7.2 Commands

All commands go over the WebSocket as `{ t: "cmd", id, name, args }` (section 10). The engine rejects a command that is not allowed in the current phase with `wrong_phase`. "Host" commands need a host connection.

| Command | Args | Allowed in | Effect |
|---|---|---|---|
| **Host** | | | |
| `night.open` | `{ quizId, plannedStart?: number \| null, prizes?: Prize[] }` | idle | Snapshots a ready quiz, creates the night and a room code, goes to lobby. Prizes default to `venue.json`. |
| `night.update` | `{ plannedStart?: number \| null, prizes?: Prize[] }` | lobby to ended | Changes the planned start or the night's prizes. |
| `quiz.start` | `{}` | lobby, needs at least 1 team | Closes joining for new teams, goes to round_intro for round 0. |
| `round.start` | `{}` | round_intro | Locks in jokers for this round, goes to asking with no question shown. |
| `question.next` | `{}` | asking | Shows the round's next question. Per-question mode: only when the previous question is locked. Per-round mode: earlier questions stay open. |
| `timer.start` | `{}` | asking, sudden_death | Per-question: starts the current question's timer. Per-round: only after the last question is shown; starts the round timer (quiz `timerSeconds`). |
| `timer.pause` / `timer.resume` | `{}` | while a timer runs / is paused | H-08 |
| `timer.add` | `{ seconds: 15 }` | while a timer runs or is paused | Adds 15 s (the only value in `v1.0.0`). |
| `lock` | `{}` | asking, sudden_death | Locks now: the current question (per-question) or every open question (per-round, and only after the last is shown). Same as the timer running out. |
| `round.finish` | `{}` | asking, every question shown and locked | Goes to marking. |
| `mark.group` | `{ questionId, key, mark: "correct" \| "wrong" }` | asking (locked questions), marking, and later until ended | Marks every team whose normalised answer is `key`. For "correct" on a text question, adds the group's display answer to the accepted answers (snapshot and quiz file). |
| `mark.team` | `{ questionId, teamId, mark: "correct" \| "wrong" }` | as above | Marks one team; after the first mark this is a dispute change and is logged (H-13). |
| `reveal.start` | `{}` | marking, nothing pending | Goes to reveal at question 0. |
| `reveal.next` | `{}` | reveal | Shows the next answer, or the leaderboard after the last. |
| `leaderboard.show` | `{}` | marking (nothing pending), reveal | Skips the rest of the reveal (H-11). |
| `round.next` | `{}` | leaderboard (not last round), halftime | To halftime if this was the halftime round and it has not been shown, else to round_intro of the next round. |
| `sd.start` | `{}` | leaderboard of the last round, when sudden death is needed | Goes to sudden_death for the highest tied position that needs it. |
| `sd.ask` | `{}` | sudden_death, between questions | Shows the next sudden-death question to the teams still in it. |
| `sd.reveal` | `{}` | sudden_death, question locked and marked | Shows who was right and applies 8.5. |
| `quiz.end` | `{ early?: boolean }` | leaderboard of last round, sudden_death between questions; any phase from round_intro on with `early: true` | Computes final results, writes `results`, status `ended`, goes to ended. |
| `night.close` | `{}` | ended; lobby (discards a night with no Quiz Start, after confirming on the console) | Goes to idle and hands the display back. A lobby night that is closed is kept with `end_reason = 'early'` and no results. |
| `team.rename` | `{ teamId, name }` | lobby to ended | H-06 |
| `team.remove` | `{ teamId }` | lobby | H-06 |
| `team.moveCode` | `{ teamId }` | lobby to ended | Returns `{ code, url }` for moving the team to a new phone (11.3). |
| **Team** | | | |
| `team.join` | `{ roomCode, name }` | lobby | Creates the team; returns `{ teamId, token }` (11.1). |
| `team.rejoin` | `{ code }` | lobby to ended | A rejoin code or a move code; returns `{ teamId, token }` (11.2). |
| `joker.play` | `{ round }` | lobby (round 0), round_intro, leaderboard, halftime | Only on the upcoming round, once per night, when the quiz has the joker on (P-04). |
| `answer.submit` | `{ questionId, value: AnswerValue }` | asking, sudden_death | Accepted only if the question is open and server time is before `locksAt` (S-04). |

### 7.3 Timer and the strict lock (S-04)

- A timer is `{ state: "idle" | "running" | "paused" | "done", durationMs, locksAt, remainingMs }`. Running: `locksAt` is a server time. Paused: `remainingMs` holds what is left and `locksAt` is null.
- The engine schedules the lock for `locksAt` and also checks every `answer.submit` against it: **an answer is accepted only if `now() < locksAt`**, so an answer that arrives between `locksAt` and the scheduled lock firing is rejected with `too_late`. Nothing the client sends affects the check.
- A question with no timer started stays open until the host starts the timer or presses `lock`.
- The engine schedules a `last_seconds` line at `locksAt - 10 s`.
- The engine takes a `Clock` (`now()`) and a `Scheduler` (`at(time, fn)`, `cancel`) so tests run on fake time (13.1).

### 7.4 Lobby and holding page

The lobby has a sub-state the clients work out from the view: `holdingFrom = plannedStart - venue.holding.minutesBefore` minutes. Before `holdingFrom` (or with no planned start) the display shows the plain lobby (T-02); from `holdingFrom` until Quiz Start it shows the holding page (T-12). The countdown uses the client's server-time offset (10.6). A night opened after `holdingFrom` goes straight to the holding page.

### 7.5 Engine state (persisted in `nights.state`)

```ts
// src/server/night/state.ts (owned by B1; shape below is binding for persistence)
interface EngineState {
  phase: Phase;
  round: number;                    // 0-based current or upcoming round
  shown: number;                    // questions shown in this round so far
  questions: Record<string, { status: "hidden" | "open" | "locked"; openedAt?: number; lockedAt?: number }>;
  timer: TimerState;
  revealIndex: number;
  halftimeShown: boolean;
  sd: null | {
    position: number;               // position being decided
    teamIds: string[];              // still in it
    asked: number;                  // questions asked for this position
    nextQuestion: number;           // index into quiz.suddenDeath across the night
    current: null | { questionId: string; status: "open" | "locked" | "revealed" };
    decided: { position: number; teamIds: string[]; outcome: "won" | "shared" }[];
  };
  copyLast: Record<string, number>; // last line index per pool (no repeats)
  lines: Record<string, Line | null>; // current line per screen slot (10.4)
  flash: Flash | null;
  seq: number;                      // increases on every change
}
```

### 7.6 Restart recovery

On start, if a night has `status = 'open'`, the engine loads its `state`, teams and answers. If a timer was running and `locksAt` has passed, the question locks at once: answers stored before the crash count, nothing after `locksAt` was ever accepted. If it has not passed, the lock is rescheduled. Clients reconnect on their own (section 11) and get current views.

---

## 8. Marking, scoring and positions

These are **pure functions** in `src/server/rules/` (B2), with the signatures fixed in `src/shared/rules-api.ts` (B0). The engine (B1) calls them through that interface and its tests may pass fakes.

```ts
// src/shared/rules-api.ts (contract)
export type AnswerValue =
  | { type: "text"; text: string }          // 1..100 chars after trim
  | { type: "choice"; index: number }
  | { type: "number"; value: number }       // used by "number" and "closest"
  | { type: "datetime"; value: string };    // same shape as the spec's value

export type Mark = "pending" | "correct" | "wrong";

export interface Rules {
  normalise(text: string): string;
  similarity(a: string, b: string): number;                    // 0..1
  autoMark(spec: AnswerSpec, value: AnswerValue): Mark;        // all types except closest scoring
  markClosest(spec: AnswerSpec, values: Map<string, AnswerValue>,
              scoring: "closest" | "range"): Map<string, Mark>; // teamId -> mark
  groupText(spec: AnswerSpec & { type: "text" },
            answers: { teamId: string; text: string; mark: Mark }[]): AnswerGroup[];
  score(input: ScoreInput): ScoreResult;
  rank(score: ScoreResult, sd: SuddenDeathOutcome[]): StandingRow[];
  suddenDeathNeeded(rows: StandingRow[], scope: "first" | "all",
                    done: SuddenDeathOutcome[]): { position: number; teamIds: string[] } | null;
  resolveSuddenDeath(teamIds: string[], rightIds: string[]):
    { winner: string | null; remaining: string[] };
  leaderboardLine(before: StandingRow[] | null, after: StandingRow[]):
    "tie_breaker" | "lead_change" | "close_race" | "big_climb" | null;   // priority order in 5.5
}

export interface AnswerGroup {
  key: string;                    // normalised text
  display: string;                // the first raw answer received in the group
  teamIds: string[];
  mark: Mark;                     // pending if the teams in it differ
  nearest: { accepted: string; similarity: number } | null;
}
export interface ScoreInput {
  rounds: { questionIds: string[] }[];
  teams: { id: string; jokerRound: number | null }[];
  correct: Set<string>;           // `${teamId}:${questionId}` marked correct
}
export interface ScoreResult {
  teams: { id: string; roundScores: number[]; total: number; roundWins: number }[];
}
export interface StandingRow {
  teamId: string; position: number; shared: boolean; total: number;
  roundScores: number[]; roundWins: number;
  decidedBy: "points" | "tie_breaker" | "sudden_death" | "shared";
}
export interface SuddenDeathOutcome { position: number; order: string[][] }   // groups, best first
```

### 8.1 Normalising typed answers (H-10)

In order: Unicode NFKD and drop combining marks (accents); lower-case; replace `&` with `and`; drop every character that is not a letter, digit or space; collapse runs of spaces; trim; remove one leading `the `, `a ` or `an `. So `"J.F.K."` and `"jfk"` both become `jfk`, and `"The Beatles"` becomes `beatles`.

### 8.2 Auto-marking

| Type | Rule |
|---|---|
| text | `correct` if the normalised answer equals a normalised accepted answer; otherwise `pending` (never auto-`wrong`) |
| choice | `correct` if the index matches, else `wrong` |
| number | `correct` if `abs(a - value) < 1e-9`, else `wrong` |
| datetime, exact | `correct` if the strings are equal after normalising (`YYYY`, `YYYY-MM-DD`, `HH:MM`), else `wrong` |
| closest; datetime with closest | `markClosest` at the lock (needs every team's answer): distance is the absolute difference (years, days or minutes for datetime). `closest`: every team at the smallest distance is `correct`, the rest `wrong`. `range`: every team with distance ≤ `range` is `correct` (a missing range counts as 0). |
| no answer | `wrong` |

Marking runs when a question locks. Text answers that stay `pending` go to the review queue as groups (`groupText`), ordered by `nearest.similarity` descending, so close matches come first. Similarity is `1 - distance / max(length)` with optimal string alignment (Damerau-Levenshtein) distance on normalised strings. Fuzzy matches are only suggestions; they are never marked correct without the host.

After `mark.group` with `correct`, the group's `display` is added to `accepted`, and any other pending answers on that question whose normalised form now matches are marked too.

### 8.3 Scoring (S-06)

- Points for a team in a round = number of its correct answers in that round, ×2 if `jokerRound` is that round.
- Total = sum of round points. Sudden-death questions never add points.
- **Round win:** the team or teams with the highest points in that round, **if that score is above 0**. (REQUIREMENTS defines a round win as the top score; this spec adds that a round where everyone scores 0 has no winner, so it cannot decide a tie.)

### 8.4 Positions and the tie breaker (S-07)

1. Sort by total, highest first.
2. Teams level on total are ordered by round wins, highest first; a team placed by this has `decidedBy: "tie_breaker"`.
3. Teams still level share a position (`shared: true`, `decidedBy: "shared"`), unless a sudden-death outcome for that position orders them (`decidedBy: "sudden_death"`).
4. Positions are standard competition ranking: two teams sharing 2nd are both 2nd, and the next team is 4th.

### 8.5 Sudden death (H-14)

- `suddenDeathNeeded` returns the best (lowest) shared position that the scope covers (`first`: position 1 only; `all`: any) and that has no outcome yet.
- Each question goes to the teams still in it. After the reveal: if exactly one is right, it takes the position and the rest stay tied for the next position (decided only if the scope covers it); if more than one is right, the wrong ones drop out (they share the next position), and the right ones go on; if none or all are right, everyone stays in.
- It ends for that position when one team is left, or after `suddenDeathMax` questions for that position, or when the quiz's sudden-death list runs out: then the remaining teams share the position.
- A typed-answer sudden-death question must be fully marked before `sd.reveal`.

### 8.6 Copy picker (S-10), owned by B4

```ts
// src/shared/rules-api.ts (contract)
export interface CopyPicker {
  pick(key: string, vars: { team?: string; pub?: string; round?: number; n?: number; seconds?: number },
       last: Record<string, number>): { text: string; index: number } | null;
}
```

It merges the default pools with the theme's `copy`, skips lines whose placeholders have no value and lines with `{n}` when `n < 2`, avoids the index in `last[key]` when the pool has more than one usable line, and fills the placeholders. The engine stores the returned index in `copyLast`.

---

## 9. HTTP routes

All JSON. Host routes need the host session cookie (12.2) and return `401` without it. Mutating requests must carry an `Origin` that matches the server's own (12.4). Error bodies are `{ error: { code, message } }` with a plain-English `message`.

### 9.1 Pages and static files

| Route | Owner | What |
|---|---|---|
| `GET /` | B7 | Phone: join page |
| `GET /j/:roomCode` | B7 | Phone: join page with the room code filled in (QR target) |
| `GET /m/:moveCode` | B7 | Phone: takes over a moved team (11.3) |
| `GET /display` | B6 | Display |
| `GET /host`, `/host/*` | B0 shell; sub-pages per 3.2 | Host console; redirects to `/host/login` or `/host/setup` when needed |
| `GET /static/*` | B0 | Files from `public/` (embedded in the binary) |
| `GET /static/shared/tokens.css` | B0 | The default theme, from `docs/design/tokens.css` |
| `GET /theme.css` | B4 | Venue theme (5.3) |
| `GET /theme/assets/:file` | B4 | Theme assets |
| `GET /manifest.webmanifest` | B7 | Web app manifest with venue name and logo |
| `GET /sw.js` | B7 | Service worker (caches the app shell, never answers) |
| `GET /media/q/:questionId` | B1 | A question's image for the open night: served to anyone only once the question has been shown; to host sessions always (so images cannot leak answers early) |
| `GET /media/quiz/:quizId/:file` | B3 | Quiz media for the builder; host only |
| `GET /qr/join.svg` | B8 | QR code for the join URL with the room code |
| `GET /qr/display.svg` | B8 | QR code for the display address (host only) |
| `GET /qr/move/:code.svg` | B8 | QR code for a move link (host only) |
| `GET /api/ping` | B0 | `{ "app": "lockin", "version": "x.y.z" }` |

### 9.2 Host API

| Route | Owner | Request → response |
|---|---|---|
| `GET /api/auth/status` | B0 | → `{ setupNeeded: boolean, signedIn: boolean, setupCodeNeeded: boolean }` (public) |
| `POST /api/auth/setup` | B0 | `{ password, setupCode? }` → `{ ok: true }` and the session cookie |
| `POST /api/auth/login` | B0 | `{ password }` → `{ ok: true }` and the cookie (public, rate-limited) |
| `POST /api/auth/logout` | B0 | → `{ ok: true }` |
| `GET /api/server` | B8 | → `{ version, dataDir, publicUrl, displayUrl, joinUrl }` |
| `GET /api/quizzes` | B3 | → `{ quizzes: { id, title, rounds, questions, updatedAt, ready, problems }[] }` |
| `POST /api/quizzes` | B3 | `{ title }` → `{ quiz: QuizFile }` (default shape: 6 rounds of 5 empty questions, default settings) |
| `GET /api/quizzes/:id` | B3 | → `{ quiz: QuizFile, ready, problems }` |
| `PUT /api/quizzes/:id` | B3 | `{ quiz: QuizFile, baseUpdatedAt }` → `{ quiz, ready, problems }`; `409 edited_elsewhere` if `baseUpdatedAt` is stale; `423 quiz_in_use` while a night uses it (H-02) |
| `POST /api/quizzes/:id/duplicate` | B3 | `{ title }` → `{ quiz }` |
| `DELETE /api/quizzes/:id` | B3 | → `{ ok: true }`; `423` while in use. Moves the folder to `quizzes/.trash/` rather than deleting it. |
| `POST /api/quizzes/:id/media` | B3 | multipart `file`, `questionId` → `{ file }` |
| `GET /api/theme` | B4 | → `{ theme: ThemeFile, version, bundledFonts: { id, name }[] }` |
| `PUT /api/theme` | B4 | `{ theme: ThemeFile }` → `{ theme, version }` |
| `POST /api/theme/assets` | B4 | multipart `file`, `kind: "logo" \| "displayBackground" \| "font"` → `{ file: "assets/<name>" }` |
| `GET /api/venue` / `PUT /api/venue` | B4 | `VenueFile` |
| `GET /api/theme/preview.css` | B4 | `?theme=<url-encoded ThemeFile JSON>` → CSS, for the live preview (H-16) |
| `GET /api/history` | B1 | → `{ nights: { id, quizTitle, openedAt, endedAt, teams, winners: string[] }[] }` |
| `GET /api/history/:nightId` | B1 | → `{ night, standings: StandingRow & { name }[], rounds, answers }` |

Upload limits: images 5 MB, logo 2 MB, fonts 2 MB. Files are checked by their first bytes, stored under generated names, and served with `X-Content-Type-Options: nosniff`.

---

## 10. WebSocket protocol

One endpoint: `GET /ws` (upgrade). Text frames, one JSON object each. Version `protocol: 1`.

### 10.1 Envelope

```ts
// src/shared/protocol.ts (contract)
export const PROTOCOL = 1;
export type Role = "host" | "display" | "team";

export type ClientMsg =
  | { t: "hello"; protocol: 1; role: Role; token?: string }    // token: team device token, if any
  | { t: "cmd"; id: number; name: CommandName; args: object }
  | { t: "ping"; c: number };                                  // c: client time

export type ServerMsg =
  | { t: "welcome"; protocol: 1; role: Role; serverNow: number; teamId: string | null }
  | { t: "state"; seq: number; serverNow: number; view: HostView | DisplayView | TeamView }
  | { t: "ack"; id: number; ok: true; result?: unknown }
  | { t: "ack"; id: number; ok: false; error: { code: ErrorCode; message: string } }
  | { t: "pong"; c: number; s: number }                        // s: server time
  | { t: "bye"; reason: "moved" | "removed" | "night_closed" | "signed_out" | "protocol" };

export type CommandName =
  | "night.open" | "night.update" | "night.close" | "quiz.start" | "quiz.end"
  | "round.start" | "round.finish" | "round.next" | "question.next"
  | "timer.start" | "timer.pause" | "timer.resume" | "timer.add" | "lock"
  | "mark.group" | "mark.team" | "reveal.start" | "reveal.next" | "leaderboard.show"
  | "sd.start" | "sd.ask" | "sd.reveal"
  | "team.rename" | "team.remove" | "team.moveCode"
  | "team.join" | "team.rejoin" | "joker.play" | "answer.submit";

export type ErrorCode =
  | "not_allowed"      // wrong role
  | "wrong_phase" | "bad_args" | "not_found"
  | "room_code" | "name_taken" | "team_has_phone" | "joining_closed" | "night_full"
  | "bad_code" | "too_many_tries"
  | "too_late" | "question_closed"
  | "joker_used" | "joker_off" | "joker_wrong_round"
  | "quiz_not_ready" | "night_open" | "marks_pending" | "no_teams"
  | "server_error";
```

`message` is plain English for the person on that screen (for example `too_late`: "Too late, answers were locked."). Clients show `message`; they switch on `code` only for behaviour.

### 10.2 Connection flow

1. Client opens `/ws` and sends `hello`. A `host` hello needs a valid host session cookie on the upgrade request, or the server sends `bye { reason: "signed_out" }`. A `team` hello with a token that matches a team in the open night binds the connection to that team; with a missing or unknown token it is an unbound team connection that can only `team.join` or `team.rejoin`.
2. Server replies `welcome`, then `state`.
3. After every change the server sends `state` to every affected connection. `seq` increases by one per change; a client ignores a `state` whose `seq` is lower than the last one it rendered.
4. A connection that sends no `hello` within 5 s, or an unknown `protocol`, is closed.

### 10.3 Views

Each role gets its own view. The display view never contains answers, marks before reveal, or anything a team should not see. A team view contains only that team's answers.

```ts
// src/shared/protocol.ts (contract)
export interface Common {
  phase: Phase;
  venue: { name: string; themeVersion: string; teamColours: number };   // count of --team-N colours
  night: NightInfo | null;                                              // null when idle
  flash: Flash | null;                                                  // short-lived event line (10.4)
}

export interface NightInfo {
  id: string;
  roomCode: string;
  joinUrl: string;                 // publicUrl + "/j/" + roomCode
  quizTitle: string;
  plannedStart: number | null;
  holdingFrom: number | null;      // 7.4
  holdingPanels: HoldingPanel[];
  prizes: Prize[];
  roundCount: number;
  round: RoundInfo | null;         // current or upcoming round; null in lobby and ended
  joker: boolean;                  // quiz has the joker on
  lockMode: "question" | "round";
  teamCount: number;
  started: boolean;                // after Quiz Start
}
export interface RoundInfo { index: number; title: string; questionCount: number; isHalftimeRound: boolean; isLast: boolean }

export interface TeamChip { id: string; name: string; colour: number; jokerThisRound: boolean }

export interface QuestionPublic {
  id: string;
  roundIndex: number;              // -1 for sudden death
  number: number;                  // 1-based within the round, or the sudden-death question number
  text: string;
  image: string | null;            // "/media/q/<id>"
  input:
    | { type: "text" }
    | { type: "choice"; options: string[] }
    | { type: "number" }
    | { type: "datetime"; precision: "year" | "date" | "time" };
  status: "open" | "locked";
  timer: TimerView;                // per-round mode: the round timer, same on every question
  answered: number;                // teams that have answered (count only)
  of: number;                      // teams that can answer
}
export interface TimerView {
  state: "idle" | "running" | "paused" | "done";
  durationMs: number;
  locksAt: number | null;          // server time; clients convert with their offset (10.6)
  remainingMs: number | null;      // when paused
}

export interface RevealItem {
  question: QuestionPublic;
  answerText: string;              // text: accepted[0]; choice: "B. Paris"; number/closest: value; datetime: formatted
  rightCount: number;
}

export interface Standings {
  round: number;                   // 0-based round these standings follow
  rows: (StandingRow & { name: string; colour: number; roundScore: number; jokerThisRound: boolean })[];
}

export interface SuddenDeathPublic {
  position: number;
  teams: TeamChip[];               // still in it
  out: TeamChip[];                 // dropped out of this position
  questionNumber: number;          // 1-based for this position
  maxQuestions: number;
  question: QuestionPublic | null;
  status: "waiting" | "open" | "locked" | "revealed";
  rightIds: string[] | null;       // after reveal
  outcome: { position: number; teamIds: string[]; result: "won" | "shared" } | null;
}

export interface Lines {           // copy lines per screen slot (10.4); null = show no line
  lobby: string | null; round: string | null; question: string | null; locked: string | null;
  reveal: string | null; leaderboard: string | null; halftime: string | null;
  suddenDeath: string | null;      // sudden_death at the start, then sudden_death_again / _won / _shared after each reveal
  winner: string | null;           // winner, or winner_shared for a shared first place
  lastPlace: string | null; goodbye: string | null;
}

export interface DisplayView extends Common {
  role: "display";
  teams: TeamChip[];                         // joined teams, in join order
  question: QuestionPublic | null;           // asking: current question
  lockedMoment: { at: number; all: boolean } | null; // set when the current question or round locks
  reveal: RevealItem | null;
  standings: Standings | null;               // leaderboard, halftime, ended
  suddenDeath: SuddenDeathPublic | null;
  final: { winners: TeamChip[]; lastPlace: TeamChip[] } | null;  // ended
  lines: Lines;
}

export interface TeamSelf {
  id: string; name: string; colour: number;
  rejoinCode: string;
  jokerRound: number | null;
  jokerAvailable: boolean;                   // joker on, not used, and the upcoming round can take it
  inSuddenDeath: boolean;
}
export interface TeamAnswer { questionId: string; value: AnswerValue; receivedAt: number; counted: boolean }

export interface TeamView extends Common {
  role: "team";
  self: TeamSelf | null;                     // null on an unbound connection (join page)
  teams: TeamChip[];                         // lobby only; [] otherwise
  questions: QuestionPublic[];               // asking: per-question mode the current one; per-round mode every open or locked question this round
  answers: TeamAnswer[];                     // this team's answers for those questions
  standings: Standings | null;               // leaderboard, halftime, ended
  suddenDeath: SuddenDeathPublic | null;
  lines: Lines;
}

export interface HostTeam extends TeamChip {
  connected: boolean;
  lastSeenAt: number | null;
  jokerRound: number | null;
  answeredCurrent: boolean;
  total: number;
}
export interface QuestionHost extends QuestionPublic {
  answer: AnswerSpec;              // the full answer (H-08)
  note: string | null;
  answerText: string;
}
export interface MarkingQuestion {
  question: QuestionHost;
  groups: AnswerGroup[];           // text: grouped; other types: one group per distinct value, already marked
  noAnswer: string[];              // team ids with no answer (marked wrong)
  pending: number;                 // teams still pending on this question
}

export interface HostView extends Common {
  role: "host";
  teams: HostTeam[];
  round: { questions: QuestionHost[]; shown: number } | null;   // whole current round, for the host's script
  current: QuestionHost | null;                                 // asking: question on screen
  marking: { questions: MarkingQuestion[]; pendingTotal: number } | null; // asking (locked ones) and marking
  reveal: RevealItem | null;
  standings: Standings | null;               // live standings, always available after Quiz Start
  suddenDeath: (SuddenDeathPublic & { questionHost: QuestionHost | null; marking: MarkingQuestion | null }) | null;
  suddenDeathNeeded: { position: number; teamIds: string[] } | null;
  can: Partial<Record<CommandName, boolean>>; // which commands are allowed now, to enable buttons
  lines: Lines;                              // what the display is showing, for the host's reference
}
```

### 10.4 Lines and flashes

- **Lines** are copy lines tied to the screen the room is looking at. The engine picks a new line when a screen starts (for example `lines.locked` when a question locks: from `all_locked` if every team answered, else from `locked`) and keeps it while that screen is up, so a reconnecting display shows the same line. `lines.question` holds the `round_start` line until the first question, then the `last_seconds` line in the last 10 s. `lines.leaderboard` comes from `leaderboardLine` (priority in 5.5). `lines.lobby` is renewed every 45 s while in the lobby.
- **Flashes** are short events: `{ id: number; key: "team_joined" | "joker_played" | "no_answer"; line: string; teamId: string | null; at: number }`. A client shows a flash once when its `id` is new and drops it after 6 s. A `no_answer` flash is only in the view of the team concerned.

### 10.5 Command acknowledgements

Every `cmd` gets exactly one `ack` with the same `id`. A client keeps at most one pending command per action button and disables the button until the ack. `answer.submit` acks with `{ receivedAt }`, which the phone shows as "received" (P-05). Commands are idempotent where it matters: submitting the same answer again, or `lock` on a locked question, is a no-op that acks `ok`.

### 10.6 Clock sync and keepalive

Clients send `ping` every 2 s for the first 10 s after connecting, then every 25 s. Offset = `s - (c + rtt / 2)`; the client uses the median of the last 5 offsets. All countdowns are drawn from `locksAt - (Date.now() + offset)`. The server closes a connection with no message for 60 s. B0 provides this in `public/shared/ws-client.js` and `clock.js`, so the display, phone and console all share one implementation.

### 10.7 Sending views

The engine builds the views after each change and sends: the display view once and reuses it for every display connection; each team its own view; each host connection the host view. At 30 teams that is about 32 small JSON messages per change. Answer submissions only change counts in other views, so the engine may coalesce view sends to at most one per 100 ms per connection during asking (the submitting team's ack still goes out at once).

---

## 11. Reconnect, rejoin and moving a team

### 11.1 Team identity

- `team.join` creates the team and returns a **device token**: 32 random bytes, base64url. The server stores only its SHA-256 (`teams.token_hash`). The phone stores the token in `localStorage` under `lockin.team` as `{ nightId, teamId, token }`, and sends it in every `hello`.
- **One phone per team (P-02):** a team has exactly one valid token. `team.join` with a name already used in the night fails with `team_has_phone` ("This team already has a phone. If it died, ask for your team's rejoin code."), pointing to 11.2.
- **Reconnect (S-05, P-08):** the client reconnects with backoff (0.5, 1, 2, 4, then every 5 s, each with up to 30% random jitter, forever) and sends `hello` with its token; it gets `welcome` and the current `state`. Nothing is lost because nothing was kept on the phone: all answers are on the server.
- A token for a night that has ended or closed binds nothing; the phone shows the join page.
- Opening the installed web app (P-10) runs the same `hello`, so it goes straight back into a running night.

### 11.2 Rejoin code (P-08)

- Each team has a **6-character rejoin code** from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I or L), shown on the team's phone in a team menu.
- `team.rejoin { code }` on another phone issues a new token, sends `bye { reason: "moved" }` to the old phone's connection and closes it, and **issues a new rejoin code**, so the old phone cannot take the team back with the code it showed.
- Codes are compared case-insensitively. A connection gets 5 wrong tries per minute, then `too_many_tries`.

### 11.3 The host moves a team (H-06)

- `team.moveCode { teamId }` returns a one-time **move code** (8 characters, same alphabet) valid for 10 minutes, and a URL `<publicUrl>/m/<code>`; the console shows it with a QR code (`/qr/move/<code>.svg`).
- Opening that URL on the new phone sends `team.rejoin { code }`. It works like 11.2: new token, the old phone gets `bye { reason: "moved" }`. The code is then used up.

### 11.4 Display and host

- The display and the console use the same reconnecting client and show a "reconnecting" overlay over the last view (T-11) after 2 s without a connection; it clears on the next `state`.
- The display has no identity; any number of display connections may be open.
- A host connection whose session has expired or been signed out gets `bye { reason: "signed_out" }` and the console goes to the login page.

### 11.5 What each screen shows while offline

| | Phone | Display | Console |
|---|---|---|---|
| After 2 s disconnected | "Offline, reconnecting" bar; answer input disabled; typed but unsent answer shown as "not sent" (P-08) | Discreet "reconnecting" corner badge over the last screen | "Reconnecting" banner; buttons disabled |
| On reconnect | Renders the current view | Renders the current view | Renders the current view |

---

## 12. Security

The repo is public, and Lock-In runs on the open internet. Threats that matter: someone in the pub taking over the quiz, a team answering for another team or after the lock, and secrets leaking into the repo.

### 12.1 Host password (S-03)

- Stored in `<dataDir>/auth.json` as `{ "passwordHash": "<Bun.password argon2id hash>", "setAt": <time> }`. Never plain text, never in the repo or the database backups' file names.
- Minimum 8 characters. No other rules (non-technical hosts).
- **First run:** while `auth.json` is missing, `/host` shows the setup page. Every setup request must include the **setup code** (requests through the tunnel all look local, so the source address proves nothing): 8 characters from the rejoin alphabet, generated at start, printed to the log and shown by `lockin setup-code`. This stops a stranger setting the password on a fresh VPS.
- **Forgotten password:** run `lockin reset-password` on the VPS (over SSH, per the run sheet), or delete `auth.json` from the data folder and restart. Both sign out every session.

### 12.2 Host sessions

- Login sets cookie `lockin_host`: 32 random bytes, base64url; `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` (except on `http://localhost` in development); 7 days, renewed on use (so a night never needs a second login, S-03). The server stores only its SHA-256 in `host_sessions`.
- Login is rate-limited to 5 failures per minute per client IP, then a 1-minute wait.
- Logout deletes the session. A password change or reset deletes all sessions.

### 12.3 Teams

- Team tokens are bearer secrets kept in `localStorage`; only hashes are stored.
- Display and team connections can never run host commands (`not_allowed`); role is fixed by `hello` and the cookie, never by a command's arguments.
- A team command can only act on the team bound to its connection.
- Question images are not served before the question is shown (9.1), and views never carry answers early (10.3).

### 12.4 Web hardening

- Every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a `Content-Security-Policy` of `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'` on pages. Uploaded files (including SVG logos) are served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and are only ever shown through `<img>`, so script in an SVG cannot run.
- Mutating HTTP requests and WebSocket upgrades must have an `Origin` that matches `publicUrl`; otherwise `403`.
- All input is validated against the formats in sections 5 and 10 (lengths, types, ranges) before use. Text is always rendered as text, never parsed as HTML, in every page: in Arrow templates through `${}` slots (which Arrow turns into text nodes and attribute values, see 3.4), and elsewhere through `textContent`. Page code never uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `createContextualFragment`; `tests/browser-baseline.test.ts` checks this. The one exception is inside the vendored Arrow, which uses `innerHTML` on a `<template>` element to parse the developer's own static template strings (with placeholders, never data). Arrow uses no `eval` or `new Function`, so the page CSP above needs no change.

### 12.5 Secrets and venue data in the repo

- No secrets exist in the repo or the binary. The host password and sessions live only in the data folder. (The Launch AI features will read an API key from an environment variable or a data-folder file, never the repo.)
- `.gitignore` (B0) excludes `data/`, `*.db`, `auth.json`, `config.json` and `dist/`.
- Test fixtures and the default theme use made-up venue names only.

---

## 13. Testing

### 13.1 Unit and integration (`bun test`)

- **Rules (B2):** table-driven tests for every rule in section 8, including those REQUIREMENTS names: a shared round win, a joker round win, a three-way tie, sudden death with three teams.
- **Engine (B1):** runs on a fake `Clock` and `Scheduler`. Includes the S-04 test: an answer received at `locksAt - 1` counts and one at `locksAt` does not. Includes a restart test: build an engine on a temp database, accept answers, drop the engine, build a new one on the same database, and check every answer, mark and score is back.
- **Server (B0 and each owner):** an in-process server on a random port with a temp data folder (`tests/helpers/server.ts`, B0), real WebSocket clients (`tests/helpers/client.ts`, B0) that speak the protocol, and HTTP calls.

### 13.2 View fixtures

B0 writes sample views for every role and phase in `tests/fixtures/views/{host,display,team}/<phase>.ts`, each typed `satisfies DisplayView` (etc.), so the type check proves they match the contract. `scripts/fixture-server.ts` serves `public/` and a WebSocket that sends the fixture named in the page's `?fixture=` query (for example `/display?fixture=display/leaderboard-20`). UI threads (B5, B6, B7) build and check their screens against these fixtures without needing the engine. When the engine (B1) lands, its tests check that it produces views that match the fixtures' shape.

### 13.3 Browser checks

UI threads include screenshots (Playwright is available in the build environment; it is a tool, not a dependency) of each screen at the sizes in REQUIREMENTS (display 1920×1080 and 1280×720, phone 390×844, console 1280×800 and 768×1024) in their PRs. These are evidence for Review, not automated pass/fail tests.

### 13.4 Load and end-to-end (B9)

- `tests/load/night.test.ts`: 30 simulated teams, one display and one host connection play a full 6×5 quiz against a real server process; every answer is acknowledged and stored, and the host sees each answer count within 1 s (S-11).
- `tests/e2e/`: a full night in each lock mode with joker, marking, dispute change, halftime, a tie and sudden death, Quiz End and history; plus a kill-and-restart of the server process mid-question.

---

## 14. Build plan

### 14.1 Order

```
B0 Foundation  ──(Cas merges)──▶  wave 1, all in parallel:
                                    B1 Night engine        B2 Rules
                                    B3 Quiz builder        B4 Branding and venue
                                    B5 Host run console    B6 Display
                                    B7 Team phone          B8 Packaging and QR codes
                                  ──(all merged)──▶ B9 Load, end-to-end and hardening
```

- B0 goes first and is merged by Cas before anything else starts.
- B1 to B8 run in parallel. They meet only through the contracts in sections 5 to 11, which B0 puts into code. Suggested merge order, so integration is easy to check: B2, B1, B3, B4, B8, then B6, B7, B5. A UI thread (B5, B6, B7) can merge before B1 because it is built against the fixtures; it is then checked against the real engine in B9.
- B9 starts when B1 to B8 are merged.
- A thread that finds a contract wrong stops and asks (through the coordinator) rather than changing it; Cas decides, and the change goes into this file and `src/shared/` in one small PR.

### 14.2 Shared "Done when" for every build thread

Every build PR, in addition to its own list:

- `bun run typecheck` and `bun test` pass, with the output in the PR.
- It changes only the paths its thread owns (3.2), or says which contract change Cas agreed.
- No runtime dependencies added and nothing added to `public/vendor/` (3.1). UI pages are ES modules built with the vendored ArrowJS following the pattern in 3.4, with vanilla CSS, and pass `tests/browser-baseline.test.ts` (display baseline and no HTML sinks).
- No secrets or venue data committed.
- The REQUIREMENTS IDs it covers are listed in the PR with how each "Done when" is met.

### B0 Foundation

**Covers:** S-01 (skeleton), S-03, parts of S-05 and S-09; every contract.

Done when:
- `package.json` (no `dependencies`; `devDependencies` only `typescript` and `@types/bun`), `tsconfig.json` (strict), `.gitignore` (12.5) and a CI workflow running typecheck and tests on PRs exist.
- `src/shared/protocol.ts`, `formats.ts` and `rules-api.ts` contain the contract types from sections 5, 8 and 10 exactly, plus `validateQuiz`, `validateTheme` and `validateVenue` with tests for valid and invalid files, and plain-English problem messages.
- `bun run dev` and `lockin serve --public-url …` start the server; it refuses to start without a public URL; config precedence (4.2) and data folder creation work, with tests.
- `lockin.db` is created with the schema in 6.2 through a migration runner that records `schema_version`; a test opens a fresh database and checks every table.
- HTTP router, static serving of `public/` and `docs/design/tokens.css` (or a placeholder until Design merges), security headers (12.4) and `GET /api/ping` work.
- Host auth (12.1, 12.2) works: setup only with the setup code, login, logout, rate limit, session cookie, `lockin reset-password` and `lockin setup-code`; tests cover each.
- `/ws` accepts `hello` for each role, rejects a `host` hello without a session, answers `ping` with `pong`, enforces the 5 s hello timeout, and routes `cmd` to a registered handler (with a stub that answers `wrong_phase` until B1 lands).
- `public/shared/ws-client.js` (reconnecting client with backoff, hello, ack tracking, `seq` ordering) and `clock.js` (offset) exist, follow the display baseline, and are tested against the server.
- `public/host/` shell: login and setup pages, and navigation to Library, Branding, Run night and History pages (empty placeholders owned by B3, B4, B5).
- Every server module folder in 3.2 exists with an empty `register`, already called from `main.ts`.
- `tests/helpers/server.ts` and `client.ts`, `tests/browser-baseline.test.ts`, the view fixtures for every role and phase (13.2, including a 20-team and a 30-team leaderboard) and `scripts/fixture-server.ts` exist.

### B1 Night engine

**Covers:** S-04, S-05, S-06 (applying the rules), S-07 (applying), S-08, H-05 to H-14 server side, T-xx and P-xx data, `GET /media/q/*`, history API.

Done when:
- Every command in 7.2 is implemented with its phase rules, error codes and effects, and tested.
- Both lock modes work end to end through the protocol in tests: show, answer, change answer, pause, resume, add 15 s, lock early, timer runs out.
- The S-04 test (1 ms before the lock counts; at the lock does not) passes on fake time.
- Write-through (6.3) and restart recovery (7.6) pass the restart test in 13.1, including a timer that expired while the server was down.
- Views for host, display and team match section 10.3; tests check that the display view never contains an answer before reveal and a team view never contains another team's answers.
- Marking uses `Rules`: auto-marking at lock, review groups, `mark.group` adds accepted answers to the snapshot and the quiz file (through B3's quiz store interface `saveAcceptedAnswer(quizId, questionId, text)`, stubbed if B3 has not merged).
- Joker rules (P-04), Quiz Start closing joining, one phone per team, rejoin and move codes (section 11) are tested.
- Sudden death runs through `sd.start`, `sd.ask`, `sd.reveal` with tied-team-only answering, and its outcomes feed `rank`.
- Quiz End writes `results`; `GET /api/history` and `/api/history/:id` return saved nights; mark changes are logged (H-13).
- Lines and flashes (10.4) come from `CopyPicker` (a fake until B4 merges) with no repeats per pool.
- View sends are coalesced as in 10.7.

### B2 Rules

**Covers:** H-10 matching, S-06, S-07, H-14 decisions.

Done when:
- `src/server/rules/` implements `Rules` from 8 with no I/O and no dependency on the engine.
- Tests cover: normalising (accents, punctuation, articles, `J.F.K.` vs `jfk`, `&`), similarity ordering, every auto-mark row in 8.2, closest and range scoring with ties and missing answers, datetime precisions, joker doubling, round wins (shared, joker, all-zero round), a three-way tie by points, tie breaker, shared positions with competition ranking, sudden death with two and three teams (one right, two right, none right, max questions reached), and `leaderboardLine` cases.

### B3 Quiz library and builder

**Covers:** H-01, H-02, H-03, H-04, S-09 (quizzes).

Done when:
- Quiz store reads and writes `quizzes/<id>/quiz.json` atomically per 5.2; a quiz folder copied in by hand appears in the list; invalid files show as not ready with their problems.
- Every `/api/quizzes*` route in 9.2 works with the status codes given, including `409` and `423`, with tests.
- The builder page (`public/host/build/`) lets a QM create, open, duplicate, rename and delete quizzes; add, edit, reorder and delete rounds, questions and sudden-death questions; set every quiz setting with its default; pick every answer type; and attach an image that is resized in the browser before upload.
- It is built with Arrow (3.4): the open quiz is a local `reactive()` draft, and a `watch()` drives the debounced autosave.
- It autosaves (debounced, about 1 s) and shows "Saved" or a plain-English problem; it shows the not-ready reasons for the quiz.
- Text fields use the browser spellcheck (`spellcheck="true"`, `lang` from the page).
- It works at 1280×800 and 768×1024 (screenshots in the PR) and follows Design's console wireframes.
- `saveAcceptedAnswer(quizId, questionId, text)` is exported for B1.

### B4 Branding, venue settings and copy

**Covers:** H-15 (venue defaults), H-16, H-17 settings, S-09 (theme), S-10, T-10 data.

Done when:
- Theme and venue stores read and write `theme/theme.json` and `venue.json` per 5.3 and 5.4, with validation and defaults.
- `GET /theme.css` emits the resolved `--brand-*` properties and `@font-face` rules per Design's `branding.md`, and tests check derived colours for a sample theme; `themeVersion` changes when the theme changes.
- Asset uploads (logo, display background, fonts) are checked by type and size, stored under generated names, and served per 12.4.
- The branding page (`public/host/brand/`) sets name, logo, the four colours, fonts (bundled list or upload) and display background, shows a live display and phone preview, and warns (without blocking) on failed contrast rules. It is built with Arrow (3.4): unsaved settings live in a local store, and the previews update from it as the QM types.
- The venue page sets default prizes and the holding page minutes and panels.
- `CopyPicker` (8.6) merges default and theme pools, fills placeholders, skips lines with missing values and `{n}` lines when `n < 2`, and never repeats the last line; tested.

### B5 Host console: run the night and history

**Covers:** H-05 to H-15 on the console, S-08 history list.

Done when:
- `public/host/run/` renders `HostView` for every phase from the fixtures and drives every host command in 7.2, enabling buttons from `view.can`. It is built with Arrow (3.4); a new view never closes an open dialog or clears a field the host is typing in.
- The lobby shows the room code, join QR, display address and QR, teams with phone status, planned start and prizes; the "Open display" button opens `/display` in a new window (1.1).
- During asking it shows the question, answer, host note, timer controls and answered count; in per-round mode, the round's questions and the round timer.
- The marking screen shows groups with nearest matches first, accepts or rejects a group in one tap, shows pending counts, and blocks reveal until done.
- Team tools: rename, remove (lobby, with confirmation), move to a new phone with code and QR, disconnected teams highlighted.
- Disputes: any team's mark on any question can be changed until Quiz End, from the standings.
- Sudden death and Quiz End (with early-end confirmation) work from the console.
- `public/host/history/` lists past nights with final standings from `/api/history`.
- Every host-facing message is plain English; reconnecting banner per 11.5; screenshots at 1280×800 and 768×1024 for each phase in the PR.

### B6 Display

**Covers:** T-01 to T-12.

Done when:
- `public/display/` renders `DisplayView` for every phase and fixture, at 1920×1080 and 1280×720 with no scrolling, with no interaction after opening.
- It is built with Arrow (3.4), passes the display baseline test (3.3) and uses `/static/shared/tokens.css` and `/theme.css`. Leaderboard rows are keyed, so the bottom-up reveal and re-order animate on the same nodes.
- On a browser older than the baseline, a small classic script (`public/display/check.js`, plain ES5, no `eval` so it passes the CSP) tests for `Element.prototype.replaceChildren` and module support, and if either is missing shows a plain-English page: this TV's browser is too old, use a laptop over HDMI or a Chromecast (1.2). Checked in the PR by loading the page with the check forced to fail.
- Lobby and holding page (with countdown from server time and the chosen panels, plus join QR and room code always visible), question, answers-locked padlock moment (never before `lockedMoment`; makes sense up to 2 s late), reveal, leaderboard (bottom-up reveal, 20 teams on one screen, 21 to 30 by paging), halftime, sudden death, winner and goodbye all follow Design.
- The `install` panel's animated guide for iPhone and Android is bundled (no internet needed).
- "Powered by Lock-In" credit on every screen; reconnecting badge per 11.5.
- Screenshots of every fixture at both sizes in the PR; checked by hand in a desktop browser and, where available, in a Cast tab.

### B7 Team phone and web app

**Covers:** P-01 to P-10, `/`, `/j/:roomCode`, `/m/:moveCode`, manifest and service worker.

Done when:
- `public/phone/` is built with Arrow (3.4). A new view never clears a typed answer or moves focus (the answer being typed lives in the page's local store until it is sent).
- `public/phone/` renders `TeamView` for every phase and fixture: join (room code and name, with every join error shown plainly), lobby and pre-quiz (countdown, prizes, install guide link), joker, every answer input type, per-round navigation between open questions, "received" state, answers locked with the locked-in answer or "nothing sent", too late, score and position, sudden death (in it or watching), end of night.
- Token storage and automatic rejoin (11.1), rejoin code in a team menu, `/m/:code` takeover, and the "moved to another phone" screen on `bye`.
- Offline bar and "not sent" state per 11.5.
- Dark by default, tap targets at least 44 px, readable at 390×844; screenshots of every fixture in the PR.
- Manifest with venue name and logo, icons, and a service worker that caches only the app shell; installs and opens full screen on iPhone Safari and Android Chrome (checked by hand).

### B8 Packaging and QR codes

**Covers:** S-01, `/qr/*`, `/api/server`.

Done when:
- `src/server/qr/` encodes QR codes (byte mode, error correction M, versions 1 to 10) as SVG with no dependencies; tests decode known vectors (compare module matrices with published examples).
- `/qr/join.svg`, `/qr/display.svg`, `/qr/move/:code.svg` work, with host-only checks.
- `/api/server` works.
- `bun run build` produces `dist/lockin-linux-x64` with `public/`, copy, tokens and fonts embedded; a test runs the binary from an empty folder and fetches `/api/ping`, `/display` and `/static/shared/ws-client.js`.

### B9 Load, end-to-end and hardening

**Covers:** S-11, S-05 across the whole system, the quality bar.

Done when:
- The load test in 13.4 passes at 30 teams with no dropped answers and host answer counts within 1 s; the numbers are in the PR.
- The end-to-end nights in 13.4 pass in both lock modes, including the server process being killed and restarted mid-question with no lost answer, mark or score.
- Every view the engine produces in those runs is checked against the display and team privacy rules (10.3).
- Findings are recorded in NOTES.md; fixes go to the owning thread's paths with the owner thread's agreement, or are listed for Cas.

---

## 15. Open questions

1. **The pilot pub's TV.** Cas reports a modern smart TV with a streaming or casting device attached (2026-11-24), so either can show the display. The make and model of both (or the browser version in the TV's settings) confirm they meet the display baseline (1.2, 3.3) and decide which setups are tested there before `v1.0.0`. Cas to confirm later.
2. **"Hide answers" switch on the console (1.1).** A guard against a mirrored display showing the console. Small, but a scope addition, so it needs Cas's yes before Design or B5 adds it.
3. **Round win when everyone scores 0 (8.3).** This spec says such a round has no winner. Cas to confirm.
4. **Fallback display for older TVs (Later).** The display supports modern browsers only (1.2). If users report TVs below the baseline after launch, a vanilla, classic-script fallback display page could be added, chosen by the same check that B6 adds. Not planned for `v1.0.0`; Cas decides if it is needed.
