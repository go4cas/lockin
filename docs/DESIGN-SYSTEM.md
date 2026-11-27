# Lock-In design system: Last Call (as built)

What the three clients look like, read from the shipped CSS. The source of truth for the look is
Cas's **Last Call** design system and design canvas (claude.ai artifacts, linked from the PR that
built this). Where the build differs from them, section 6 says so.

- Tokens: [assets/tokens.css](../assets/tokens.css). Copy pools: [assets/copy.en.json](../assets/copy.en.json),
  where each pool shows: [COPY.md](COPY.md).
- Screenshots of every page and state: `tests/e2e/design-shots.ts` (section 7).

## 1. Surfaces

| Client | Who uses it | Where | Sizes | CSS |
|---|---|---|---|---|
| **Display** | The whole room | `/display` on a TV, cast device or laptop over HDMI | 16:9, sized in `vh` so 1920x1080 and 1280x720 match | `public/display/display.css` |
| **Team phone** | One phone per team | `/`, `/j/:code` (PWA) | 360 to 430 px wide | `public/phone/phone.css` |
| **Host console** | The quizmaster | `/host/*` on a laptop or tablet | 1280 px laptop, 768 to 1024 px tablet | `public/host/host.css` (shell and every shared component) plus `run/run.css`, `build/build.css`, `brand/brand.css` for page layout only |

Every page loads, in order: `/static/shared/tokens.css` (from `assets/tokens.css`, with the Funnel
`@font-face` rules), `/theme.css` (the venue's overrides, written by the server),
`shared/base.css`, then its own CSS. No framework, no preprocessor, no build step.

The display keeps its stricter baseline (Chromium 86 / Safari 14): no flex `gap`, `aspect-ratio`,
`:is()/:where()/:has()`, `color-mix()`, `inset`. `tests/browser-baseline.test.ts` enforces it on
`public/display/`, `public/shared/` and `public/vendor/`.

## 2. Tokens

### 2.1 Palette (fixed)

Near-black and bone, one venue colour, status colours that only ever mean status.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0b0b0c` | Every background |
| `--smoke` | `#161618` | Raised surfaces: answer rows, popovers, dialogs, inputs |
| `--raised` | `#1f1f21` | Hover and focus fill inside Smoke; row dividers |
| `--band` | `#111112` | Faint alternate band (TV standings) |
| `--line`, `--line-strong` | `#2a2a2c`, `#3a3a3c` | Hairlines; outlined buttons and inputs |
| `--dim` | `#5f5f5b` | Big quiet numerals, inactive steps (not small text) |
| `--ash` | `#95958f` | Labels, secondary text |
| `--fog` | `#c4c4be` | Supporting body text, host-voice lines |
| `--bone` | `#edede8` | Primary text |
| `--ember` | `#ff8a5c` | The countdown's last ten seconds, nothing else |
| `--status-{success,error,warning,active,disabled,not-started}` | green, red, amber, blue, greys | Status only, each with a `-tint` |
| `--team-1` to `--team-8`, `--team-on` | mint, coral, sky, amber, pink, lime, lilac, bone | Team bubbles (initials on the colour), by join order |
| `--deadlock-*` | ink, `#ff3b2f`, … | Sudden death ("Deadlock"), never themed |

### 2.2 Venue tokens (the only ones a venue changes)

A venue sets **one main colour** on the Branding tab. The server writes these over the defaults
(`src/server/branding/derive.ts`, and the same maths in `public/host/brand/derive.js` for the live
preview; `tests/branding/derive.test.ts` keeps them equal):

| Token | Default | Rule |
|---|---|---|
| `--venue` | `#7df0c3` Mint | The main colour |
| `--venue-tint` | `#1d3029` | 16% venue over Ink: selected answer, leader row |
| `--on-venue` | Ink | Ink, or Bone when Ink is under 4.5:1 on the venue colour |
| `--display-bg-image`, `--display-scrim` | none, transparent | The TV picture, under a 78% Ink scrim |

The branding page warns (never blocks) when the colour is weak on Ink, when labels on it are hard
to read, or when it is close to a status colour.

### 2.3 Roles (what screens use)

`--color-action`, `--color-on-action`, `--color-action-tint`, `--color-selected`,
`--color-correct` and `--color-countdown` all point at the venue tokens; `--color-countdown-hot` is
Ember; `--color-focus` is Bone (2 px ring, 2 px offset). `/theme.css` re-declares the venue roles
so a scoped preview resolves its own colour.

### 2.4 Type

Fixed for every venue: **Funnel Display** for titles, numbers and the wordmark; **Funnel Sans** for
everything else, including TV questions (`--font-question`). Atkinson Hyperlegible Next ships as a
fallback (`--font-legible`) in case Funnel Sans fails the back-of-the-room test.

| Surface | Scale |
|---|---|
| Display (vh) | hero 24 (countdown, winner), xxl 15 (room code), xl 11 (moment titles), l 8 (question to 90 characters, revealed answer), m 6.5 (longer question, standings to 8), s 5.4 (long picture question, dense standings, voice line), xs 4 (header strip, labels), credit 2.4 |
| Phone (px) | label 13, small 15, body 18, option 19, question 25, title 44 |
| Console (px) | overline 12, small 13, body 15, title 18, question 28 |

### 2.5 Space, shape, motion

Spacing 4 to 56 px (`--space-1` to `--space-8`). Radii xs 4, s 8, m 10 (buttons, inputs), l 12
(popovers, menus, toasts), xl 16 (answer rows, dialogs), pill. Phone: gutter 20, tap 52, option
row 62. Console: tap 44, primary next-step button 64, sidebar 300, centred page column of at most 1200
with at least 48 each side (20 on a tablet, 16 on a phone; `--host-max`, `--host-gutter`, shared by
the nav and every page), page top 40. Display: safe area 5vw x 5vh,
header 7.8vh, bubbles 6.7vh. Motion: fast 150 ms, base 250 ms, slow 600 ms, standings row 450 ms;
transforms and opacity only.

## 3. Logo

- **Mark** (`public/shared/mark.mjs`, `assets/logo/`): a ring with a venue-coloured arc and a
  keyhole. **Lockup**: the mark plus the wordmark "Lock-In" in Funnel Display. Use
  `mark(html)` and `lockup(html, cls)` from `mark.mjs` in Arrow templates (the console nav builds
  the same lockup as DOM, `LockIn.lockup()`).
- When a venue has no name and no logo, the display header, phone join page and idle screens show
  the lockup instead of a name. A venue logo replaces the mark on the display; the phone and
  console keep the Lock-In mark.
- **"Powered by" + mono lockup**, linked to the source (AGPL-3.0): bottom-right on the display,
  phone footer, console footer.
- Favicon: `assets/logo/lockin-favicon.svg`. Sudden death is **Deadlock**.

## 4. Countdown

One component on all three screens, `public/shared/countdown.mjs`:
`countdown(html, { style, timer, now, size: "tv" | "small", label })`. Styles: number, **ring**
(default), bar, dashed, flip, chosen by the venue on the Branding tab (`theme.countdown`). Display
and phone compute the same seconds from the server's timer (`countdownNow`), so they always agree.
Before the timer starts it shows the full time, dimmed. The last ten seconds turn Ember.

## 5. Components and screens

| Component | Display | Phone | Console |
|---|---|---|---|
| Primary button | n/a | `.btn.primary`, full width, 52 px, venue fill | `.btn.primary` 44 px; `.btn.next` 64 px for the one next step |
| Other buttons | n/a | `.btn.secondary`, `.btn.ghost` | `.btn.ghost`, `.outline`, `.quiet`, `.danger`, `.danger-fill`, `.ok`, `.small`, `.icon` |
| Inputs | n/a | Underline input, venue line on focus, red when wrong | Boxed `.input` in a `.field` with a label |
| Answer rows | Lettered options, 2 columns | 62 px rows, letter disc, venue outline when chosen | n/a |
| Team identity | Bubble with initials + name | Bubble in the top bar | Bubble + name, `In / Waiting / Offline` status |
| Status | `.pill` tints | Received strip ("The quizmaster has …") | `.pill ok/warn/bad`, live dot |
| Switch, segmented | n/a | `.tabs` | `input.switch`, `.seg` |
| Menus and dialogs | n/a | Bottom sheets | `.menu` dropdown, `.dlg` dialog, `.toast` |

- **Display**: header strip (logo or lockup, venue, round, `01 / 05`), main area, footer (voice line
  left, credit right). Lobby, holding panels, round intro, question with the countdown, answers
  locked, reveal, the departures-board standings, halftime, Deadlock, winner, final standings,
  pairing and idle.
- **Phone**: top bar (bubble, team, `R1 · 02/05`, ⋮), body, sticky footer with the main button.
  "Locked in." moment with the shackle, your answer, and the place card after each round.
- **Console**: a 64 px top nav (lockup, Quizzes, Venue settings, Run night, History, room code and live
  dot on Run night, Sign out). Run night has its own header (lockup, title, room, phase steps
  Lobby · Ask · Lock · Reveal · Table, Night menu), the main column with the question, answer and
  host note, the timer row and marking, a 300 px teams sidebar, and a footer with "On the display
  now" and the next-step button. Library rows show a status dot, edited date and "Open night →" or
  "N problems ▾". The builder and Venue settings share one page head: the title on the left, a
  `.seg` tab bar on the right (builder: Rounds · Sudden death · Settings; Venue settings: Branding ·
  Holding page · Default prizes · Displays). The builder's Rounds and Sudden death tabs are a slim
  outline (one line per round or question) + editor. Settings forms are 680 px `.form-card`s with an
  overline title, one field per row, the unit after a short input and the hint under it. The quiz
  Settings tab uses `.form-card.cols` (880 px): the canvas's field grid, label in a 200 px left
  column, control and hint on the right, a hairline between rows. Branding has a live TV and phone
  preview. The console's top nav is sticky. Loading shows the mark's ring with the venue arc turning,
centred (`.loading`, `.spin`; a pulse with reduced motion) instead of text; selects use the field box
with an Ash chevron, and their open list is the Menu where the browser supports customizable select. Every client's credit ends with the server's version.

## 6. Differences from the design canvas

Each of these was agreed with Cas (2026-11-26).

1. The builder keeps two columns (outline, editor); the canvas shows three, with a preview. At
   1280 px a third column leaves the editor too narrow for long questions and accepted answers.
2. The library has no "Tonight / Last night" column: not on the roadmap.
3. "On the display now" is a text summary, not a live miniature of the TV.
4. TV question text uses Funnel Sans; the design system names Atkinson Hyperlegible Next as the
   fallback if it fails the back-of-the-room test.
5. The wordmark reads "Lock-In" (the canvas has "lock in"), to match the product's name everywhere.

## 7. Screenshots

`tests/e2e/design-shots.ts` starts a real server with a seeded night (a two-round quiz with every
answer type and a picture, 8 teams, prizes, a joker, a server restart, a three-way Deadlock) and
captures every client at display 1920x1080, console 1280x800 and 768x1024, phone 390x844, with an
`INDEX.md`:

```sh
bun tests/e2e/design-shots.ts dist/design-shots/default default
bun tests/e2e/design-shots.ts dist/design-shots/branded branded   # a made-up venue theme
```

It needs Playwright from `tools/browser` (see its README). It is a tool, not a check, and is not
part of CI.
