# Lock-In: requirements

This is the feature list for Lock-In. It turns the candidate features in [BRIEF.md](BRIEF.md) and the decisions in [NOTES.md](NOTES.md) into ranked requirements. Where this file and the brief differ, this file wins. Design and Architecture build on it, and Review checks build PRs against the "Done when" criteria here.

## How to read this

### Ranks

| Rank | Meaning |
|---|---|
| **MVP** | Needed for the pilot night. Ships in `v1.0.0`, the version the pilot pub runs. |
| **Launch** | Not needed for the pilot, but needed before the public product launch. |
| **Later** | Wanted, with no milestone yet. |
| **Won't** | Deliberately left out. Revisit only with a new decision recorded in NOTES.md. |

### IDs and sources

Features are grouped by screen and numbered: `S` shared and server, `H` host console, `T` TV display, `P` team phone. IDs are stable: a cut feature keeps its number and moves rank instead of being renumbered. Each feature names its source: `B` for the brief, `N3` for topic 3 of the interview notes, `R` for features proposed in the Requirements thread and agreed by Cas, and `C` for features Cas added during the Requirements thread (2026-11-23).

Every MVP feature has a user story and "Done when" criteria. Each criterion is meant to be checkable by Review, by a test or by a short manual run-through.

### Words used here

- **Host**: whoever runs the night from the host console. Usually non-technical pub staff. Often also the **quizmaster (QM)**, who writes the questions.
- **Night**: one run of one quiz at a venue, from opening the lobby to Quiz End.
- **Quiz Start / Quiz End**: explicit host actions. Joining is open before Quiz Start and closed after it. Quiz End closes the night and saves its results to history.
- **Lock**: the moment answers stop being accepted. Per question (each question has its own timer) or per round (all the round's answers lock together).
- **Reveal**: showing the correct answers for a round, after marking.
- **Joker**: a team's choice of one round in which its points count double.
- **Round win**: the highest score in a round, joker included. Teams sharing the top score each get a round win.
- **Tie breaker**: the first way a points tie is settled. The team with more round wins ranks higher. No questions are asked.
- **Sudden death**: the second way, used only when the tie breaker leaves teams level. Tied teams answer one question at a time until exactly one of them is right.

## Pilot settings and defaults

A non-technical host must be able to run a night without opening a settings screen. Every option below has a default that works for a typical night (about 6 teams of 4). Options are set per quiz in the quiz builder unless marked "venue".

| Setting | Options in `v1.0.0` | Default | Source |
|---|---|---|---|
| Rounds | 1 to 20 | 6 | N2 |
| Questions per round | 1 to 30 | 5 | N2 |
| Halftime | After any round, or none | After round 3 (after round ⌈rounds ÷ 2⌉ for other lengths) | N2 |
| Lock mode | Per question, per round | Per question | N2 |
| Timer length | 10 to 300 seconds, per quiz, overridable per question | 60 seconds | N2, R |
| Joker | On, off | Off | N7, C |
| Maximum teams | 2 to 30 | 30 | N2 |
| Sudden death applies to | First place only, every tied place | First place only | N7 |
| Maximum sudden-death questions | 1 to 10 | 3 | N7 |
| Closest-number scoring | Closest team only, every team within a range | Closest team only | N7 |
| Prizes (venue, editable per night) | Free text per place, or none | None | N5 |
| Holding page starts (venue) | 0 to 120 minutes before the planned start | 30 minutes | C |
| Holding page panels (venue) | Countdown, teams, how to join, home-screen guide, brand animation, prizes | All on | C |
| Planned start time (per night) | A time, or none | None | C |

Fixed in `v1.0.0` (no setting): 1 point per question, no negative marking, speed never affects score, the joker doubles a round's points, joining closes at Quiz Start, one phone per team (a second phone is refused with a message, P-02), the tie breaker and when sudden death follows it (S-07), and how typed answers are auto-marked (H-10).

## Summary

| ID | Feature | Rank |
|---|---|---|
| S-01 | One binary, hosted and local modes | MVP |
| S-02 | Double-click start in local mode | MVP |
| S-03 | Host login | MVP |
| S-04 | Strict server-side lock | MVP |
| S-05 | Reconnect and rejoin | MVP |
| S-06 | Scoring and joker | MVP |
| S-07 | Positions, tie breaker and sudden death | MVP |
| S-08 | Event history from night one | MVP |
| S-09 | Quizzes and themes stored as plain files | MVP |
| S-10 | Copy pools | MVP |
| S-11 | Capacity | MVP |
| H-01 | Quiz library | MVP |
| H-02 | Quiz builder | MVP |
| H-03 | Question media and answer types | MVP |
| H-04 | Spelling check in the builder | MVP |
| H-05 | Open a night and run the lobby | MVP |
| H-06 | Manage teams | MVP |
| H-07 | Quiz Start and Quiz End | MVP |
| H-08 | Run questions and the timer | MVP |
| H-09 | Run a per-round lock | MVP |
| H-10 | Marking, moderation and the review queue | MVP |
| H-11 | Reveal and leaderboard | MVP |
| H-12 | Halftime | MVP |
| H-13 | Change a mark (disputes) | MVP |
| H-14 | Sudden death | MVP |
| H-15 | Prizes | MVP |
| H-16 | Venue branding | MVP |
| H-17 | Pre-quiz holding page settings | MVP |
| T-01 | Open the TV display | MVP |
| T-02 | Lobby | MVP |
| T-03 | Question | MVP |
| T-04 | Answers locked | MVP |
| T-05 | Reveal | MVP |
| T-06 | Leaderboard | MVP |
| T-07 | Halftime | MVP |
| T-08 | Sudden death | MVP |
| T-09 | Winner and goodbye | MVP |
| T-10 | Venue theme and credit | MVP |
| T-11 | Reconnecting | MVP |
| T-12 | Pre-quiz holding page | MVP |
| P-01 | Join a team | MVP |
| P-02 | One phone per team | MVP |
| P-03 | Waiting screens | MVP |
| P-04 | Play the joker | MVP |
| P-05 | Answer a question | MVP |
| P-06 | Answers locked | MVP |
| P-07 | Score and position | MVP |
| P-08 | Offline and rejoin | MVP |
| P-09 | Sudden death | MVP |
| P-10 | Add to home screen | MVP |

Launch, Later and Won't items are listed at the end of each screen's section.

---

## Shared and server

### S-01 One binary, hosted and local modes (MVP · B, N4)

As a venue, I want to run Lock-In from a single file, either on a server or on the host's laptop, so that there is one thing to install and update.

Done when:
- One build produces one executable per platform (Linux x64 for servers; Windows x64 and macOS arm64 for host laptops), with no runtime dependencies to install.
- The same executable runs in **hosted mode** (on a VPS behind a Cloudflare tunnel, the pilot setup) and **local mode** (on the host's laptop on the pub's network).
- In both modes, phones, TV and host console are served by that one process and talk only to it; no device talks to another device directly.
- In local mode, the night runs with no internet connection at all.
- The repo and the executable contain no secrets and no venue-specific data.

### S-02 Double-click start in local mode (MVP · N1)

As a non-technical host, I want to start Lock-In by double-clicking it, so that I never need a terminal on quiz night.

Done when:
- Double-clicking the executable on Windows or macOS starts the server and opens the host console in the default browser.
- No terminal input and no config file editing are needed, on first run or after.
- The host console shows the address and QR code that phones and the TV use, using the laptop's address on the local network.
- If the laptop has no usable network address, the host console says so in plain words.

### S-03 Host login (MVP · R)

As a host, I want the host console to need a password, so that nobody in the pub can take over the quiz from the link.

Done when:
- On first run, the host console asks the host to set a password before anything else.
- Every host console page and host action needs a signed-in session; the TV and phone pages never grant host actions.
- A signed-in host stays signed in on that device for the night (at least 24 hours) without re-entering the password.
- The password is never stored in plain text and never written to the repo.
- A host who forgets the password can reset it from the machine running Lock-In, with steps written in the release run sheet.

### S-04 Strict server-side lock (MVP · N4)

As a host, I want answers to count only if they reached the server before the lock, so that nobody can answer after the timer.

Done when:
- The server decides the lock time. An answer that arrives after the lock is rejected, and the phone is told it was too late.
- A team can change its answer any number of times before the lock; the last one received before the lock counts.
- Nothing the phone sends (clock, timestamps) can extend the lock.
- A test shows an answer sent 1 ms before the lock counts and one received after it does not.

### S-05 Reconnect and rejoin (MVP · B, N3, N4, N8)

As a team, host or TV, I want a dropped connection to resume where it left off, so that a Wi-Fi hiccup never costs a team its score or stops the night.

Done when:
- A phone that reconnects (same browser, same night) comes back as the same team with its name, answers, joker and score, with no input from the team.
- A team on a new phone can rejoin with its short rejoin code (P-08) or by the host moving it (H-06), keeping its name, answers and score.
- Rejoining an existing team works after Quiz Start; only new teams are blocked.
- The TV and host console reconnect on their own and show the current state of the night (current question, timer, leaderboard) without a reload by hand.
- While disconnected, each screen shows a clear "reconnecting" state (P-08, T-11, and on the host console).
- A restart of the server process during a night loses no answer the server had already accepted, and no mark or score.

### S-06 Scoring and joker (MVP · B, N7)

As a team, I want simple, fair scoring, so that I always know what a question is worth.

Done when:
- A correct answer scores 1 point. A wrong or missing answer scores 0. There is no negative marking and speed never affects score.
- Closest-number questions (and date or time questions set to closeness) score as set for the quiz (default: the closest team scores, and teams sharing the closest distance all score; option: every team within the question's range scores).
- A team's points in its joker round count double, including after any mark is changed.
- With the joker on, each team can play it once per night, on any round including the last, before that round starts.
- Sudden-death questions do not add to a team's score; they only decide the tied position.

### S-07 Positions, tie breaker and sudden death (MVP · N7, C)

As a host, I want the leaderboard order to follow clear rules, so that I never have to settle a tie by hand.

Ties are settled in two separate steps, each with its own name on screen:

1. **Tie breaker** (automatic, no questions): teams level on points rank by number of round wins (see "Round win" above).
2. **Sudden death** (H-14): only if teams are still level after the tie breaker, and only for a position sudden death applies to.

Done when:
- Teams rank by total points.
- Teams level on points are ranked by the tie breaker, and the leaderboard shows that the tie breaker decided it.
- Teams still level after the tie breaker share the position, unless sudden death applies to that position and decides it.
- A team still tied after the maximum sudden-death questions shares the position.
- Tests cover a shared round win, a joker round win and a three-way tie.

### S-08 Event history from night one (MVP · N5, N8)

As the venue, I want every night's results kept, so that a league or hall of fame can use real data later.

Done when:
- Quiz End saves the night's date, quiz, teams, every answer and mark, round scores, jokers, sudden-death results and final positions.
- Saved nights survive a server restart and are covered by the backup in the release plan.
- A host can see a list of past nights with their final standings. (League screens are Launch.)
- Nothing about individual players is stored; a team is a name and a device.

### S-09 Quizzes and themes stored as plain files (MVP · B, N6, N9)

As a QM or venue, I want quizzes and branding kept as plain files, so that they can be backed up, copied and kept in git.

Done when:
- Each quiz is saved as a plain-text file (Markdown or JSON, chosen by Architecture) plus its image files, written by the quiz builder.
- The venue theme is saved as a plain file plus its asset files, written by the branding screen (H-16).
- A quiz file copied into another Lock-In's data folder appears in that Lock-In's quiz library.
- The file formats are documented in TECH-SPEC.md.
- Live night state and history may use SQLite; quizzes and themes are never stored only in the database.

### S-10 Copy pools (MVP · B)

As a venue, I want the app to talk in a cheeky, warm host voice, so that the night feels like a pub quiz and not a test.

Done when:
- Each moment that has a pool in `docs/brand/copy.en.json` shows one random line from that pool, never the same line twice in a row.
- Placeholders `{team}`, `{pub}`, `{round}`, `{n}` and `{seconds}` are filled in, and a line whose placeholder has no value is skipped.
- A venue theme file can replace or add to any pool (editing pools in the branding screen is Launch).
- No line gives away an answer.

### S-11 Capacity (MVP · N2)

As a venue, I want the app to handle a busy night, so that it never slows down when the room is full.

Done when:
- A load test with 30 teams (one phone each), one TV and one host console runs a full 6×5 quiz with no dropped answers.
- At 30 teams, answers show as received on the host console within 1 second on the test server.
- Layouts are designed for up to 20 teams and still work at 30 (see T-06).

### Shared: Launch, Later and Won't

| ID | Feature | Rank | Source |
|---|---|---|---|
| S-20 | Licence chosen and added (recommendation: AGPL-3.0) | Launch | N9 |
| S-21 | Self-hosting guide for other venues | Launch | B |
| S-22 | Local-first phones: queue answers offline, sync late, host sees "synced late" to accept or reject | Later | N4 |
| S-23 | Reuse teams across nights | Later | N5 |
| S-24 | Know individual members across nights (conflicts with "no accounts"; decide first) | Later | N5 |
| S-25 | Player accounts or sign-in | Won't | B |
| S-26 | Devices talking to each other directly | Won't | N4 |

---

## Host console

The host console runs on a laptop or tablet. Whether the host's laptop also drives the TV or the host uses a separate device is analysed by Architecture before Design commits to a layout (N3); both must work.

### Building quizzes

#### H-01 Quiz library (MVP · N6)

As a QM, I want a list of my quizzes, so that I can write one a few days ahead and pick it on the night.

Done when:
- The host console lists saved quizzes with title, round count and last-edited date.
- The QM can create, open, duplicate, rename and delete a quiz. Delete asks for confirmation.
- A quiz with missing answers or empty rounds is marked as not ready, and cannot be used to open a night until fixed.

#### H-02 Quiz builder (MVP · B, N2, N6)

As a QM who writes questions on paper, I want a friendly screen to type them in, so that I never edit a file by hand.

Done when:
- The QM can add, edit, reorder and delete rounds and questions, give each round a title, and set the quiz settings in "Pilot settings and defaults".
- A new quiz starts with the default shape (6 rounds of 5 questions) and default settings, so the QM only fills in questions.
- Changes save automatically, and the QM can see they are saved.
- The builder works on a laptop and a tablet, with no hand-editing of Markdown or JSON.
- Questions cannot be edited while a night using that quiz is running (N6).

#### H-03 Question media and answer types (MVP · B, C)

As a QM, I want the question and answer types a real pub quiz uses, so that I can write the rounds I already run.

A question is its text plus optional media, and one answer type. Any media can go with any answer type.

Done when the builder supports this question media:
- **Text only.**
- **Image**: an uploaded image (JPEG, PNG or WebP, resized for the TV) shown with the question.
- (Sound and video clips are Launch, H-24 and H-25.)

And these answer types:
- **Free text**: one correct answer. More accepted answers can be added in the builder or while marking (H-10).
- **Multiple choice**: 2 to 6 options, one correct option.
- **Number**: a numeric answer, marked exact (correct or wrong).
- **Closest number**: a numeric answer scored by closeness (S-06); with "within range" scoring, the range is set per question.
- **Date or time**: the answer is a year, a date, or a time of day, chosen per question; the phone shows a matching input, and it is marked exact, or scored by closeness like closest number if the QM picks that.

And:
- Each question can have an optional host-only note (for example a pronunciation or a source).
- The quiz file format (S-09) leaves room for more media and answer types without breaking existing quizzes.

#### H-04 Spelling check in the builder (MVP · N6)

As a QM, I want spelling mistakes underlined while I type, so that I catch them before the night.

Done when:
- Question, option and answer fields use the browser's built-in spellcheck, so mistakes are underlined as the QM types.
- No spellcheck needs internet or an API key.
- (A grammar check is Later, H-31.)

### Running the night

#### H-05 Open a night and run the lobby (MVP · N8)

As a host, I want to open a night from a ready quiz and see teams arrive, so that I know when to start.

Done when:
- The host picks a ready quiz and opens a night; the TV and phones go to the lobby.
- The host console shows the room code, the join QR code, the TV address, and each team as it joins (name, colour, number of phones).
- Only one night runs at a time on one Lock-In.
- Prizes for the night can be set or changed here (H-15).
- The host can set the night's planned start time, which drives the holding page countdown (H-17). It is optional; without it, the holding page shows no countdown.

#### H-06 Manage teams (MVP · N8, R)

As a host, I want to fix team problems from the console, so that a rude name, a duplicate team or a dead phone never holds up the night.

Done when:
- The host can rename any team at any time; the new name shows on the TV and the team's phone.
- The host can remove a team before Quiz Start, after confirming.
- The host can move a team to a new phone: the console shows a one-time code or QR that the new phone opens, and the team keeps its name, answers and score. The old phone is disconnected.
- The host can see which teams are disconnected right now.

#### H-07 Quiz Start and Quiz End (MVP · N8)

As a host, I want clear start and end points, so that late teams cannot join and the night's results are saved.

Done when:
- Quiz Start closes joining for new teams (rejoining still works) and starts round 1. It needs at least one team.
- Quiz End is available after the last round (and sudden death, if any). It shows the winner screen on the TV, saves the night to history (S-08) and closes the night.
- Ending a night early asks for confirmation and still saves what happened.

#### H-08 Run questions and the timer (MVP · B, N1, N2, R)

As a host who reads each question aloud, I want the question and its answer in front of me and control over the timer, so that I can pace the room.

Done when:
- Before a round starts, the console shows which teams played their joker on it, and the host starts the round.
- The host shows the next question on the TV and phones. The console shows the question text, its answer, any host note, the timer and how many teams have answered (not what they answered, until marking).
- In per-question lock mode, the host starts the timer when ready; when it ends, that question locks (S-04). The host can also lock early.
- The host can pause and resume the timer and add 15 seconds, and the TV and phones follow within 1 second (plus TV lag).
- When every team has answered, the console says so; the timer keeps running until it ends or the host locks.

#### H-09 Run a per-round lock (MVP · N2)

As a host running a quiz in per-round lock mode, I want answers to stay open across the round and lock together, like collecting paper sheets.

Done when:
- In per-round mode the host shows the round's questions one at a time, and every question shown so far stays open for answers on the phones.
- After the last question, the host starts the round timer (the quiz's timer length) or locks the round straight away.
- When the round locks, all its answers lock together and the "answers locked" moment plays once.

#### H-10 Marking, moderation and the review queue (MVP · B, N1, N6, R, C)

As a host, I want the obvious answers marked for me and the borderline ones put in front of me, so that I mark each distinct answer only once.

Done when:
- Multiple-choice, number, closest-number and date or time answers are marked automatically when they lock.
- A typed answer that exactly matches an accepted answer after normalising (case, spaces, punctuation, accents and a leading "the", "a" or "an") is marked correct automatically.
- Every other typed answer goes to the review queue, grouped by distinct normalised answer, and close matches (fuzzy matching) are shown first with the nearest accepted answer.
- Accepting an answer adds it to the question's accepted answers and marks every team that gave the same normalised answer on that question correct. Rejecting marks them all wrong.
- The QM moderates equivalent answers that no fuzzy match would catch, such as "JFK" for "John F Kennedy": accepting "JFK" once marks every team that typed "JFK" (or "J.F.K.") correct on that question.
- The host can mark during a round (any locked question) or at the end of a round; both work in the same quiz.
- The round cannot be revealed until every answer in it is marked; the console shows how many are left.
- Accepted answers added while marking are saved back to the quiz file.

#### H-11 Reveal and leaderboard (MVP · B)

As a host, I want to reveal each round's answers and then the leaderboard, so that the room gets its moment after every round.

Done when:
- After marking, the host reveals the round's answers on the TV, one question at a time, and moves on when ready.
- After the reveal, the host shows the leaderboard on the TV; phones show each team its score and position.
- The host can skip the answer reveal and go straight to the leaderboard.

#### H-12 Halftime (MVP · B, N2)

As a host, I want a break after the set round, so that people can get to the bar.

Done when:
- After the halftime round's leaderboard, the TV shows halftime standings until the host starts the next round.
- A quiz with halftime set to "none" has no break.

#### H-13 Change a mark (disputes) (MVP · B)

As a host, I want to change a mark after the reveal, so that I can settle a dispute fairly.

Done when:
- The host can change any team's mark on any question until Quiz End.
- Scores, positions and the leaderboard update straight away, joker doubling included, and the TV shows the corrected leaderboard the next time it is shown.
- Each change is kept in the night's history.

#### H-14 Sudden death (MVP · N7)

As a host, I want a tie settled by sudden death, so that there is one winner when it matters.

Done when:
- After the last round, if teams are still tied after the tie breaker (S-07) for a position that sudden death applies to (first place by default), the console offers sudden death for those teams.
- Sudden-death questions are written in the builder in a separate sudden-death list per quiz, as typed-answer, multiple-choice or closest-number questions.
- Each sudden-death question goes only to the tied teams; other phones and the TV show that sudden death is on. If exactly one tied team is right, it takes the position; otherwise the next question is asked.
- After the maximum number of sudden-death questions (default 3), or if the sudden-death list runs out, the teams share the position.
- With more than two teams tied, a right answer from more than one team removes only the teams that were wrong, and sudden death goes on among the rest.

#### H-17 Pre-quiz holding page settings (MVP · C)

As a venue, I want the TV and phones to show a holding page before the quiz starts, so that the room knows when it starts and teams are ready on time.

Done when:
- The holding page shows from a set number of minutes before the planned start (venue setting, default 30) until Quiz Start; before that the TV shows the plain lobby (T-02).
- The venue chooses which panels it shows: countdown to the planned start, registered teams, how to join, how to add Lock-In to the phone's home screen (an animated guide, P-10), a brand animation, and prizes. All are on by default; panels with nothing to show (no prizes, no start time) are skipped.
- The panel set is open to more panels later without a new setting screen design.
- A night opened less than the set minutes before its start goes straight to the holding page.

#### H-15 Prizes (MVP · N5, C)

As a host, I want to show the night's prizes, so that teams know what they are playing for.

Done when:
- The host can enter optional prize text for one or more places (for example "1st: a bar tab"), set per venue and editable per night.
- The TV shows them in the lobby, on the holding page, at halftime and at the winner moment. Team phones show them in the lobby, at halftime and at the end of the night. With no prizes set, nothing about prizes shows.
- The app does not award or track prizes.

#### H-16 Venue branding (MVP · B, N9)

As a non-technical venue owner, I want to brand the quiz with my pub's name, logo and colours on a settings screen, so that it looks like our night, without editing a file.

Done when:
- A branding screen sets the venue name, logo (PNG, SVG or JPEG), main colours, display and body fonts (from a bundled set, or an uploaded font file), and TV background image or colour.
- A live preview shows the TV and phone with the changes before saving.
- Saving writes the theme file (S-09); the TV and phones use it from the next screen they show.
- The venue name fills `{pub}` in copy lines.
- Without venue branding, Lock-In's default theme is used.
- Theme choices that fail the readability rules in Design (contrast, size) show a warning, but are allowed.

### Host console: Launch, Later and Won't

| ID | Feature | Rank | Source |
|---|---|---|---|
| H-20 | League: weekly standings across nights | Launch | B, N5 |
| H-21 | Hall of fame | Launch | B, N5 |
| H-22 | Theme export and import | Launch | N9 |
| H-23 | Edit copy pools in the branding screen | Launch | N9, R |
| H-24 | Sound clips in questions (music rounds), with a "this round needs sound in the room" message in the builder | Launch | B, N3, C |
| H-25 | Video clips in questions, with the same sound message | Launch | N3, C |
| H-26 | Picture revealed bit by bit | Later | B |
| H-27 | Wager rounds | Later | B |
| H-28 | Bonus questions worth more than 1 point | Later | N7 |
| H-29 | Paper mode: type in scores from paper sheets | Later | B |
| H-30 | Import questions from the Open Trivia DB or other formats | Later | B, N6 |
| H-31 | Grammar check in the builder | Later | N6, R |
| H-32 | AI question generator, the QM reviews every question; optional, needs internet and an API key kept out of the repo | Launch | B, N6, C |
| H-33 | AI verifier: checks the QM's questions and answers for accuracy, same conditions | Launch | N6, C |
| H-34 | Editing questions during a night | Won't | N6 |
| H-35 | Name approval or a rude-word filter | Won't | N8 |
| H-36 | Awarding or tracking prizes | Won't | N5 |

---

## TV display

The TV is shared with the pub's normal use: the quiz takes it over for the night and hands it back. It may be an old smart-TV browser, a cast tab with a second or two of lag, or a laptop over HDMI.

### T-01 Open the TV display (MVP · N3)

As a host, I want to put the quiz on the TV by opening one address, so that nobody needs to use a TV remote during the night.

Done when:
- Opening the TV address (typed, or opened by casting from a laptop) shows the display for the current venue, with no sign-in.
- After it opens, it needs no interaction at all: every change is driven by the host console.
- It fills the screen at 1920×1080 and 1280×720 with no scrolling.
- It works on the smart-TV and casting setups listed by Architecture as supported, using basic CSS only, and is checked on at least one real smart-TV browser before `v1.0.0`.
- With no night open, it shows the venue's branding and a waiting screen.

### T-02 Lobby (MVP · B, N5)

As a team arriving at the pub, I want the TV to show me how to join, so that I can be playing in under a minute.

Done when:
- The TV shows a QR code and the room code, large enough to scan and read from across the room, plus the joined teams in their colours.
- It shows `lobby` and `team_joined` lines, and prizes when set.

### T-12 Pre-quiz holding page (MVP · C)

As a team arriving early, I want the TV to show when the quiz starts and how to get ready, so that we are set up before the first question.

Done when:
- From the set time before the planned start (H-17) until Quiz Start, the TV shows the holding page with the panels the venue chose, rotating or side by side as Design sets, while the join QR code and room code stay on screen.
- The countdown matches the server's clock to within 1 second (plus TV lag), and shows "starting soon" once it passes zero until the host presses Quiz Start.
- The home-screen guide is a short looping animation (GIF or CSS) for iPhone and Android, bundled with Lock-In, so it needs no internet in local mode.
- It needs no interaction and uses only basic CSS, like every TV screen (T-01).

### T-03 Question (MVP · B)

As a team, I want to see the question on the TV while the host reads it, so that the whole table can follow.

Done when:
- The TV shows the round, question number, question text, picture (if any), multiple-choice options (if any) and the timer.
- It shows how many teams have answered, but never what they answered.
- In the last 10 seconds it shows a `last_seconds` line.
- Question text up to 200 characters stays readable from the back of the room (size rules set by Design).

### T-04 Answers locked (MVP · B)

As a room, I want a big "answers locked" moment when time is up, so that the lock feels like the signature of the night.

Done when:
- When a question (or round) locks, a padlock snaps shut on the TV with a `locked` line, or an `all_locked` line if every team answered.
- The moment still makes sense if the TV shows it up to 2 seconds late; it never shows "locked" before the server has locked.
- It works on the supported TV browsers without relying on audio.

### T-05 Reveal (MVP · B)

As a room, I want the answers revealed one by one, so that every table gets its cheer or groan.

Done when:
- For each question in the round, the TV shows the question, then the correct answer when the host moves on, with a `reveal` line at the start of the reveal.
- It shows how many teams got each question right.

### T-06 Leaderboard (MVP · B, N2)

As a room, I want the standings after every round, so that the race stays exciting.

Done when:
- The TV shows every team's position, name, colour, total and that round's score, with a joker mark on teams whose joker was this round.
- Positions are revealed from the bottom up.
- It shows a `lead_change`, `big_climb` or `close_race` line when that applies (one line per leaderboard).
- Up to 20 teams fit on one screen and are readable from the back of the room; 21 to 30 teams still show, by paging or a smaller size.

### T-07 Halftime (MVP · B)

As a room, I want a halftime screen, so that the break has the standings up while people get drinks.

Done when:
- At halftime the TV shows the standings, a `halftime` line and prizes (when set) until the host starts the next round.

### T-08 Sudden death (MVP · N7)

As a room, I want sudden death to feel like an event, so that the tie-break is the tensest moment of the night.

Done when:
- Sudden death has its own look and copy (Design splits the `tiebreak` copy pool into a tie-breaker pool and a sudden-death pool), and names the tied teams.
- Each sudden-death question shows like T-03 and locks like T-04, then reveals which tied teams were right.
- It ends with the decided position, or the shared position if still tied.

### T-09 Winner and goodbye (MVP · B)

As a room, I want the winner crowned on screen, so that the night ends on a high.

Done when:
- At Quiz End the TV shows the winner with a `winner` line, then the final standings, the last-place team with a `last_place` line, prizes (when set), and a `goodbye` line.
- A shared first place names every winning team.

### T-10 Venue theme and credit (MVP · B, N9)

As a venue, I want the TV in my branding, so that the quiz feels like ours.

Done when:
- Every TV screen uses the venue theme (H-16) and shows a small "Powered by Lock-In" credit.
- With no venue theme, the default Lock-In theme is used.

### T-11 Reconnecting (MVP · N3, N4)

As a host, I want the TV to recover on its own, so that nobody has to touch it if the connection drops.

Done when:
- When the TV loses the server it shows a discreet "reconnecting" state over the last screen, keeps trying, and returns to the current screen on its own.
- It never needs a reload by hand after a drop or a server restart.

### TV: Launch, Later and Won't

| ID | Feature | Rank | Source |
|---|---|---|---|
| T-20 | League table and hall of fame screens | Launch | B, N5 |
| T-21 | Sound and video playback on the TV (with H-24, H-25) | Launch | B, N3, C |
| T-22 | Interaction on the TV (remote control input) | Won't | N3 |

---

## Team phone

One phone per team, opened from a QR code or room code in the phone's browser. No app and no account. Phones default to a dark screen because pubs are dim, and tap targets are at least 44 px.

### P-01 Join a team (MVP · B, N8)

As a team, I want to join by scanning the QR code and typing our name, so that we are in within a minute with nothing to install.

Done when:
- Scanning the QR code, or typing the room code at the join address, opens the join page in the phone's browser with no app and no sign-in.
- The team types a name (1 to 30 characters, unique in the night) and is in; the team gets a colour from the theme's team colours.
- After Quiz Start, a new team cannot join and is told so plainly; rejoining an existing team still works (P-08).
- When the maximum number of teams is reached, a new team is told so plainly.
- It works on the current and previous major versions of Safari on iOS and Chrome on Android.

### P-02 One phone per team (MVP · N8, C)

As a team, I want only our own phone to answer for us, so that nobody else can change our answers.

Done when:
- A second phone that tries to join an existing team, by typing the same name, is told plainly that this team already has a phone and is pointed to the rejoin code (P-08) if its team's phone has died.
- There is no viewer mode and no setting for this.

### P-03 Waiting screens (MVP · B)

As a team, I want the phone to show what is happening between questions, so that we never wonder if it is broken.

Done when:
- The phone shows a clear state for the lobby, waiting for the next question, marking, reveal, leaderboard, halftime and the end of the night.
- Before Quiz Start, the phone shows the countdown to the planned start (when set), the prizes (when set) and a link to the home-screen guide (P-10).

### P-04 Play the joker (MVP · B, N7)

As a team, I want to play our joker on the round we are best at, so that we can double those points.

Done when:
- Before each round starts, a team that has not played its joker can play it on that round, and must confirm.
- Once the round starts the joker cannot be played or changed for it.
- The phone shows whether the joker is still available, and on which round it was played.
- The TV shows a `joker_played` line when a team plays it.

### P-05 Answer a question (MVP · B, N2)

As a team, I want to type or tap our answer and change it until the lock, so that we can argue it out at the table.

Done when:
- The phone shows the question text, the timer and an input fitting the answer type: a text box for free text, buttons for multiple choice, a number box for number and closest number, and a year, date or time picker for date or time. Questions with an image show the image.
- The team can change its answer any number of times before the lock; the phone shows the answer the server has received.
- In per-round lock mode, the team can move between the round's open questions and answer them in any order.
- The phone works one-handed in a dim room: dark by default, text readable at arm's length, tap targets at least 44 px.

### P-06 Answers locked (MVP · B)

As a team, I want the phone to show "Answers locked" at the lock, so that we know our answer is in.

Done when:
- At the lock every team phone shows "Answers locked" with the answer it locked in, or that nothing was sent.
- An answer the server rejected as late is shown as not counted.

### P-07 Score and position (MVP · B)

As a team, I want to see our own score and place, so that we know where we stand without squinting at the TV.

Done when:
- When the leaderboard is shown, the phone shows the team's position, total, the round's score and whether the joker was played on it.
- After Quiz End it shows the final position.

### P-08 Offline and rejoin (MVP · B, N4, N8)

As a team whose phone dropped off the Wi-Fi, I want to get back in with everything intact, so that we never lose our score.

Done when:
- When the connection drops, the phone shows a clear "offline, reconnecting" state, keeps trying, and resumes on its own when the connection is back (S-05).
- The phone always shows the team's short rejoin code (on a team menu); entering it on another phone moves the team there with its name, answers and score.
- An answer typed while offline is not sent and is shown as not sent (queued answers are Later, S-22).

### P-09 Sudden death (MVP · N7)

As a tied team, I want to answer the sudden-death question on our phone, so that we can win it outright.

Done when:
- Only tied teams can answer each sudden-death question; their phone shows it like P-05.
- Other phones show that sudden death is on and which teams are in it.

### P-10 Add to home screen (MVP · C)

As a team that comes every week, I want Lock-In as an icon on my phone's home screen, so that it opens full screen like an app without a store.

Done when:
- The phone page is an installable web app (PWA): it has a web app manifest and icons, and opens full screen from the home screen on iPhone (Safari) and Android (Chrome), using the venue's name and logo.
- Installing it is optional: joining in the browser (P-01) works exactly the same without it.
- Opening it from the home screen goes to the current venue's join page, or straight back into the team's night if it is still running (S-05).
- A guide on the phone and on the holding page (T-12) shows how to add it on iPhone and Android.
- It does not queue answers offline (that is Later, P-20).

### Team phone: Launch, Later and Won't

| ID | Feature | Rank | Source |
|---|---|---|---|
| P-20 | Queue answers offline and sync late (with S-22) | Later | N4 |
| P-21 | Anti-Googling: flag a team that leaves the quiz tab | Later | B |
| P-22 | An app from an app store, or any install needed to play | Won't | B |
| P-23 | One player per phone, Kahoot-style | Won't | B |
| P-24 | Late joining of new teams after Quiz Start | Won't | N8 |
| P-25 | Viewer mode: teammates follow on their own phones | Won't | N8, C |

---

## Quality bar for every screen

These apply to all MVP features and are checked by Review on any PR that touches a screen.

- Bun and TypeScript on the server; vanilla JS and vanilla CSS in the browser; no frameworks and no runtime dependencies.
- The TV is readable from the back of a busy room, and does not rely on sound.
- Phones are dark by default with tap targets of at least 44 px.
- Every host-facing word is plain English that non-technical staff understand: no error codes or stack traces on screen.
- Every copy line comes from the copy pools (S-10).
- No secrets or venue-specific data are committed to the repo.
- `bun test` passes, and the output is in the PR.

## Open questions

- **Licence (S-20).** Still "decide later". It must be settled before `v1.0.0` (NOTES.md open questions), even though the licence file itself is ranked Launch.
- **Private pilot repo.** Recommendation stands: drop it, or keep it for venue data only, never a code fork. Cas to confirm.
- **Host on the TV laptop or a separate device.** Architecture analyses this before Design commits to a console layout (N3).
- **Host laptop platforms.** S-01 assumes Windows x64 and macOS arm64 for local mode. Cas to confirm what the pilot laptop runs.
- **Server restart mid-night.** S-05 reads "teams rejoin without losing their score" as also covering a server restart, so accepted answers, marks and scores are saved as they happen. Architecture to confirm the cost.
- **Smart-TV support list.** T-01 leaves the list of supported TV browsers and casting setups to Architecture, checked on real hardware before `v1.0.0`.
