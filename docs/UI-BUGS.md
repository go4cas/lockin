# UI bugs from real-device testing

Found by Cas while testing v0.2.0 on real devices (console on a laptop, display on a Google TV
casting device, phones), from 2026-11-24. Each is reproduced against `main` in
`tests/e2e/ui-bugs-browser.ts` (part of the browser checks) before it is fixed.

| # | Where | Bug | Cause | Status |
|---|---|---|---|---|
| UI-01 | Console, Run night, Open a night | A quiz that is not ready shows "[object Object]" instead of why, and "1 rounds". | The lobby joined the server's problem objects (`{ path, message }`) as strings; the counts were not pluralised. | Fixed: shows the first two problem messages; "1 round", "1 question". |
