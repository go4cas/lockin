# Browser checks

Lock-In's real-browser checks, with their tooling pinned here (code review LI-018). This
folder is development tooling only: the app never imports it, the binary does not embed
it, and the root `package.json` keeps only `typescript` and `@types/bun` (TECH-SPEC 3.1).
Cas agreed this separate package on 2026-11-24.

- `package.json` and `bun.lock` pin Playwright, which pins the Chromium build it drives.
- `playwright.cjs` / `playwright.mjs` are the only way the checks load Playwright. They load
  it from this folder by path, so a global install is never used by mistake, and they say
  what to run when Playwright or its Chromium is missing.
- `tsconfig.json` typechecks the browser checks with the real Playwright types.
- `checks.ts` runs every check, as CI's `browser` job does.

## Run them

From the repository root:

```sh
bun install --cwd tools/browser --frozen-lockfile
bun run --cwd tools/browser install-browser      # Chromium for the pinned Playwright
bun run --cwd tools/browser typecheck
bun run --cwd tools/browser checks               # screenshots in dist/browser-checks
```

On Linux, CI uses `playwright install --with-deps chromium` to add the system libraries too.

## What runs

| Check | What it is |
|---|---|
| `tests/e2e/browser-night.ts` (lock per question, then per round) | Integration: a real server, the console signs in on the login page, pairs the display, four phones join from the QR link and answer through their UI, the server is killed mid-question and every page reconnects, marking, reveal, sudden death, winner, history, close. |
| `tests/e2e/review-fixes-browser.ts` | Integration: a silent network (LI-001), a picture changed between two nights (LI-003), a phone draft across nights (LI-008), a branding save race (LI-007). |
| `tests/e2e/audit-batch2-browser.ts` | Integration: a TV paired by code fetches its QR with the token in a header, never in a URL (SA-11); "Open display" from the console is paired by the session with no token (D5); one display unpaired from the console's list; sign-out unpairs the console's display. |
| `tests/e2e/ui-bugs-browser.ts` | Integration: the UI bugs found on real devices (docs/UI-BUGS.md), one check each. |
| `tests/display/stress.cjs` | Stress: 400 random phase changes per seed on the display, through the fixture server. |

Each fails on a page error, a console error, a failed request or a screen that does not move on.

Not part of the checks, and kept separate on purpose:

- **Screenshot harnesses** (`tests/phone/tools/render.cjs`, `tests/display/screenshots.cjs`)
  mock the server. They show presentation, not the integration. They load Playwright the same way.
- **Design review screenshots** (`tests/e2e/design-shots.ts`) walk a whole night against a real
  server and capture every client at its real sizes, with an index (docs/DESIGN-SYSTEM.md, section 7).
- **Physical phones, the pub TV and the cast device** stay a release sign-off.
