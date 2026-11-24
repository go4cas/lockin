# Screens

Every wireframe, by screen, with the requirement it covers. Open the live wireframe with `wireframes/<file>.html?s=<id>`; the image is the same frame rendered by `tools/render.cjs` (display at 1280×720, phone at 390×844, host at 1366×768). The moments these screens belong to are described in [moments.md](moments.md).

## Display (`wireframes/display.html`)

| Id | Screen | Covers | Image |
|---|---|---|---|
| `idle` | Waiting screen, no night open: logo, venue name, a tagline | T-01 | [display-idle](img/display-idle.png) |
| `lobby` | QR, address, room code, joined teams, prizes | T-02, H-15 | [display-lobby](img/display-lobby.png) · [Brass & Oak](img/display-lobby--brass-and-oak.png) |
| `holding-countdown` | Holding page: countdown panel, fixed join panel | T-12 | [display-holding-countdown](img/display-holding-countdown.png) |
| `holding-homescreen` | Holding page: home-screen guide panel | T-12, P-10 | [display-holding-homescreen](img/display-holding-homescreen.png) |
| `round-intro` | Round title, jokers played on it | H-08, P-04 | [display-round-intro](img/display-round-intro.png) |
| `question` | Short text question, timer, answered count | T-03 | [display-question](img/display-question.png) · [Neon Taproom](img/display-question--neon-taproom.png) |
| `question-long` | 198-character text-only question (size m) | T-03 | [display-question-long](img/display-question-long.png) |
| `question-image` | 190-character question with a picture (size s) | T-03, H-03 | [display-question-image](img/display-question-image.png) |
| `question-mc` | Multiple choice, four options | T-03 | [display-question-mc](img/display-question-mc.png) |
| `last-seconds` | Last 10 seconds: main-colour timer, `last_seconds` line | T-03 | [display-last-seconds](img/display-last-seconds.png) |
| `locked` | Answers locked: padlock snap | T-04 | [display-locked](img/display-locked.png) · [Neon Taproom](img/display-locked--neon-taproom.png) |
| `marking` | Round is in, host is marking | H-10, P-03 | [display-marking](img/display-marking.png) |
| `reveal` | Answer reveal, teams-right dots | T-05 | [display-reveal](img/display-reveal.png) |
| `reveal-mc` | Multiple-choice reveal | T-05 | [display-reveal-mc](img/display-reveal-mc.png) |
| `leaderboard-reveal` | Leaderboard mid-reveal, bottom up | T-06 | [display-leaderboard-reveal](img/display-leaderboard-reveal.png) |
| `leaderboard` | 6 teams: joker tag, tie-breaker tag, movement, round points | T-06, S-07 | [display-leaderboard](img/display-leaderboard.png) · [Brass & Oak](img/display-leaderboard--brass-and-oak.png) |
| `leaderboard-20` | 20 teams in two columns | T-06 | [display-leaderboard-20](img/display-leaderboard-20.png) |
| `leaderboard-30` | 30 teams: page of places 21 to 30 | T-06, S-11 | [display-leaderboard-30](img/display-leaderboard-30.png) |
| `halftime` | Halftime, standings, prizes | T-07, H-15 | [display-halftime](img/display-halftime.png) |
| `deadlock-intro` | Sudden death intro: Deadlock face-off | T-08 | [display-deadlock-intro](img/display-deadlock-intro.png) |
| `deadlock-question` | Sudden-death question | T-08 | [display-deadlock-question](img/display-deadlock-question.png) |
| `deadlock-result` | Sudden-death result, place decided | T-08 | [display-deadlock-result](img/display-deadlock-result.png) |
| `winner` | Winner, first prize | T-09, H-15 | [display-winner](img/display-winner.png) |
| `final` | Final standings, last place, goodbye | T-09 | [display-final](img/display-final.png) |
| `reconnecting` | Reconnecting pill over the last screen | T-11 | [display-reconnecting](img/display-reconnecting.png) |

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
| `waiting` | Marking and reveal: eyes on the display | P-03 | [phone-waiting](img/phone-waiting.png) |
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
| `lobby` | Night lobby: join details, display address, planned start, prizes, teams, Start | H-05, H-06, H-15 | [host-lobby](img/host-lobby.png) |
| `run` | Running a question: answer, timer controls, teams, next step | H-08 | [host-run](img/host-run.png) |
| `marking` | Review queue, grouped by distinct answer | H-10 | [host-marking](img/host-marking.png) |
| `reveal` | Reveal steps, change a mark | H-11, H-13 | [host-reveal](img/host-reveal.png) |
| `deadlock` | Sudden death control | H-14 | [host-deadlock](img/host-deadlock.png) |
| `branding` | Venue branding, live preview, readability warnings | H-16 | [host-branding](img/host-branding.png) |
| `holding` | Holding page settings | H-17 | [host-holding](img/host-holding.png) |

Not drawn, because they follow the same patterns: past nights (a table like the library, S-08), the host password screens (S-03), prize editing (a list of place and text), and the night menu (rename, move to a new phone, remove a team, end the night early, all with confirmation where H-06 and H-07 ask for it).

Notes for the build:

- **Layout:** a sidebar for building and settings; a full-width "night" layout with a top bar (round, question, room code, display and team connection status) and a right column (display preview, teams, the next-step button) while a night runs.
- **Tablet:** at 1024 px the right column narrows to 300 px and the step line wraps; nothing else changes.
- **Destructive actions** (delete quiz, remove team, end early) use outlined red buttons and a confirmation; they are never the next-step button.
