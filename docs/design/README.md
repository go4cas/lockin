# Lock-In design

The design for the three Lock-In screens: the host console, the display and the team phone. It unpacks the Chalkboard concept from [BRIEF.md](../BRIEF.md), tests it, keeps what works and changes what does not. Requirement IDs (T-03, P-05 and so on) refer to [REQUIREMENTS.md](../REQUIREMENTS.md).

| File | What it is |
|---|---|
| [assets/tokens.css](../../assets/tokens.css) | The design tokens as plain CSS custom properties. The default theme, and the only token names a venue theme can set. |
| [branding.md](branding.md) | Venue branding: the settings screen, how its inputs become tokens, the readability warnings, bundled fonts. |
| [moments.md](moments.md) | The key moments across all three screens at once: join, holding page, round start, question, answers locked, marking, reveal, leaderboard, halftime, tie breaker, sudden death, winner, prizes, reconnecting. |
| [screens.md](screens.md) | Every wireframe, per screen, with the requirement it covers. |
| [copy-review.md](copy-review.md) | The copy pools checked against the screens, and the changes made to `assets/copy.en.json`. |
| [wireframes/](wireframes/) | Mid-fidelity HTML wireframes (`display.html`, `phone.html`, `host.html`) that use `tokens.css` and the bundled fonts. Open one with `?s=<screen id>`, and add `&theme=brass-and-oak` or `&theme=neon-taproom` to see a venue theme. |
| [img/](img/) | Renders of every wireframe and the test images below. |
| [assets/logo/](../../assets/logo/) | The Lock-In mark as SVG, for dark and light backgrounds. |
| [assets/fonts/](../../assets/fonts/) | The bundled fonts (WOFF2, Latin) and their SIL Open Font Licences. |
| [tools/](tools/) | `derive.ts` (derived brand tokens and readability checks, the reference for the server and the branding screen), `tokens.test.ts`, the render script and the viewing-distance simulation. |

Wireframes are mid-fidelity on purpose: real tokens, real fonts and real sizes, so they double as a test of the theme. Pictures, the QR code and animations are placeholders. Layout and component CSS in `wireframes/*.css` is a reference for the build threads, not production code; `tokens.css` is meant to ship as it is. The wireframe scripts build their markup with `innerHTML` to keep them short; production pages never do that and use Arrow templates instead (TECH-SPEC 3.4 and 12.4).

## What was tested, and what changed

The brief's Chalkboard concept was tested on four things: contrast, display legibility at distance, smart-TV browser limits and team colours. Results and decisions:

| Concept said | Test | Decision |
|---|---|---|
| Blackboard `#17191B`, chalk `#EDEAE2`, dust `#A9A69E` | Chalk on blackboard 14.7:1, dust 7.3:1 (WCAG). | **Kept.** Charcoal and the other surfaces are now derived from background and text, so every venue theme gets them for free (branding.md). |
| Coral `#FF7A5C` for actions, teal `#3CC6B8` for status | On blackboard: coral 6.9:1, teal 8.4:1. But chalk text **on** coral is 2.1:1 and on teal 1.8:1, which fails. | **Kept, with dark labels.** Text on a coral or teal fill is blackboard (6.9:1 and 8.4:1). The server picks the label colour for any venue colour (D5). |
| A chalky hand-drawn display font for headlines and the host's voice | Five candidate fonts rendered on the display and blurred to simulate the back of the room ([img/test-font-distance.png](img/test-font-distance.png)). Textured "chalk" fonts lose contrast at distance: Cabin Sketch's strokes drop to about 6.9:1 effective contrast against 13:1 for solid brush fonts. | **Caveat Brush** as the default display font: hand-drawn and chalky, with solid strokes that survive distance. Display font is **only** for short moment titles and host-voice lines, never for questions, answers, team names or numbers. |
| A clean sans-serif for scores, labels and forms | Needed to separate easily confused characters on a TV across a room. | **Atkinson Hyperlegible** (designed by the Braille Institute for low-vision readers; distinct I/l/1 and O/0). Its slashed zero is the price; scores like "20" show a slashed 0. |
| Team colours: teal, coral, amber, sky, lilac, lime | Up to 30 teams, so colours repeat. A colour-blindness simulation of 8 colours shows some pairs merge (sky and lilac for deuteranopia, amber and lime for protanopia). | **8 team colours** (`--team-1`..`--team-8`: the six plus pink and sand), cycled by join order. Each is at least 6.9:1 on the background. **Colour is never a team's only marker**: the team name is always next to its dot. |
| Teal for status | Teal is also a team colour, so "teal = correct" could be read as "the teal team". | Right answers always carry a tick and a word; wrong answers **fade** (muted text), they never turn red, which also fits "never mean". |
| A chalkboard texture | Images behind text reduce contrast and cost memory on smart TVs. | **Flat colour by default.** A venue can set a TV background picture; Lock-In always lays a 78% scrim of the background colour over it. |
| Logo: a padlock whose shackle is a question mark, the keyhole as its dot | Cas found it could read as a bent padlock to new users. Three directions were drawn and shown at display-header, phone-icon and browser-tab size ([img/test-logo-options.png](img/test-logo-options.png)). | **Option A, chosen by Cas:** a normal closed padlock with a question mark cut into the body; the dot of the "?" is the keyhole. Reads as a padlock first and a question second at every size. Files in [assets/logo/](../../assets/logo/). The "answers locked" moment still snaps the shackle shut. |
| Brass & Oak, Neon Taproom theme ideas | Built as sample venue themes through the same token pipeline ([img/display-lobby--brass-and-oak.png](img/display-lobby--brass-and-oak.png), [img/display-locked--neon-taproom.png](img/display-locked--neon-taproom.png)). Both pass every readability check. | The token system works for very different looks with four colours and one font choice. The samples live in `wireframes/themes/` as fixtures, not as shipped themes. |

## Display rules

### Browser baseline

Agreed with Architecture (TECH-SPEC 1.2 and 3.3, updated 2026-11-24): display pages must run on Chromium 86 / Safari 14 class engines (roughly smart TVs from 2022 onwards, Chromecast, any current desktop browser). Display CSS may use grid (spaced with `grid-gap`), flexbox (spaced with margins), custom properties, `vw`/`vh`, `calc()`, `clamp()`/`min()`/`max()`, transforms, transitions, `@keyframes` and `conic-gradient()`. It must **not** use flexbox `gap` (or `row-gap`/`column-gap`), `aspect-ratio`, `:is()`/`:where()`/`:has()`, `:focus-visible`, `backdrop-filter`, `color-mix()`/`oklch()`/`lab()`, the `inset` shorthand, `@container`/`@layer` or `dvh`/`svh` units. `tokens.css` still holds resolved values only. `tools/tokens.test.ts` checks `wireframes/display.css` with the same scanner as `tests/browser-baseline.test.ts`.

### Layout

- **Units:** everything on the display is in `vh`/`vw`, so 1920×1080 and 1280×720 look identical (T-01).
- **Overscan-safe area:** some TVs crop up to 5% of each edge. Nothing that matters sits outside `--display-safe-x`/`--display-safe-y` (5%).
- **Frame:** a header strip (venue logo left; round, question pips right), the main area, and a footer with the host-voice line left and "Powered by Lock-In" right (T-10).
- **No interaction, no sound:** nothing on the display needs a remote, and nothing relies on audio (T-01, T-04).
- **Motion:** transforms and opacity only. The padlock snap, row entries and pulses are CSS keyframes that cost little on a low-powered smart TV.

### Legibility

The back of a pub is far from the display, so sizes come from viewing distance, not taste. "Comfortable" below means a capital letter subtends 16 arcminutes, a common minimum for reading signage. Text stays *legible* (but tiring) to about twice that distance. H is the screen height (a 55" TV is 0.685 m tall).

| Token | Size | Cap height | Comfortable to | 43" TV | 55" TV | 65" TV | Used for |
|---|---|---|---|---|---|---|---|
| `--display-text-hero` | 24vh | 16.0% | 34 H | 18 m | 24 m | 28 m | Timer, winner name |
| `--display-text-xxl` | 15vh | 10.0% | 22 H | 11 m | 15 m | 17 m | Room code |
| `--display-text-xl` | 11vh | 7.3% | 16 H | 8.4 m | 10.8 m | 12.8 m | Moment titles, "Answers locked" |
| `--display-text-l` | 8vh | 5.3% | 11.5 H | 6.1 m | 7.9 m | 9.3 m | Short question, revealed answer |
| `--display-text-m` | 6.5vh | 4.3% | 9.3 H | 5.0 m | 6.4 m | 7.5 m | Long question, options, leaderboard to 8 teams |
| `--display-text-s` | 5.4vh | 3.6% | 7.8 H | 4.1 m | 5.3 m | 6.3 m | Long picture question, leaderboard 9 to 30 teams, voice line |
| `--display-text-xs` | 4vh | 2.7% | 5.7 H | 3.1 m | 3.9 m | 4.6 m | Labels nobody needs from the back |
| `--display-text-credit` | 2.4vh | 1.6% | 3.4 H | 1.8 m | 2.4 m | 2.8 m | "Powered by Lock-In" only |

Question text steps by length so 200 characters always fit (T-03): text-only questions use **l** up to 90 characters and **m** from 91 to 200; picture questions use **m** up to 90 and **s** from 91 to 200. The picture takes the left half and is fitted, never cropped.

What this means for a pub: on a 55" TV, everything a team must read is comfortable to about 5 to 6 metres, and timer, lock and room code to 10 metres or more. Long picture questions are the weakest case. That is acceptable because the host reads every question aloud (N1) and every phone shows the question text too (P-05). A pub with a long room should use the biggest TV it has.

The simulation in [img/test-display-distance.png](img/test-display-distance.png) blurs the 20-team leaderboard and a 200-character picture question to what a person with 20/30 vision resolves at 8, 12 and 16 screen heights (`tools/distance.py`). Names, scores and question text survive at 12 H; small labels and the credit go first, as intended.

### Leaderboard density (T-06)

| Teams | Layout | Row text |
|---|---|---|
| 1 to 8 | One column; position, colour, name, joker mark, round score, movement, total | m |
| 9 to 20 | Two columns of 10; position, colour, name, joker mark, total | s |
| 21 to 30 | Two pages of up to 20, shown bottom up: places 21 to 30 first, then the top 20 | s |

Long names are cut with an ellipsis on the display only; the phone always shows the full name.

## Phone rules

- Dark by default in every theme; the branding screen warns on light backgrounds (branding.md).
- Every tap target is at least `--ph-tap` (52 px, above the brief's 44 px), with 10 px between neighbours.
- One-handed: the main action sits at the bottom, in thumb reach. Question text is 22 px, answers 18 px.
- The phone always says what the server has: "The quizmaster has *Wings*" after an answer is received, "Not sent" when it has not been, and "did not count" for a late answer (P-05, P-06, P-08).
- Plain words for every system state (joining closed, team already has a phone, offline). Host-voice lines are for flavour only and never carry information the team needs.

## Host console rules

- Built for non-technical staff on a laptop or a tablet in landscape (1024×768 and up). Every control is at least 44 px.
- **One obvious next step.** During a night the console always shows one big button for the next thing to do ("Start the quiz", "Lock now", "Reveal answers", "Show answer 3", "Show the leaderboard"), and a step line showing where the night is. Everything else is secondary.
- **"On the display now"** preview, so a host on a separate device knows what the room sees.
- **Answers on screen:** the console shows the question's answer while it runs (N1). If the host's laptop drives the display as a *mirrored* screen, the room would see it, so the console has a "Hide answers on this screen" switch. The run sheet should tell hosts to use an extended display, not a mirrored one.
- Teams panel with live status (answered, not yet, offline), so the host can see who to wait for (H-06, H-08).

The console layout works both with the host on the TV laptop (extended display) and on a separate device; Architecture's comparison of the two (N3) does not change it.

## Teams

- A team is always shown as a colour dot **plus** its name.
- Team colours come from `--team-1`..`--team-8` in join order and wrap after 8. They are fixed in `v1.0.0` (not on the branding screen), so they stay readable on any dark venue background.
- The joker mark is amber `JOKER` text, the same in every theme.

## Running the checks

```sh
bun test docs/design                     # tokens, derivation, display CSS baseline (11 tests)
bun docs/design/tools/sample-themes.ts   # regenerate the sample venue themes
node docs/design/tools/render.cjs         # re-render every wireframe to docs/design/img (needs Playwright)
python3 docs/design/tools/distance.py in.png out.png 12 1.5   # back-of-room simulation (needs Pillow)
```

The renders in `img/` were quantised to 128 colours to keep the repo small.
