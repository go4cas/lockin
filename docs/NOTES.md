# Lock-In: decisions and findings

Decisions from the Interview thread (and findings from later threads). Each entry says what was decided, why, and what it affects. Nothing here overrides REQUIREMENTS.md or TECH-SPEC.md once those exist; later threads update this file when a decision changes.

## Interview decisions

### 1. Who hosts (2026-11-23)

- **Host is non-technical pub staff by default.** Anything the host touches must be usable without tech knowledge. Cas may host, but design for staff.
- **Starting Lock-In is double-click.** No terminal, no config editing on the night. Affects Architecture (local-mode launch, first-run setup) and Release (run sheet).
- **Host reads questions aloud and the TV shows them too.** The TV is not a substitute for the host's voice, and the host console needs the question text (and the answer) in front of the host.
- **Marking happens both ways:** the host can mark during the round (between questions) or at the end of a round. Neither model is the only one; the console must support both.

### 2. Shape of a night (2026-11-23)

- **Team count, rounds, questions per round and quiz length are all configurable** by the quizmaster per quiz. Nothing is hard-coded.
- **Halftime placement follows from the number of rounds** (the quizmaster sets it; no fixed rule).
- **Lock timing is a config option: per question or per round.** Per question: each question has its own timer and locks on its own. Per round: answers stay open across the round and lock together at the end, like collecting paper sheets. Affects the "answers locked" moment (once per question vs once per round), reveal flow and the WS protocol.
- **Pilot pub sizing:** a typical night is about 6 teams of 4 people.
- **Default quiz: 6 rounds of 5 questions** (30 questions), configurable. Halftime defaults to after round 3 (assumption, not stated by Cas).
- **Design target (assumption, proposed by the interviewer, not contested):** layouts and load tests aim for up to 20 teams, with the app still working at 30. The TV leaderboard must stay readable at 20 teams.

### 3. The TV (2026-11-23)

- **Support at least smart-TV browsers and casting** as ways to get the TV display on screen. HDMI from a laptop is assumed to work anyway since it is just a browser.
- **The TV is shared.** Assume most pubs use the TV for streaming, ads ("spots") and music, so the quiz takes over the TV for the night and hands it back; it is not a dedicated quiz screen.
- **Host location: support both** the host laptop driving the TV and the host on a separate device, **but analyse before designing**. Architecture should compare the setups before Design commits to one console layout.
- **Do not assume the pub has speakers.** When the quizmaster creates a music or video round, the app shows a message telling them the round needs sound in the room.

Findings to carry forward (interviewer's notes, not decisions):
- Smart-TV browsers are often old engines with weak font, CSS and audio support and fussy remote-control input. The TV view should rely on basic CSS and must not need any interaction after it opens.
- Tab casting usually needs desktop Chrome and adds lag; a Fire stick does not cast a browser tab. The "answers locked" moment must look right with a second or two of lag on the TV.
- A smart TV or cast receiver must reach the Lock-In server, so it has the same network question as the phones (topic 4).

### 4. Network: local or hosted (2026-11-23)

- **The pilot runs in hosted mode** (VPS behind Cloudflare).
- **Pilot pub:** guest Wi-Fi with a password; good mobile signal inside.
- **"Local first" means the client devices, not local mode.** A client (team phone at least) keeps working when its connection to the server breaks and syncs when it comes back. Hosted is still the pilot mode; local mode stays in the one binary for venues that can use it.
- **Local-first clients are not MVP.** They are a Later feature. For Later, the interviewer's proposed rule (not yet agreed): the phone queues answers offline, the server accepts a late-synced answer only before that question or round is revealed, and the host sees it flagged "synced late" to accept or reject. Reason: a phone's clock cannot prove when an answer was typed, so an unflagged late answer invites Googling.
- **MVP behaviour (interviewer's default, stated to Cas):** the lock is strict and server-side; an answer counts only if it reached the server before the lock. A phone that loses its connection shows a clear "offline, reconnecting" state, and on reconnect the team gets back its identity, answers and score (the brief's "rejoin without losing score" core feature). TV and host console show "reconnecting" and resume where they left off.

How the devices connect (explained to Cas): no device talks to another device directly. Phones, TV and host console each talk only to the Lock-In server.
- Hosted: every device needs internet to reach the VPS. Guest isolation on the Wi-Fi does not matter. If the pub's internet drops, phones on mobile data carry on; the host laptop and TV (on pub Wi-Fi) lose the server until they reconnect.
- Local: the server is the host's laptop, so phones and TV must reach the laptop across the pub's Wi-Fi. No internet needed, but guest isolation (common on guest networks) blocks it outright, and phones on mobile data cannot reach it.

## Open questions

_Collected as the interview goes._
