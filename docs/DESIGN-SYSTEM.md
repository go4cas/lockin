# Lock-In design system (as built)

What the three clients look like **today** (v0.2.0, main at PR #39), read from the shipped CSS and
the running app. It describes the current state, inconsistencies included, so a designer can review
it. It is not a redesign and not a spec.

- The design *intent* (decisions, tests, wireframes) is in [docs/design/](design/README.md). Where
  the build differs from the intent, this file says so.
- Screenshots of every page and state: run `tests/e2e/design-shots.ts` (see "Screenshots" at the end).

## 1. Surfaces

| Client | Who uses it | Where | Sizes designed for | Front-end |
|---|---|---|---|---|
| **Display** | The whole room | `/display` on a TV, cast device or laptop over HDMI | 16:9, everything in `vh`/`vw` so 1920x1080 and 1280x720 match | ArrowJS core, `public/display/display.css` (429 lines) |
| **Team phone** | One phone per team | `/`, `/j/:code` (PWA, add to home screen) | 360 to 430 px wide | ArrowJS core, `public/phone/phone.css` (195 lines) |
| **Host console** | The quizmaster | `/host/*` on a laptop or tablet | 1280 px laptop, 768 to 1024 px tablet | ArrowJS core; `host.css` (shell) plus one CSS file per section: `run/run.css`, `build/build.css`, `brand/brand.css` |

All three load, in order: `tokens.css` (from `assets/tokens.css`), `/theme.css` (the venue's
overrides, written by the server), `shared/base.css`, then the surface's own CSS. No CSS framework,
no preprocessor, no build step.

The display has a stricter browser baseline (Chromium 86 / Safari 14): no flex `gap`,
`aspect-ratio`, `:is()/:where()/:has()`, `color-mix()`, `inset`, `dvh`. A test
(`tests/browser-baseline.test.ts`) enforces it. Phone and console use modern CSS freely.

## 2. Tokens

Source: [assets/tokens.css](../assets/tokens.css). Three layers.

### 2.1 Brand tokens (the only ones a venue changes)

The venue picks four colours, two fonts and an optional display background on the console's
Branding tab. The server derives the rest (formulas D1 to D7 in [design/branding.md](design/branding.md)).

| Token | Default ("Chalkboard") | Source |
|---|---|---|
| `--brand-bg` | `#17191b` | Background colour |
| `--brand-text` | `#edeae2` | Text colour |
| `--brand-accent` | `#ff7a5c` coral | "Main colour": buttons, the padlock, highlights |
| `--brand-accent-2` | `#3cc6b8` teal | "Second colour": status, correct answers, timers |
| `--brand-surface` | `#1d1f21` | D1 mix(bg, text, 3%) |
| `--brand-surface-2` | `#282a2b` | D2 mix(bg, text, 8%): panels, chips, buttons |
| `--brand-line` | `#393a3b` | D3 mix(bg, text, 16%): dividers |
| `--brand-text-muted` | `#a9a7a2` | D4, raised until 4.5:1 on surface-2 |
| `--brand-on-accent`, `--brand-on-accent-2` | `#17191b` | D5: bg or text, whichever contrasts more |
| `--brand-accent-soft` | `#412a27` | D6 mix(bg, accent, 18%) |
| `--brand-accent-2-soft` | `#1e3837` | D6 mix(bg, accent2, 18%) |
| `--brand-display-bg`, `-bg-image`, `-scrim` | bg, none, transparent | Display background colour or picture; 78% scrim over a picture |
| `--brand-font-display` | Caveat Brush | Headline font: Caveat Brush (default, "Chalk"), Alfa Slab One ("Sign"), Bebas Neue ("Neon"), Atkinson Hyperlegible ("Plain"), or an upload |
| `--brand-font-body` | Atkinson Hyperlegible | Body font: Atkinson Hyperlegible or an upload |

### 2.2 Semantic roles (what screens should use)

| Role | Maps to | Used for |
|---|---|---|
| `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-line` | brand bg/surfaces/line | Page, cards, panels, dividers |
| `--color-text`, `--color-text-muted` | brand text | Text |
| `--color-action`, `--color-on-action`, `--color-action-soft` | accent | Primary buttons, the next step, leader row, selected item |
| `--color-lock` | accent | The padlock and "Answers locked" |
| `--color-status`, `--color-on-status`, `--color-status-soft` | accent 2 | Timers, "received", progress, links on the phone |
| `--color-correct`, `--color-correct-soft` | accent 2 | Right answers (always with a tick and a word) |
| `--color-wrong` | text-muted | Wrong answers fade; never red |
| `--color-joker` | `#ffc145` fixed | Joker tag, joker card, joker button |
| `--color-danger` | `#ff5a5f` fixed | Console only: destructive buttons |
| `--color-warning` | `#ffc145` fixed | "Offline", "not ready", readability warnings |
| `--color-focus` | `#ffffff` fixed | Focus ring (phone and console) |
| `--deadlock-bg/-ember/-ember-soft/-text` | `#0b0b0c`, `#ff3b2f`, `#3a1210`, `#f4f1ea` | Sudden death ("Deadlock"): fixed, not themed |
| `--team-1` to `--team-8` | teal, coral, amber, sky, lilac, lime, pink, sand | Team dots, cycled by join order; `--team-on` `#17191b` for text on them |

### 2.3 Type

Two families. The display font is for moment titles and host-voice lines only ("never questions,
answers, names or numbers"); everything else is the body font. Atkinson Hyperlegible has a slashed
zero, so scores and codes show `0` with a slash.

| Scale | Tokens |
|---|---|
| Display (vh; 1vh = 10.8 px at 1080p) | hero 24vh (timer, winner), xxl 15vh (room code), xl 11vh (moment titles), l 8vh (short question, revealed answer), m 6.5vh (long question, options, leaderboard), s 5.4vh (host voice, dense leaderboard), xs 4vh (labels), credit 2.4vh |
| Phone (px) | xs 13, s 15, m 18 (body, inputs), l 22 (question), xl 30 (titles), hero 56 (position, timer) |
| Console (px) | s 13, m 15 (body), l 19, xl 26 (question while running), xxl 34 (timer) |
| Weights / leading | 400 and 700 only; leading 1.1 (tight) and 1.3 (body) |

Eyebrow style (uppercase, 0.06 to 0.08em tracking, bold, muted, 12 to 13 px) is used on phone and
console for small labels ("MULTIPLE CHOICE", "ON THE DISPLAY NOW", "TEAMS").

### 2.4 Space, size, radius, motion

| Group | Tokens |
|---|---|
| Display space | 1vh, 2vh, 3.5vh, 6vh, 10vh; safe area 5vw x 5vh (TV overscan); header 9vh; leaderboard row 8.4vh (7.4vh dense); team dot 2.6vh; radius 1.6vh |
| Phone space | 4, 8, 16, 24, 40 px; gutter 16 px; tap target 52 px; gap between targets 10 px |
| Console space | 4, 8, 16, 24, 40 px; tap 44 px; primary "next step" button 64 px; sidebar 280 px (200 px under 1024 px) |
| Radii | s 6 px, m 12 px, l 20 px, pill 999 px |
| Motion | fast 150 ms, base 250 ms, slow 600 ms, lock snap 700 ms, leaderboard row 450 ms with 900 ms between rows; `--ease-out`, `--ease-snap` (overshoot for the shackle). Transforms and opacity only. |

## 3. Logo and brand

- **Mark**: a closed padlock with a "?" cut into the body; the dot of the "?" is the keyhole
  ([assets/logo/lockin-mark.svg](../assets/logo/lockin-mark.svg), and `-on-light`). Body in the
  accent (coral), shackle in the text colour. Chosen by Cas over two other options
  ([design/img/test-logo-options.png](design/img/test-logo-options.png)).
- **Wordmark**: there is no drawn wordmark. "Lock-In" is set in the display font next to the mark
  (console nav, display header, idle and pairing screens), so it changes with the venue's headline font.
- **The padlock as a moment**: "Answers locked" animates the shackle snapping shut (phone and
  display), in the lock colour.
- **Venue branding**: a venue logo (PNG, SVG or JPEG) replaces the mark in the display header and
  the phone join page. The console keeps the Lock-In mark in its nav.
- **"Powered by Lock-In"** credit, linked to the source (AGPL-3.0), sits bottom-right on the display,
  in the phone footer and at the bottom of every console page.
- **Name**: "Lock-In". Sudden death is branded **Deadlock** ("Dead**lock**", the "lock" in ember red).

## 4. Voice and copy

- All brand copy is in [assets/copy.en.json](../assets/copy.en.json): 12 `taglines` and 22 `voice`
  pools (lobby, team_joined, round_start, last_seconds, locked, all_locked, no_answer, joker_played,
  reveal, lead_change, big_climb, close_race, halftime, tie_breaker, sudden_death,
  sudden_death_again, sudden_death_won, sudden_death_shared, winner, winner_shared, last_place,
  goodbye), 3 to 5 lines each. A random line is picked, avoiding the last one. Placeholders
  `{team} {pub} {round} {n} {seconds}`. A venue can replace or add lines per pool.
- Tone: dry pub banter, short, never mean ("Commit to something.", "Fresh start, same excuses.",
  "Insufferable until next week.").
- Where it shows: the host-voice line, in the display font and the status colour, bottom-left of the
  display and under the main card on the phone; the console shows the same line in "On the display now".
- UI copy (buttons, hints, errors) is plain British English in full sentences ("The 4 letters on the
  TV.", "Only one phone per team."). It lives in the page code, not in the copy file.
- The phone and display still say **TV** to players ("On the TV if you need it", "Eyes on the TV"),
  while the product and the console say **display**.

## 5. Components

### Shared patterns
| Component | Display | Phone | Console |
|---|---|---|---|
| Primary button | n/a | `.btn.primary` full width, 52 px, radius m, accent fill, dark label | `.btn.primary` 44 px, radius s; `.btn.next` 64 px for the one next step |
| Secondary / ghost | n/a | `.btn.secondary` (surface-2), `.btn.ghost` (2 px inset line) | `.btn.ghost` (1 px inset line), `.btn` default (surface-2) |
| Destructive | n/a | n/a | `.btn.danger` (red outline), `.btn.danger-fill` |
| Disabled | n/a | opacity 0.45 | opacity 0.45 (run, build), 0.5 (brand), 0.6 (sign-in) |
| Text input | n/a | 52 px, 2 px border, radius m, focus = status border | 44 px, 1 px border, radius s, focus = 3 px white outline |
| Pill / status chip | `.chip` with team dot | n/a | `.pill` (ok = status-soft, warn = amber 15%, bad = red 15%, joker) |
| Card | `.panel` | `.card` surface-2, radius l (20 px) | `.card` surface + 1 px line, radius m |
| Segmented control | n/a | `.tabs` (home-screen guide) | `.seg` (builder answer type, branding tabs, fonts) |
| Team identity | colour dot + name, never colour alone | dot + name in the top bar | dot + name in the teams list |
| Joker | `JOKER` tag (amber) next to a name | dashed amber card with tag and amber button | amber "Joker" pill |
| Reconnecting | amber `Reconnecting…` pill top-right | amber full-width "Offline. Reconnecting…" bar | amber pill |

### Display screens
Header (logo or mark + venue name left; round strip and question pips right), main area, footer
(host-voice line left, credit right), inside a 5% overscan-safe area. Screens: browser too old,
pairing code, idle/waiting, lobby (QR, room code, team chips, prizes strip), holding page (six
rotating panels: countdown, teams, how to join, add to home screen, animation, prizes), round
intro, question (text, multiple choice in a 2-column grid, picture left of text) with a big timer
and "n of N answered", answers locked (padlock snap), marking, reveal (answer fades in 1.2 s after
the question; dots tally "n of N teams got it"), leaderboard (bottom-up row reveal, movement
arrows, joker tags, leader row in accent-soft), halftime (standings + prizes), Deadlock intro,
question, locked and result (black/ember look), winner (champions, points, first prize), final
standings (with last-place and goodbye lines).

### Phone screens
Top bar (team dot, name, progress "R1 · Q2 of 5", ⋮ menu), body, sticky footer with the main
button and the credit. Screens: join (venue, name, room code, rejoin link), join errors, rejoin
code, join closed, no quiz running, connecting/offline, moving, lobby ("You're in!" or countdown,
joker offer, prizes, add-to-home-screen card), team menu sheet (rejoin code), add-to-home-screen
guide (iPhone/Android tabs), round intro (joker offer), get ready, question (timer bar, eyebrow
with the answer type, picture with tap-to-zoom, question, input per type, "sent" strip showing
what the quizmaster has), locked ("You locked in"), waiting/"Eyes on the TV" (marking and reveal),
score (position, total, this round), halftime, Deadlock in (answering) and watching, end (place,
prizes). Round-lock quizzes add a 1..N question picker with a dot for each sent answer.

Answer inputs: text (autocorrect off), multiple choice (lettered A to F option rows, tap sends),
number (big centred input), year (− / + stepper), date and time (native pickers, so the format
follows the phone's locale).

### Console sections
- **Library, Branding (venue settings), History**: left sidebar layout (`host.css`, 280 px nav with
  the mark and "Lock-In" in the display font, sign-out at the bottom).
- **Run night**: a different shell: top nav bar, a night bar (round, question, room code, Open
  display, Night menu), a step strip (Q1..Q5, Mark, Reveal, Leaderboard, Halftime), the main
  column, and a right column ("On the display now" preview, teams list, the big next-step button).
  Under 1024 px it stacks into one column.
- **Builder**: outline sidebar (rounds, questions, sudden death), editor pane with segmented answer
  types, chips for accepted answers, picture upload, per-question timer, a problems list for
  unfinished quizzes. "Saved" status pill next to the title.
- **Branding**: three tabs (Branding, Holding page, Prizes) and a live preview of a display and a phone.

## 6. Known inconsistencies and gaps (today)

Found while reading the CSS and capturing the screenshots. Not fixed here.

**System level**
1. **Two console shells.** Library, Branding and History use the left sidebar; Run night (and History's
   styles) use a top bar from `run.css`. Moving between sections changes the whole frame.
2. **Components are copied, not shared.** `.btn`, `.input`, `.pill`, `.seg`, `.card` are defined
   separately in `run.css`, `build.css` and `brand.css` (and again on the phone), with drift: disabled
   opacity 0.45 / 0.5 / 0.6, `.btn.small` 44 px in run vs 36 px in brand, input focus is a white
   outline on the console but a teal border on the phone, card radius 20 px on the phone vs 12 px on
   the console.
3. **Literal values next to tokens.** About 20 hard-coded font sizes (12 px used 15 times for
   labels and pills; 8 px, 7 px, 6 px in the branding preview), about 50 literal `border-radius`
   values, and literal greys in the Deadlock styles (`#151517`, `#2a2a2a`, `#999`, `#aaa`, `#777`)
   that are not tokens. Pill tints use `rgba()` of the warning/danger colours instead of soft tokens.
4. **Fonts declared four times.** `@font-face` rules are repeated in `phone.css`, `display/fonts.css`
   and `brand.css`, and the server writes them again in `/theme.css` (Caveat Brush is requested by
   two URLs, `caveat-brush.woff2` and `caveat-brush-400.woff2`; the server maps both to one file).
5. **Error colour = brand accent on the phone.** `.input.bad` and `.err` use the action colour, so a
   venue's main colour is also its error colour; the console uses amber/red instead.
6. **Joker amber is fixed.** With a gold or amber venue accent (see the branded screenshots) the
   joker tag, the leader-row highlight and primary buttons become the same colour.
7. **"TV" vs "display"** in player-facing copy (section 4).
8. **Wordmark** is live text in the display font, so it changes with every venue's headline font.

**Display**
9. A 6-option multiple-choice question does not fit: the question text is pushed up under the
   header and the last row of options is cut off at the bottom (screens r2q2 at 1920x1080).
10. The leaderboard and halftime standings cut off the 8th row (8 teams in one column), and the
    halftime prizes list is cut off at the bottom.
11. The lobby team chips show about 4 of 8 teams with no "+4 more"; long prize text is cut with "…".
12. The "Reconnecting…" pill overlaps the round strip in the header.
13. The round intro shows "Round 1 of 2" twice (header and above the title).
14. The idle/waiting screen and the "animation" holding panel show a tagline ("Answers locked.
    Next round's on you.") that reads like a game state when no quiz is running.
15. A late `team_joined` line ("Quiz Khalifa just joined. Fresh legs.") stays on the holding page
    after the moment has passed.
16. A `lead_change` line for three joint leaders reads "A, B and C **has** entered the chat. And
    first place." (singular verb for a list), on the display and the phone.
17. Large empty areas on 1920x1080 for short text questions: the question is set at the m/l size
    on the left with the timer on the right, leaving the lower half empty.

**Phone**
18. Date questions use the native picker, which shows `mm/dd/yyyy` on a US-locale phone.
19. A toast (team joined) floats over the prizes and home-screen cards in the lobby.
20. The disabled "Send answer" button is a dark, muddy accent rather than a clearly inactive state.

**Console**
21. On a 1280x800 laptop the Run night teams list shows 7 of 8 teams; the 8th is below the fold of
    the right column, above the big button.
22. "On the display now" is a text summary in a large empty box, not a preview.
23. The full-page footer ("Powered by Lock-In") sits below a 100vh sidebar, so short pages scroll.

Items 9 to 16 look like bugs; they are passed to the "Fix UI bugs from device testing" thread.

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
