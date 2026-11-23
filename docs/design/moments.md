# Key moments

Each moment as the room experiences it, across all three screens at once. The host console drives every change; the TV never needs input. Copy pools are named in `code` (see [copy-review.md](copy-review.md)). Images are in [img/](img/).

Two rules apply to every moment:

- **The TV may be up to 2 seconds late** (casting, old TVs). Nothing on the TV is timed against the phones or the host; each screen plays its moment when its own message arrives. A moment never shows before the server's event (T-04).
- **Nothing relies on sound** (T-04, N3).

## 1. Join (T-02, P-01, P-02, H-05)

| TV | Phone | Host |
|---|---|---|
| QR code (40vh) and room code (15vh, readable across the room) on the left; `lobby` line as the headline; joined teams as colour chips; prizes when set. A `team_joined` line replaces the footer line each time a team joins. | The QR opens the join page with the room code filled in. One field: team name. "Join the quiz" at the bottom. | Room code, QR, the join address and the TV address; teams as they join; planned start; prizes; "Start the quiz". |

Room codes use only `BCDFGHJKMNPQRSTVWXZ` (TECH-SPEC), so nothing on the TV can be misread as 0/O or 1/I. The join page refuses a second phone for a team with a plain explanation and points to the rejoin code ([img/phone-join-taken.png](img/phone-join-taken.png)), and after Quiz Start explains that joining has closed ([img/phone-join-closed.png](img/phone-join-closed.png)).

Images: [tv-lobby](img/tv-lobby.png), [phone-join](img/phone-join.png), [host-lobby](img/host-lobby.png).

## 2. Pre-quiz holding page (T-12, H-17, P-03, P-10)

The TV splits in two: a **rotating panel** on the left and a **join panel** on the right that never moves (QR, address, room code), as T-12 requires.

- Panels take turns every 12 seconds with a short cross-fade: countdown, teams, how to join, home-screen guide, brand animation, prizes. Panels with nothing to show (no start time, no prizes) are skipped. Dots under the panel show the rotation.
- The countdown is server time to the planned start, `mm:ss` at 30vh. At zero it reads "Starting soon" until the host presses Start.
- The home-screen guide is a looping animation of the iPhone and Android steps (bundled, CSS or GIF), next to two numbered steps in plain words.
- Phones in the lobby show the same countdown, the prizes and a "Put the quiz on your home screen" card that opens the guide.

Images: [tv-holding-countdown](img/tv-holding-countdown.png), [tv-holding-homescreen](img/tv-holding-homescreen.png), [phone-lobby](img/phone-lobby.png), [phone-homescreen](img/phone-homescreen.png), [host-holding](img/host-holding.png).

## 3. Round start and the joker (H-08, P-04)

- **Phones** (joker on): before each round, a team with its joker still in hand sees "Play your joker on Movies?" with what it does and that it cannot be changed. Two buttons: "Play joker on Movies" (amber) and "Not this round". Teams that already played it see the round title and a waiting state.
- **TV:** the round title huge ("Movies"), "Round 3", a `round_start` line, and the teams that played their joker on this round as chips with a `JOKER` tag. Each time a team plays it, the footer shows a `joker_played` line.
- **Host:** sees who played the joker, then starts the round.

Images: [tv-round-intro](img/tv-round-intro.png), [phone-joker](img/phone-joker.png).

## 4. Question and the last ten seconds (T-03, P-05, H-08)

- **TV:** question text in the size step for its length (README), the timer as big digits plus a bar draining along the bottom, and "4 of 6 answered". Never what anyone answered.
- **Last 10 seconds:** digits and bar turn the main colour, the digits pulse, and the footer shows a `last_seconds` line.
- **Timer at zero, before the lock arrives:** the bar is empty and the digits hold at 0. Nothing says "locked" until the lock message arrives.
- **Phones:** timer bar and seconds at the top, the question, the input for its answer type, and a "received" strip that echoes what the server holds. In per-round lock mode, numbered tabs move between the round's open questions; a dot marks the ones sent.
- **Host:** the question, the answer, the host note, timer controls (pause, +15 s, lock now), the teams panel, and "Lock now" as the next step.

Images: [tv-question](img/tv-question.png), [tv-question-long](img/tv-question-long.png), [tv-question-image](img/tv-question-image.png), [tv-question-mc](img/tv-question-mc.png), [tv-last-seconds](img/tv-last-seconds.png), [phone-q-text](img/phone-q-text.png), [phone-q-mc](img/phone-q-mc.png), [phone-q-number](img/phone-q-number.png), [phone-q-date](img/phone-q-date.png), [phone-q-round](img/phone-q-round.png), [host-run](img/host-run.png).

## 5. Answers locked: the signature (T-04, P-06)

The lock is Lock-In's signature, so it is the one moment with real choreography. It plays once per question (per-question mode) or once per round (per-round mode, H-09).

**TV** (total about 1.6 s, then holds):

| Time | What happens |
|---|---|
| 0 ms | Lock message arrives. Question and timer fade out (150 ms). |
| 150 ms | The Lock-In padlock (a "?" in its body) appears with its shackle **open** (lifted 16 units). |
| 150 to 850 ms | The shackle **snaps down** (`--ease-snap`, overshoots and settles) and the body thuds (scale 1.06 and a 2° twist, then back). |
| 450 ms | A ring in the main colour bursts out from the padlock and fades (900 ms). |
| 600 ms | "Answers locked" (11vh, main colour) and the `locked` line (or `all_locked` when every team answered) fade up under it, with "5 of 6 teams answered". |
| hold | Until the host moves on. |

Because the animation starts on the TV's own copy of the lock message, a TV running 2 seconds late plays the same moment 2 seconds late; it never runs ahead.

**Phones:** the same padlock, static and closed, "Answers locked", and a card "You locked in: *Wings*". If nothing reached the server before the lock, the phone says so in plain words and shows no host-voice line (no teasing a team that lost its connection). A late answer shows as "did not count" (S-04).

**Host:** the question row turns to "locked", and the next step becomes "Show question 3" (or "Mark round 3" after the last question).

Images: [tv-locked](img/tv-locked.png), [tv-locked--neon-taproom](img/tv-locked--neon-taproom.png), [phone-locked](img/phone-locked.png), [phone-locked-none](img/phone-locked-none.png).

## 6. Marking (H-10)

- **TV:** a small closed padlock, "Round 3 is in", "The quizmaster is marking. Answers next." and a `reveal` line.
- **Phones:** "Eyes on the TV" with the same message.
- **Host:** the review queue. Each distinct typed answer appears once, with every team that gave it, close matches first and labelled with the accepted answer they are near ("close to *Wings*"). Accept or Reject marks all those teams at once and, on Accept, saves the answer to the quiz. Tabs show how many answers each question still needs. "Reveal answers" stays disabled until nothing is left, with the count under it; "Skip the reveal" goes straight to the leaderboard (H-11).

Images: [tv-marking](img/tv-marking.png), [phone-waiting](img/phone-waiting.png), [host-marking](img/host-marking.png).

## 7. Reveal (T-05, H-11, H-13)

- **TV:** for each question, the question in muted text, then the answer in the second colour with a tick (8vh+), and a row of dots: one per team, filled for each team that got it, "4 of 6 teams got it". For multiple choice the right option lights up and the others fade. A `reveal` line shows at the start of the reveal.
- **Host:** "Show answer 3" steps through; each team's answer and mark is listed with "Change" for disputes. Changing a mark updates scores at once (H-13).
- **Phones:** stay on "Eyes on the TV" (the reveal is a room moment).

Images: [tv-reveal](img/tv-reveal.png), [tv-reveal-mc](img/tv-reveal-mc.png), [host-reveal](img/host-reveal.png).

## 8. Leaderboard (T-06, P-07)

- **TV, bottom up:** rows arrive from last place to first, one every 0.9 s (`--motion-row-gap`), each sliding in from the left (`--motion-row`). First place gets a highlight row in the main colour. With 21 to 30 teams, places 21 to 30 come first on their own page, then the top 20.
- Each row: position, colour dot, name, `JOKER` tag if the joker was on this round, `more round wins` tag where the tie breaker split a points tie (S-07), this round's points, movement (▲2, ▼1), total.
- One line in the footer, chosen in order: `tie_breaker` (when it decided 1st), `lead_change`, `close_race`, `big_climb` (copy-review.md).
- **Phones** show the team's own result big: position, "tied on points, ahead on round wins" when that applies, total, this round, movement, and joker status.

Images: [tv-leaderboard-reveal](img/tv-leaderboard-reveal.png), [tv-leaderboard](img/tv-leaderboard.png), [tv-leaderboard-20](img/tv-leaderboard-20.png), [tv-leaderboard-30](img/tv-leaderboard-30.png), [phone-score](img/phone-score.png).

## 9. Halftime (T-07, H-12)

- **TV:** "Halftime" in the display font, a `halftime` line, the prizes panel ("Playing for") and the full standings in compact rows, held until the host starts the next round.
- **Phones:** "Halftime", the team's position and total, the standings with the team highlighted, and the prizes.

Images: [tv-halftime](img/tv-halftime.png), [phone-halftime](img/phone-halftime.png).

## 10. Tie breaker (S-07)

The tie breaker asks no questions, so it is not a separate screen. It shows where it acts: a `more round wins` tag on the leaderboard row it lifted, "tied on points, ahead on round wins" on that team's phone, and a `tie_breaker` line when it decided first place.

## 11. Sudden death: "Deadlock" (T-08, P-09, H-14)

Cas asked for sudden death to have its own branding, and chose the name **Deadlock** (2026-11-23): a tie is a deadlock, and Lock-In is about locks. The screen always also says "Sudden death", so the name in S-07 is still on screen.

**Look:** the whole TV switches to a fixed palette that ignores the venue theme: near-black (`--deadlock-bg`), white, and one ember red (`--deadlock-ember`). The word DEADLOCK in heavy capitals with "LOCK" in ember, a chain rule under it, and the tied teams facing off: "Les Quizerables **vs** Agatha Quiztie" with their points and round wins. With three or more teams, they line up side by side.

| Step | TV | Tied teams' phones | Other phones | Host |
|---|---|---|---|---|
| Intro | DEADLOCK, the place at stake ("for 1st place"), the face-off, a `sudden_death` line | Deadlock title, "You vs Agatha Quiztie for 1st place" | Deadlock title, who is in it, "Only they answer. Watch the TV." | "Tied for 1st after the tie breaker", the teams, "Ask question 1" |
| Question | Question and timer in ember, pips for "question 1 of up to 3", each team's state ("Answered" / "Thinking…") | Question, input and Send, in the Deadlock look | Spectator view | Question, answer, lock control |
| Lock | The standard padlock moment, in ember | Answers locked | | |
| Result | The answer, each team's answer marked right or wrong (wrong fades), then either "Les Quizerables take 1st place" with `sudden_death_won`, or `sudden_death_again` and the next question, or after the last question the shared place with `sudden_death_shared` | Won, out, or next question | | Next step follows |

The heartbeat pulse on the timer and ember colour are the only animation added for Deadlock, so it stays within the TV baseline.

Images: [tv-deadlock-intro](img/tv-deadlock-intro.png), [tv-deadlock-question](img/tv-deadlock-question.png), [tv-deadlock-result](img/tv-deadlock-result.png), [phone-deadlock-in](img/phone-deadlock-in.png), [phone-deadlock-watch](img/phone-deadlock-watch.png), [host-deadlock](img/host-deadlock.png).

## 12. Winner, final standings and goodbye (T-09, H-07)

The TV plays three screens in a row, each held until the host moves on:

1. **Winner:** "Champions" in the display font, the team's colour and name huge (16vh), points, a `winner` line (`winner_shared` for a shared first place, naming every team), and the first prize when set. A soft glow of the main colour behind it.
2. **Final standings:** the full table, a `last_place` line (skipped with fewer than 3 teams or a shared last place), and a `goodbye` line.
3. The TV returns to the waiting screen when the host ends the night.

**Phones:** "Final result", the team's position, how it got there ("won sudden death"), its prize text when it placed, a `goodbye` line, and "Add to home screen for next week". The app shows prizes but never awards them (H-36): the phone says the quizmaster will hand it over.

Images: [tv-winner](img/tv-winner.png), [tv-final](img/tv-final.png), [phone-end](img/phone-end.png).

## 13. Prizes (H-15)

Prizes are free text per place, shown wherever H-15 lists and nowhere else: TV lobby (a strip under the teams), holding page (a panel), halftime ("Playing for"), winner (the first prize); phones in the lobby, at halftime and at the end. Place labels use the amber joker colour so prizes read the same in every theme. With no prizes set, no prize space is drawn.

## 14. Reconnecting (T-11, P-08, S-05)

- **TV:** the last screen stays up, dimmed to 55%, with a small "Reconnecting…" pill (blinking amber dot) in the top-right corner. On reconnect it jumps straight to the current screen without replaying missed moments.
- **Phones:** an amber "Offline. Reconnecting…" banner on top of whatever was showing. An answer typed while offline is marked "Not sent" (no offline queue in `v1.0.0`), and the timer shows "~" because it cannot be trusted.
- **Host:** an "offline" pill per team in the teams panel and a count in the top bar.

Images: [tv-reconnecting](img/tv-reconnecting.png), [phone-offline](img/phone-offline.png).
