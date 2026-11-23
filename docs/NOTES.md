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
- _Follow-up pending:_ default values and the largest night the app must handle (sizing target for TV leaderboard layout and load testing).

## Open questions

_Collected as the interview goes._
