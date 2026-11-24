<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/design/logo/lockin-mark.svg">
    <img src="docs/design/logo/lockin-mark-on-light.svg" alt="Lock-In logo: a padlock with a question mark" width="100">
  </picture>
</p>

<h1 align="center">Lock-In</h1>

<p align="center"><em>Lock in your answers.</em></p>

Lock-In is a pub quiz app. Teams answer on their phones, the quiz plays on the pub's display, and the host runs the night from a laptop or tablet. It is open source, and each venue can brand it with its own name, logo, colours and fonts.

> **Status:** early development, heading for a first pilot night. Proper docs and a landing page are on the way.

## Features

- **Teams play on their phones.** Scan the QR code, join with the room code, no app store needed (installable as a PWA).
- **The quiz runs on the big screen.** Questions, timers, reveals and the leaderboard on the pub display.
- **The host stays in control.** Build quizzes, run the night, mark answers, settle disputes and handle tie breakers from one console.
- **Answers lock for real.** Locking is enforced by the server, so there are no take-backs.
- **Venue branding.** Every screen picks up the venue's look, set from a settings screen rather than by editing files.

## Stack

Bun and TypeScript on the server, vendored [ArrowJS](https://www.arrow-js.com/) and plain CSS in the browser, no runtime dependencies, shipped as a single binary.

## Running it locally

You need [Bun](https://bun.sh) 1.4.x.

```sh
bun install        # dev dependencies (TypeScript types only)
bun run dev        # start the server from source at http://localhost:8080, restarts on change
bun test           # run the test suite
bun run typecheck  # type-check the project
bun run build      # compile the single binary to dist/
```

Open `http://localhost:8080/host` for the host console. On first start the server log prints a setup code, which you use to set the host password. Data is kept in `./lockin-data`. To try it from phones on the same Wi-Fi, run `bun run dev -- --bind 0.0.0.0 --public-url http://<your laptop's address>:8080`.

`bun run fixtures` starts a fixture server for working on screens without running a quiz.

## Docs

- [Brief](docs/BRIEF.md): where it started
- [Requirements](docs/REQUIREMENTS.md): what each screen does, ranked for the first release
- [Tech spec](docs/TECH-SPEC.md): architecture, data formats and the build plan
- [Design](docs/design/README.md): tokens, venue branding, wireframes and key moments
- [Notes](docs/NOTES.md): decisions made along the way

## Licence

To be decided.
