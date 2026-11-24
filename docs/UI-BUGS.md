# UI bugs from real-device testing

Found by Cas while testing v0.2.0 on real devices (console on a laptop, display on a Google TV
casting device, phones), from 2026-11-24. Each is reproduced against `main` in
`tests/e2e/ui-bugs-browser.ts` (part of the browser checks) before it is fixed.

| # | Where | Bug | Cause | Status |
|---|---|---|---|---|
| UI-01 | Console, Run night, Open a night | A quiz that is not ready shows "[object Object]" instead of why, and "1 rounds". | The lobby joined the server's problem objects (`{ path, message }`) as strings; the counts were not pluralised. | Fixed: shows the first two problem messages; "1 round", "1 question". |
| UI-02 | Phone, lobby after joining | "Name your team. Choose wisely, it goes on the telly." shows to a team that already has a name. | The phone lobby screen showed the `lobby` pool, which copy-review.md gives to the join page and the display only. | Fixed: the joined lobby shows no lobby line (the "Welcome, {team}" toast still shows). |

## Checked, not bugs

- TV header "Round 1 · Round Number 1": the round's own title follows the number; this quiz's round was titled "Round Number 1".
- TV shows "1:00" while the phone says "Timer not started": both mean the host has not started the timer yet; the TV shows the full time dimmed.
- Join page "Quiz night at Lock-In": the default venue name until one is set in Branding.
