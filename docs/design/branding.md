# Venue branding

How a venue makes Lock-In look like its own night (H-16, T-10), and how that reaches the screens. Staff set it on a settings screen; nobody edits a file (N9).

## The chain

```
Branding screen (host console)  ->  data/theme/theme.json  ->  GET /theme.css  ->  TV and phones
   venue staff pick values           stored inputs (TECH-SPEC)    --brand-* tokens     use --color-* roles
```

1. **The branding screen** collects a few plain inputs and shows a live preview of the TV and a phone ([img/host-branding.png](img/host-branding.png)).
2. **theme.json** stores only those inputs. Its format is owned by TECH-SPEC (`lockin.theme/1`); every field is optional and `null` means "use Lock-In's default".
3. **/theme.css** is written by the server: it re-declares the `--brand-*` tokens on `:root`, after [tokens.css](tokens.css), using the inputs plus the derived values below, and adds `@font-face` rules for the chosen fonts.
4. **Screens** never read `--brand-*` directly. They use the `--color-*` roles in tokens.css, which point at the brand tokens.

Only `--brand-*` tokens change per venue. Team colours, the joker mark, sudden-death colours, sizes, spacing and motion are Lock-In's own and stay fixed in `v1.0.0`.

## Inputs

| Branding screen label | theme.json field | Sets | Default | Notes |
|---|---|---|---|---|
| Venue name | `name` | `{pub}` in copy lines; name next to the logo on TV and phone; the PWA name (P-10) | none | Without a name, lines with `{pub}` are skipped (S-10), and the TV shows the logo alone. |
| Logo | `logo` | Header on every TV screen, join page, PWA icon | Lock-In mark | PNG, SVG or JPEG. See "Logo". |
| Background colour | `colours.background` | `--brand-bg` | `#17191b` blackboard | Should be dark (warning otherwise). |
| Text colour | `colours.text` | `--brand-text` | `#edeae2` chalk | |
| Main colour | `colours.accent` | `--brand-accent` | `#ff7a5c` coral | Buttons, the padlock, "Answers locked", the leader's row. |
| Second colour | `colours.accent2` | `--brand-accent-2` | `#3cc6b8` teal | Timers, "received", right answers, host-voice lines. |
| Headline font | `fonts.display` | `--brand-font-display` | `caveat-brush` | Bundled id or uploaded file. Moment titles and voice lines only. |
| Body font | `fonts.body` | `--brand-font-body` | `atkinson-hyperlegible` | Bundled id or uploaded file. Everything else. |
| TV background | `tvBackground` | `--brand-tv-bg` or `--brand-tv-bg-image` + `--brand-tv-scrim` | the background colour | A colour, or a picture under a scrim. |
| (Launch, H-23) | `copy` | copy pools | `docs/brand/copy.en.json` | Pool overrides can sit in the file in `v1.0.0`; the editing screen is Launch. |

## Derived tokens

The server (for /theme.css) and the branding screen (for its preview) compute these from the four colours. `mix(a, b, w)` is a straight sRGB mix, `a + (b - a) × w` per channel, rounded; it matches CSS `color-mix(in srgb, a, b w)`, which old TVs lack, so values are always resolved. The reference implementation is [tools/derive.ts](tools/derive.ts); tests compare it with tokens.css.

| Id | Token | Rule | Default result |
|---|---|---|---|
| D1 | `--brand-surface` | `mix(background, text, 3%)` | `#1d1f21` |
| D2 | `--brand-surface-2` | `mix(background, text, 8%)`: panels, chips, buttons | `#282a2b` |
| D3 | `--brand-line` | `mix(background, text, 16%)`: dividers | `#393a3b` |
| D4 | `--brand-text-muted` | `mix(text, background, 32%)`; if that is under 4.5:1 on surface-2, move it toward text in 4% steps until it passes (or equals text) | `#a9a7a2` |
| D5 | `--brand-on-accent`, `--brand-on-accent-2` | whichever of background and text has more contrast with that accent | `#17191b` both |
| D6 | `--brand-accent-soft`, `--brand-accent-2-soft` | `mix(background, accent, 18%)`: highlight fills | `#412a27`, `#1e3837` |
| D7 | `--brand-tv-scrim` | background colour at 78% opacity when a TV picture is set, else transparent | `rgba(0, 0, 0, 0)` |
| | `--brand-tv-bg` | `tvBackground.colour`, else background | `#17191b` |
| | `--brand-tv-bg-image` | `url(...)` of `tvBackground.image`, else `none` | `none` |

## Readability warnings

H-16: choices that may be hard to read show a warning but can still be saved. The branding screen runs `checkReadability()` from [tools/derive.ts](tools/derive.ts) on every change and lists any problem in plain words above the Save button, with a "Reset to Lock-In colours" link.

| Check | OK at | Strong warning below | Message |
|---|---|---|---|
| Text on background | 7:1 | 4.5:1 | Text may be hard to read from the back of the room. |
| Text on panels (surface-2) | 7:1 | 4.5:1 | Text on panels may be hard to read from the back of the room. |
| Main colour on background | 3:1 | 2:1 | The main colour may not stand out from the background. |
| Second colour on background | 3:1 | 2:1 | The second colour may not stand out from the background. |
| Labels on main colour | 4.5:1 | 3:1 | Button labels may be hard to read on the main colour. |
| Labels on second colour | 4.5:1 | 3:1 | Labels may be hard to read on the second colour. |
| Background brightness (relative luminance) | ≤ 0.05 | > 0.2 | A light background glares in a dim pub and makes phones hard to use. |

7:1 for text (not 4.5:1) because the TV is read from far away in a dim, busy room. The sample `too-light` theme in `wireframes/themes/` trips six of the seven checks and is what the branding wireframe shows.

Team colours are fixed and tested only against Lock-In's default background. On a dark venue background they stay readable; a venue that picks a light background gets the brightness warning, which covers this too.

## Logo

- Shown at the left of the TV header (header height 9vh, logo 80% of it), large on the TV waiting screen, at the top of the join page, and as the PWA icon.
- Best as a light logo on transparent background (SVG or PNG). The branding screen previews it on the chosen background so a dark-on-transparent logo that disappears is obvious.
- The PWA icon needs a square; the server places the logo centred on the background colour with 15% padding at 192 and 512 px (P-10). Architecture to confirm how images are resized with no runtime dependencies (H-03 has the same need).
- Without a logo, the Lock-In padlock mark is used.

## Fonts

Bundled in `v1.0.0`, so screens never depend on an outside font service (and local mode, now Later, will need no internet). All are SIL Open Font Licence 1.1; the licences sit next to the files in [fonts/](fonts/).

| Font id | Family | Use | Look |
|---|---|---|---|
| `caveat-brush` | Caveat Brush | Display (default) | Chalk, handwritten |
| `alfa-slab-one` | Alfa Slab One | Display | Pub sign, traditional ("Brass & Oak") |
| `bebas-neue` | Bebas Neue | Display | Tall capitals, bar neon ("Neon Taproom") |
| `atkinson-hyperlegible` | Atkinson Hyperlegible | Body (default, the only bundled body font); can also be picked as display | Plain, made for legibility |

The branding screen shows the display fonts by look ("Chalk", "Sign", "Neon", "Plain") with a sample, plus "Upload a font" (WOFF2, WOFF or TTF). Uploaded body fonts get a warning, because legibility at distance matters more than style for questions and names.

The bundled files are the Latin subset, which covers English and Afrikaans accents. Team names with other scripts or emoji fall back to the device's own fonts.

## TV background

- A colour (defaults to the background colour), or a picture.
- A picture is shown with `background-size: cover` under the D7 scrim, so text keeps its contrast. The branding screen says: "Busy photos make questions harder to read. Pick something calm."
- Sudden death ignores the TV background and uses its own fixed look (moments.md).

## What a venue cannot change (in v1.0.0)

- The "Powered by Lock-In" credit on every TV screen (T-10). It is small (2.4vh) and bottom right.
- Team colours, the joker mark, the sudden-death look, sizes and spacing. These keep every venue's night readable and recognisably Lock-In.
- Dark-by-default phones: a light background is allowed but warned.
