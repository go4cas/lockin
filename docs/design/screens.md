# Screens

Every wireframe, by screen, with the requirement it covers. Open the live wireframe with `wireframes/<file>.html?s=<id>`; the image is the same frame rendered by `tools/render.js` (TV at 1280×720, phone at 390×844, host at 1366×768). The moments these screens belong to are described in [moments.md](moments.md).

## TV display (`wireframes/tv.html`)

| Id | Screen | Covers | Image |
|---|---|---|---|
| `idle` | Waiting screen, no night open: logo, venue name, a tagline | T-01 | [tv-idle](img/tv-idle.png) |
| `lobby` | QR, address, room code, joined teams, prizes | T-02, H-15 | [tv-lobby](img/tv-lobby.png) · [Brass & Oak](img/tv-lobby--brass-and-oak.png) |
| `holding-countdown` | Holding page: countdown panel, fixed join panel | T-12 | [tv-holding-countdown](img/tv-holding-countdown.png) |
| `holding-homescreen` | Holding page: home-screen guide panel | T-12, P-10 | [tv-holding-homescreen](img/tv-holding-homescreen.png) |
| `round-intro` | Round title, jokers played on it | H-08, P-04 | [tv-round-intro](img/tv-round-intro.png) |
| `question` | Short text question, timer, answered count | T-03 | [tv-question](img/tv-question.png) · [Neon Taproom](img/tv-question--neon-taproom.png) |
| `question-long` | 198-character text-only question (size m) | T-03 | [tv-question-long](img/tv-question-long.png) |
| `question-image` | 190-character question with a picture (size s) | T-03, H-03 | [tv-question-image](img/tv-question-image.png) |
| `question-mc` | Multiple choice, four options | T-03 | [tv-question-mc](img/tv-question-mc.png) |
| `last-seconds` | Last 10 seconds: main-colour timer, `last_seconds` line | T-03 | [tv-last-seconds](img/tv-last-seconds.png) |
| `locked` | Answers locked: padlock snap | T-04 | [tv-locked](img/tv-locked.png) · [Neon Taproom](img/tv-locked--neon-taproom.png) |
| `marking` | Round is in, host is marking | H-10, P-03 | [tv-marking](img/tv-marking.png) |
| `reveal` | Answer reveal, teams-right dots | T-05 | [tv-reveal](img/tv-reveal.png) |
| `reveal-mc` | Multiple-choice reveal | T-05 | [tv-reveal-mc](img/tv-reveal-mc.png) |
| `leaderboard-reveal` | Leaderboard mid-reveal, bottom up | T-06 | [tv-leaderboard-reveal](img/tv-leaderboard-reveal.png) |
| `leaderboard` | 6 teams: joker tag, tie-breaker tag, movement, round points | T-06, S-07 | [tv-leaderboard](img/tv-leaderboard.png) · [Brass & Oak](img/tv-leaderboard--brass-and-oak.png) |
| `leaderboard-20` | 20 teams in two columns | T-06 | [tv-leaderboard-20](img/tv-leaderboard-20.png) |
| `leaderboard-30` | 30 teams: page of places 21 to 30 | T-06, S-11 | [tv-leaderboard-30](img/tv-leaderboard-30.png) |
| `halftime` | Halftime, standings, prizes | T-07, H-15 | [tv-halftime](img/tv-halftime.png) |
| `deadlock-intro` | Sudden death intro: Deadlock face-off | T-08 | [tv-deadlock-intro](img/tv-deadlock-intro.png) |
| `deadlock-question` | Sudden-death question | T-08 | [tv-deadlock-question](img/tv-deadlock-question.png) |
| `deadlock-result` | Sudden-death result, place decided | T-08 | [tv-deadlock-result](img/tv-deadlock-result.png) |
| `winner` | Winner, first prize | T-09, H-15 | [tv-winner](img/tv-winner.png) |
| `final` | Final standings, last place, goodbye | T-09 | [tv-final](img/tv-final.png) |
| `reconnecting` | Reconnecting pill over the last screen | T-11 | [tv-reconnecting](img/tv-reconnecting.png) |

## Team phone (`wireframes/phone.html`)

| Id | Screen | Covers | Image |
|---|---|---|---|
| `join` | Join: team name, room code filled in from the QR | P-01 | [phone-join](img/phone-join.png) |
| `join-taken` | Team already has a phone | P-02 | [phone-join-taken](img/phone-join-taken.png) |
| `join-closed` | Joining closed after Quiz Start | P-01 | [phone-join-closed](img/phone-join-closed.png) |
| `lobby` | Lobby: countdown, prizes, home-screen card | P-03, P-10, H-15 | [phone-lobby](img/phone-lobby.png) · [Neon Taproom](img/phone-lobby--neon-taproom.png) |
| `homescreen` | Home-screen guide, iPhone and Android tabs | P-10 | [phone-homescreen](img/phone-homescreen.png) |
| `menu` | Team menu: rejoin code, joker status | P-08, P-04 | [phone-menu](img/phone-menu.png) |
| `joker` | Play the joker before a round | P-04 | [phone-joker](img/phone-joker.png) |
| `q-text` | Free text, answer received | P-05 | [phone-q-text](img/phone-q-text.png) |
| `q-mc` | Multiple choice, selected and sent | P-05 | [phone-q-mc](img/phone-q-mc.png) · [Brass & Oak](img/phone-q-mc--brass-and-oak.png) |
| `q-number` | Closest number, last seconds, not sent yet | P-05 | [phone-q-number](img/phone-q-number.png) |
| `q-date` | Year answer with steppers | P-05 | [phone-q-date](img/phone-q-date.png) |
| `q-round` | Per-round lock: tabs between open questions | P-05, H-09 | [phone-q-round](img/phone-q-round.png) |
| `locked` | Answers locked, with the locked-in answer | P-06 | [phone-locked](img/phone-locked.png) |
| `locked-none` | Locked: late answer did not count | P-06, S-04 | [phone-locked-none](img/phone-locked-none.png) |
| `waiting` | Marking and reveal: eyes on the TV | P-03 | [phone-waiting](img/phone-waiting.png) |
| `score` | Own position, total, round points | P-07, S-07 | [phone-score](img/phone-score.png) |
| `halftime` | Halftime standings and prizes | P-03, H-15 | [phone-halftime](img/phone-halftime.png) |
| `deadlock-in` | Sudden death, this team answering | P-09 | [phone-deadlock-in](img/phone-deadlock-in.png) |
| `deadlock-watch` | Sudden death, watching | P-09 | [phone-deadlock-watch](img/phone-deadlock-watch.png) |
| `end` | Final position and prize | P-07, H-15 | [phone-end](img/phone-end.png) |
| `offline` | Offline banner, answer not sent | P-08 | [phone-offline](img/phone-offline.png) |

Notes for the build:

- **Answer inputs:** free text uses a text box with `autocomplete`, `autocorrect` and `spellcheck` off (so phones do not "fix" a band name); numbers use `inputmode="numeric"`; dates and times use the phone's native picker; years use a number box with − and + steppers. A question with a picture shows it above the text, full width, tap to enlarge.
- **Send model:** free text and numbers have a Send button (so half-typed answers are not sent); multiple choice sends on tap. Either way the strip under the input always shows what the server holds.
- **Team menu** (⋮, top right on every screen after joining) holds the rejoin code, joker status and the home-screen guide.

## Host console (`wireframes/host.html`)

| Id | Screen | Covers | Image |
|---|---|---|---|
| `library` | Quiz list with ready / not ready, open a night | H-01 | [host-library](img/host-library.png) |
| `builder` | Rounds and questions, answer types, accepted answers, host note, spellcheck | H-02, H-03, H-04 | [host-builder](img/host-builder.png) |
| `lobby` | Night lobby: join details, TV address, planned start, prizes, teams, Start | H-05, H-06, H-15 | [host-lobby](img/host-lobby.png) |
| `run` | Running a question: answer, timer controls, teams, next step | H-08 | [host-run](img/host-run.png) |
| `marking` | Review queue, grouped by distinct answer | H-10 | [host-marking](img/host-marking.png) |
| `reveal` | Reveal steps, change a mark | H-11, H-13 | [host-reveal](img/host-reveal.png) |
| `deadlock` | Sudden death control | H-14 | [host-deadlock](img/host-deadlock.png) |
| `branding` | Venue branding, live preview, readability warnings | H-16 | [host-branding](img/host-branding.png) |
| `holding` | Holding page settings | H-17 | [host-holding](img/host-holding.png) |

Not drawn, because they follow the same patterns: past nights (a table like the library, S-08), the host password screens (S-03), prize editing (a list of place and text), and the night menu (rename, move to a new phone, remove a team, end the night early, all with confirmation where H-06 and H-07 ask for it).

Notes for the build:

- **Layout:** a sidebar for building and settings; a full-width "night" layout with a top bar (round, question, room code, TV and team connection status) and a right column (TV preview, teams, the next-step button) while a night runs.
- **Tablet:** at 1024 px the right column narrows to 300 px and the step line wraps; nothing else changes.
- **Destructive actions** (delete quiz, remove team, end early) use outlined red buttons and a confirmation; they are never the next-step button.
