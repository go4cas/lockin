# UI bugs from real-device testing

Found by Cas while testing v0.2.0 on real devices (console on a laptop, display on a Google TV
casting device, phones), from 2026-11-24. Each is reproduced against `main` in
`tests/e2e/ui-bugs-browser.ts` (part of the browser checks) before it is fixed.

| # | Where | Bug | Cause | Status |
|---|---|---|---|---|
| UI-01 | Console, Run night, Open a night | A quiz that is not ready shows "[object Object]" instead of why, and "1 rounds". | The lobby joined the server's problem objects (`{ path, message }`) as strings; the counts were not pluralised. | Fixed: shows the first two problem messages; "1 round", "1 question". |
| UI-02 | Phone, lobby after joining | "Name your team. Choose wisely, it goes on the telly." shows to a team that already has a name. | The phone lobby screen showed the `lobby` pool, which copy-review.md gives to the join page and the display only. | Fixed: the joined lobby shows no lobby line (the "Welcome, {team}" toast still shows). |
| UI-03 | Display, a 6-option multiple-choice question (1920x1080) | The question slides up under the header and option F is cut off. | Full-size question text and options beside the big timer column; `justify-content: center` pushes overflow off the top. | Fixed: 5 or 6 options move the timer into the meta row (as a picture question does), the question steps down a size, options use the small size; the body centres with auto margins, which never push content above the top. Same for the reveal and Deadlock. |
| UI-04 | Display, leaderboard and halftime with 8 teams | The 8th row is cut off; halftime prizes are cut off at the bottom. | 8 rows at full height plus the title is taller than the screen; the halftime column did not shrink. | Fixed: one-column standings rows shrink to fit, the title is one size down above 6 teams; halftime prizes are one line each at the small size. |
| UI-05 | Display, lobby team chips | About 4 of 8 teams show, with no "+N more". | Big chips up to 8 teams, one per line; the overflow was hidden silently. | Fixed: big chips only up to 4 teams; chips that do not fit are hidden whole and counted as "+N more". |
| UI-06 | Display, Reconnecting pill | Overlaps the round strip in the header. | The pill sat at the top right of the safe area, where the strip is. | Fixed: it sits just under the header. |
| UI-07 | Display, round intro | "Round 1 of 2" shows twice (header and above the title). | The strip repeated the centre line. Also a round titled "Round 1" read "Round 1 Round 1" in the strip (Cas's TV photo). | Fixed: no strip on the round intro; the strip shows "Round 2 · Music and Film" and skips a title that only repeats the number. |
| UI-08 | Display, holding page | A `team_joined` line seemed to stay long after the join. | Not reproduced: the line goes after 6 s (FLASH_MS); the screenshot was taken within 6 s of the join. | Kept as a regression check. |
| UI-09 | Display and phone, leaderboard | Three joint new leaders read "A, B and C has entered the chat". | `lead_change` lines are singular. | Fixed: new pool `lead_change_shared` for joint leaders (like `winner_shared`). |
| UI-10 | Display, waiting screen | The tagline "Answers locked. Next round's on you." reads like a game state when no quiz is running. | Copy. | Fixed: that tagline is removed. |
| UI-11 | Console, Run night at 1280x800 | The teams list shows 7 of 8 teams and needs a scroll, with empty space below it. | The list was capped at 45vh. | Fixed: on a laptop the side panel is the window's height and the list takes all its free room. |
| UI-13 | Display, reveal tally dots | "5 of 8 teams got it" with 6 dots filled (and "2 of 8" with 7). | The dots were keyed by position only, so a reused dot kept the previous question's colour. | Fixed: the key carries the state. |

## Checked, not bugs

- TV header "Round 1 · Round Number 1": the round title only repeated the number; now skipped (UI-07).
- TV shows "1:00" while the phone says "Timer not started": both mean the host has not started the timer yet; the TV shows the full time dimmed.
- Join page "Quiz night at Lock-In": the default venue name until one is set in Branding.
- UI-12, phone date questions show mm/dd/yyyy on a US-locale phone: the native picker follows the phone's own date settings, which is what its owner reads every day; the answer is sent as an ISO date either way. Cas (2026-11-26): keep the phone's picker and say what is asked. Now a line under the picker reads "Pick the day, month and year. Your phone shows them in its own order." (time: "Pick the hours and minutes.", year: "Type the year, like 1969, or use − and +.").

## Host console review on v0.3.0 (Last Call), batches 1 to 3 (Cas, 2026-11-26)

| # | Where | Report | Finding | Status |
|---|---|---|---|---|
| UI-14 | Console nav | The first nav item says "Library", but the page says "Quizzes". | Naming. | Fixed: the nav item, the home page text and the Run night link say "Quizzes". |
| UI-15 | Branding, Main colour | The colours are a set list; what if the pub's colour is not in it? | Any colour already works (the big square is a colour picker); the dots are suggestions only. Nothing on the page said so. | Fixed: a colour-code field next to the square (type #c8102e) and a line saying any colour works. |
| UI-16 | Console, unsaved changes | Leaving with unsaved changes shows the browser's own alert. | Browsers allow only their own prompt on reload or closing the tab. Links inside the console can use our own dialog. | Fixed: nav links and Sign out ask in the design system's dialog ("Leave without saving?"); reload and close keep the browser's prompt. Branding and the quiz builder use it. |
| UI-17 | Flip countdown | The numbers just change; expected a flip. The gap between the top and bottom halves looks too big. | No animation; the hinge was a 2 px (TV 0.45vh) band. | Fixed: the lower flap falls into place on each change (260 ms, off with reduced motion); the hinge is a 1 px line. |
| UI-18 | Branding, Prizes tab | The Prizes section is empty. | Going from Holding page to Prizes threw an Arrow error ("getNode(...).after is not a function") and left the tab blank. | Fixed: the three tabs are built once and shown or hidden. |
| UI-19 | Branding, preview | Are the preview cards the team's view or the TV as well? | Both: the left card is the TV, the right one a team's phone. Not labelled. | Fixed: captions "The TV" and "A team's phone". |

| UI-20 | Venue settings, holding page panels | A panel that is switched off disappears from the list. | The row's "off" class clashed with a shared `.off { display: none }` rule. | Fixed: the row uses its own class, so it stays in the list, dimmed. |
| UI-21 | Console nav | The nav says "Branding"; everything else says "Venue settings". | Naming. | Fixed: the nav item and the page title say "Venue settings". |
| UI-22 | Venue settings, holding page panels | "Brand animation": how does a venue upload that? What if they want a static picture, like a "Live music on Thursday" poster? | The panel was Lock-In's own mark animation, nothing to upload. Cas: one panel is enough. | Fixed: one "Poster" panel. The venue uploads a picture (JPEG, PNG or WebP, up to 5 MB) on the Holding page tab; without one the panel shows the Lock-In mark and a tagline. Venue files that say "animation" load as "poster". |
| UI-23 | Holding page | Why 12 seconds per panel? Why not a setting? | It was a fixed design value. Cas: a setting, 12 s by default. | Fixed: "Show each panel for N seconds" (5 to 60) on the Holding page tab; the display uses it. |
| UI-24 | Run night on a phone | Is the host console meant to work on a phone? | It was built for laptop and tablet. On a 390 px phone the Night menu was off screen, the quiz list squashed and tables cut off. Cas: a phone layout for Run night only. | Fixed: under 600 px the run header keeps the room and the Night menu (the phase steps hide), marking stacks, quiz rows stack and wide tables scroll sideways. The top nav scrolls sideways on every console page. |
| UI-25 | Venue settings, Prizes | Why prizes under Venue settings and per quiz? | Prizes belong to the night, not the quiz: the venue's are defaults that fill in "Prizes tonight" when a night opens, changeable for that night only (H-15). Cas: call them defaults. | Fixed: the tab is "Default prizes" and says how they are used. |
| UI-26 | Pair a display | Why under Run night and not Venue settings? | Pairing lasts across nights, so it is a setup task too. Cas: agreed to both. | Fixed: a "Displays" tab in Venue settings with the same card (pair, list, unpair one or all), usable at any time; Run night keeps it for pairing on the spot. |
| UI-27 | Quiz builder | The left nav is messy and not in line with the other nav; the quiz settings inputs are all over, compared with Venue settings. | The builder had its own head and a mixed outline (quiz, rounds, sudden death, wrapped question text); its settings sat in a loose two-column grid with full-width segments. The design system names no left nav beyond "outline + editor"; the design canvas shows a title with Rounds · Sudden death · Settings tabs. Cas chose a slim left list over collapsibles. | Fixed: the builder has Venue settings' page head (title, the same tab bar: Rounds, Sudden death, Settings). The left list holds only the tab's rounds or questions, one line each with a number. Settings drops the list and uses Venue settings' cards (Quiz, Answers, Rounds and teams, Ties), short inputs with their unit, hints under. Shared `.page-head` and `.form-card` in host.css. |

Questions answered, not changed:

- **Is the host console meant to work on a phone?** It was designed for a laptop and a tablet; Cas chose a phone layout for Run night only (UI-24). The other pages stay laptop and tablet.
- **Holding page panels, why 12 seconds?** Now a venue setting (UI-23).

## Host console review on v0.3.1, batch 4 (Cas, 2026-11-27)

| # | Where | Report | Finding | Status |
|---|---|---|---|---|
| UI-28 | Host console, display, phone | Show the version on the host, the TV and the phones. | Only the server log and `lockin --version` showed it. | Fixed: the "Powered by Lock-In" credit ends with the running server's version (v0.3.1), read once from `/api/ping` by `LockIn.version` in shared/source.js (now loaded by the display too). |
| UI-29 | Quiz builder, question | "Add a picture" is not vertically centred. | The shared `.field > label` rule made the button label a block, so its text sat at the top. | Fixed: that rule skips `label.btn`. |
| UI-30 | Host console | The header should be sticky. | The nav scrolled away with the page. | Fixed: the top nav, and Run night's header while a night is open, stay at the top; the builder outline and the Venue settings preview stick under it. |
| UI-31 | Quiz builder, Settings | The Settings tab is messy; arrange it by the design system. | Labels sat above controls of mixed widths, unpicked segment options floated with no outline, units were body size. | Fixed: the design canvas's field grid: the label in a 200 px left column, the control and its hint on the right, a hairline between rows, units small and grey, segments outlined in cards. Readiness is a row, "Ready to run". Shared as `.form-card.cols`. |
| UI-32 | Host home page | Add the artwork to the landing page, with the app name and logo in the right branding. | The home page was a heading and one line. | Done: Cas's animated "Last orders" artwork (inline SVG and CSS, no JavaScript or outside files) beside the Lock-In lockup, a tagline and buttons to Run night, Quizzes and Venue settings. Its mint and coral are the venue colour and the ember token, so a pub's colour shows in it; the beer mat says "LOCK-IN". With reduced motion it is a still frame. CSS in public/host/home.css. |
| UI-33 | Venue settings | Should defaults (rounds, questions, timings) live in Venue settings rather than be hard-coded? | New quizzes always started with 6 rounds of 5 and the built-in settings. Cas chose a Quiz defaults tab (2026-11-27). | Done: a "Quiz defaults" tab: rounds, questions per round and every quiz setting (lock, timer, halftime, joker, most teams, closest scoring, sudden death). `venue.json` gains `quizDefaults` (TECH-SPEC 5.4, additive: older files take the built-in values). A new quiz starts with them; quizzes that exist keep their own. |
| UI-34 | Quizzes | Do we need sections, search? | One list of every quiz, newest edit first. Cas chose a search box and a ready filter (2026-11-27). | Done: "Search by title" (ignores case and accents) and All / Ready / Needs work with counts; "No quizzes match" with Show all. |

Questions answered, not changed:

- **Quizzes list: limited or filtered?** No. It lists every quiz in the data folder, most recently edited first. A quiz has no date (a night does, and past nights are in History), so active, past and future sections do not fit quizzes as they are. Cas chose search and a ready filter instead (UI-34).
- **Builder: do questions crowd the left list?** Only the open round's questions show under it; the other rounds are one line each. Ten rounds of twelve shows ten round lines plus twelve question lines at most.
- **"Saved" when changes save themselves?** It is the auto-save status: "Opening…", "Saving…" (about a second after typing), "Saved", or "Not saved" in red when a save failed or a problem stops it. A banner says what to do when the quiz was changed elsewhere.

## Host console review on v0.3.1, batch 5 (Cas, 2026-11-27)

| # | Where | Report | Finding | Status |
|---|---|---|---|---|
| UI-35 | Host console | Add loading indicators in place of text, in line with the design. | Pages said "Loading quizzes…", "Connecting to Lock-In…", "Opening the quiz…"; buttons said "Saving…" and "Uploading…". The design system has no loader, so it follows the mark and the Status component (Active). | Fixed: a loader drawn from the Lock-In mark (its ring with the venue arc turning; it pulses with reduced motion) replaces the page and panel loading text, which is still read out to screen readers. Save and upload buttons show a small one with "Saving" or "Uploading"; the builder's status pill shows it in the Active colour. `public/host/loading.js`, `.loading`/`.spin` in host.css. |
| UI-36 | Host console | Pages have different margins: some left aligned, some with bigger margins. | Most pages were capped at 1280 px and centred, so on a wide screen they started further in than the nav; the builder and Run night ran full width with their own 28 px gutter; Quizzes had a bigger title. | Fixed: one gutter for the nav and every page (32 px laptop, 20 px tablet, 16 px phone, `--host-gutter`) and one top (`--host-top`); pages are left aligned to the nav; every page title is the 44 px console title. |
| UI-37 | Host console | Selects use the browser's look. | `select.input` kept the native arrow and light list. | Fixed: no native arrow, an Ash chevron, the field's box and radius, a dark option list. |

Questions answered, not changed:

- **A venue picture library for posters and other uploads?** Today each picture has one use (logo, TV picture, poster), uploaded where it is used. Cas (2026-11-27): not now, after 1.0. When built, it is a new venue concept, so the file format, its validator, TECH-SPEC and docs change together.

## Host console review on v0.3.3, batch 6 (Cas, 2026-11-27)

| # | Where | Report | Finding | Status |
|---|---|---|---|---|
| UI-38 | Host console | Pages sit too far to the left; bigger side margins. | UI-36 put every page on a 32 px gutter at any width, so a wide screen had a long empty right side. | Fixed: the nav and every page are one centred column of at most 1200 px with at least 48 px each side (`--host-max`, `--host-gutter`); 20 px on a tablet, 16 px on a phone. |
| UI-39 | Host console | Should the loading indicators be centred? | They sat at the left edge. | Fixed: a loader is centred in what it stands for; a page's loader takes half the screen's height. |
| UI-40 | Host console, selects | Selects still look like the browser's. | The live build had the styled box (no-cache with ETags, so not a stale file); the open list was still the operating system's, which a page could not style before customizable select. | Fixed where the browser allows it (Chrome and Edge 135 and later): the open list is the design system's Menu (Smoke, radius 12, 44 px rows, a venue-colour tick). Safari and Firefox keep their own list under the styled box. |
