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
- UI-12, phone date questions show mm/dd/yyyy on a US-locale phone: the native picker follows the phone's own date settings, which is what its owner reads every day; the answer is sent as an ISO date either way. Left as it is unless Cas wants a day/month/year picker.

## Host console review on v0.3.0 (Last Call), batch 1 (Cas, 2026-11-26)

| # | Where | Report | Finding | Status |
|---|---|---|---|---|
| UI-14 | Console nav | The first nav item says "Library", but the page says "Quizzes". | Naming. | Fixed: the nav item, the home page text and the Run night link say "Quizzes". |
| UI-15 | Branding, Main colour | The colours are a set list; what if the pub's colour is not in it? | Any colour already works (the big square is a colour picker); the dots are suggestions only. Nothing on the page said so. | Fixed: a colour-code field next to the square (type #c8102e) and a line saying any colour works. |
| UI-16 | Console, unsaved changes | Leaving with unsaved changes shows the browser's own alert. | Browsers allow only their own prompt on reload or closing the tab. Links inside the console can use our own dialog. | Fixed: nav links and Sign out ask in the design system's dialog ("Leave without saving?"); reload and close keep the browser's prompt. Branding and the quiz builder use it. |
| UI-17 | Flip countdown | The numbers just change; expected a flip. The gap between the top and bottom halves looks too big. | No animation; the hinge was a 2 px (TV 0.45vh) band. | Fixed: the lower flap falls into place on each change (260 ms, off with reduced motion); the hinge is a 1 px line. |
| UI-18 | Branding, Prizes tab | The Prizes section is empty. | Going from Holding page to Prizes threw an Arrow error ("getNode(...).after is not a function") and left the tab blank. | Fixed: the three tabs are built once and shown or hidden. |
| UI-19 | Branding, preview | Are the preview cards the team's view or the TV as well? | Both: the left card is the TV, the right one a team's phone. Not labelled. | Fixed: captions "The TV" and "A team's phone". |

Questions answered, not changed:

- **Is the host console meant to work on a phone?** No: it is designed for a laptop (1280 px) and a tablet (768 to 1024 px), as the brief and DESIGN-SYSTEM.md say. A phone layout is a scope choice for Cas.
- **Holding page panels, why 12 seconds?** A fixed design value (`PANEL_MS`), long enough to read a panel from across the room. Making it a venue setting is a scope choice for Cas.
