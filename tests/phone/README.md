# Team phone tests (B7)

- `logic.test.ts`: the phone's pure helpers (`public/phone/logic.mjs`) against the team view fixtures: the screen for every fixture, answer values for every input type, joker rules, standings, saved team token.
- `routes.test.ts`: `/`, `/j/:roomCode`, `/m/:moveCode`, `/manifest.webmanifest` (with and without a venue theme) and `/sw.js` on a real test server, plus checks that the service worker's app shell lists only files that exist.
- `tools/render.cjs`: screenshots of every phone screen at 390×844 into `screens/` (evidence for Review, TECH-SPEC 13.3). It starts the fixture server and mocks the WebSocket, so it can also show join errors, rejoin, offline, "too late", the joker confirm and the menus. Run `node tests/phone/tools/render.cjs`.
- `screens/`: where render.cjs writes, `phone-fixture-<name>.png` for each fixture in `tests/fixtures/views/team/` and `phone-<state>.png` for the scripted states. Not committed: the screenshots of every client in a real night come from `tests/e2e/design-shots.ts`.
