# Copy pool review

`docs/brand/copy.en.json` checked against every screen in [screens.md](screens.md). Each pool now has a place to appear, a rule for when, and lines that fit. Changes are in the same PR as this file.

## General rules (for S-10)

- **Host voice is flavour, not information.** Anything a team or host needs to act on (joining closed, offline, late answer, nothing sent) is in plain words in the screen itself, never only in a voice line.
- **Where it shows:** on the TV, the footer line (display font, second colour, `--tv-text-s`), except the lobby headline, the locked moment and the winner, where the line sits under the title. On phones, under the title.
- **`{n}` lines are skipped when n is less than 2**, so no screen says "1 teams in". (S-10 already skips a line whose placeholder has no value.)
- **`{team}` with several teams** (shared winner) is the names joined as "A, B and C".
- **One line per screen.** Where several pools could apply, the order below decides.
- **No line on a phone that is teasing a team about something that went wrong for it** (no answer, last place), because the phone is the team's own screen.

## Where each pool appears

| Pool | TV | Phone | When |
|---|---|---|---|
| `taglines` | Waiting screen (no night); holding-page brand panel | | One per screen show |
| `lobby` | Lobby headline; holding-page footer | Join page | On showing the screen, and every 20 s on the TV |
| `team_joined` | Lobby footer | | Each time a team joins; replaces the footer line for 8 s |
| `round_start` | Round intro | Joker screen | Each round |
| `last_seconds` | Question footer | | At 10 s left (once per question) |
| `locked` | Under "Answers locked" | Locked screen (only if the team's answer counted) | At the lock |
| `all_locked` | Under "Answers locked", instead of `locked` | | When every team answered before the lock |
| `no_answer` | | | **Not used in `v1.0.0`.** See below. |
| `joker_played` | Round intro footer | | Each time a team plays its joker |
| `reveal` | Marking screen footer; first reveal screen | Waiting screen | Once per round |
| `lead_change` | Leaderboard footer | Score screen of the new leader | Leader changed since the last leaderboard (not after round 1) |
| `close_race` | Leaderboard footer | | Top two within 1 point |
| `big_climb` | Leaderboard footer | Score screen of that team | A team rose 3 or more places since the last leaderboard |
| `halftime` | Halftime | Halftime | Once |
| `tie_breaker` | Leaderboard footer | | The tie breaker decided 1st place |
| `sudden_death` | Deadlock intro | | Once per sudden death |
| `sudden_death_again` | Deadlock result | | Both right or both wrong; next question |
| `sudden_death_won` | Deadlock result | | One team takes the place; `{team}` is that team |
| `sudden_death_shared` | Deadlock result | | Still tied after the last question |
| `winner` | Winner screen | | One winner |
| `winner_shared` | Winner screen | | Shared first place; `{team}` names them all |
| `last_place` | Final standings | | 3 or more teams, and last place is not shared |
| `goodbye` | Final standings | End screen | At Quiz End |

Leaderboard order, when more than one applies: `tie_breaker`, `lead_change`, `close_race`, `big_climb`.

## Changes made

| Pool | Change | Why |
|---|---|---|
| `tiebreak` | **Removed**, split into `tie_breaker` and `sudden_death` (T-08). Keys agreed with Architecture. | "Closest guess wins. No pressure." described the closest-number tiebreaker, but Cas chose right/wrong sudden death (N7). The tie breaker and sudden death are two named steps (S-07) and need different lines. |
| `tie_breaker` | **New:** "Level on points. Round wins split them." · "Same score. {team} won more rounds." · "Tied on points, not on round wins." | The automatic step asks no question, so its lines explain what decided it. |
| `sudden_death` | **New:** "Level on points, level on round wins. One question at a time." · "Deadlock. Somebody has to blink." · "Sudden death. One question, no mercy." · "{n} teams, one place. Hold your nerve." | Intro to the Deadlock moment. |
| `sudden_death_again` | **New:** "Still level. Next question." · "Nobody blinked. Go again." · "Still deadlocked. Another one." | Sudden death can need several questions (H-14); the room needs to hear why it goes on. |
| `sudden_death_won` | **New:** "Deadlock broken. {team} held their nerve." · "{team} picks the lock." · "Settled. {team} takes it." | Decides any place, not only first, so the lines do not say "wins". |
| `sudden_death_shared` | **New:** "Unbreakable. You'll have to share." · "Still level. Call it a draw." · "Deadlocked to the end. Shared it is." | After the maximum number of questions (S-07). |
| `winner_shared` | **New:** "Joint champions: {team}!" · "It's a tie at the top. Take a bow, {team}." · "Champions together: {team}. Share nicely." | `winner` lines are singular ("{team} wins!"), which reads wrong for "A and B" (T-09 names every winner). |
| `lobby` | "{n} teams in. Room for more." → "{n} teams in so far." | Wrong when the maximum number of teams has joined. |
| `last_seconds` | "Last chance… {seconds} seconds." → "Last chance. Get it in." | The line stays up while the timer counts, so a filled-in number goes stale at once, and the host can add 15 s. `{seconds}` stays available for venue lines. |

## Kept as they are, with notes

- **`no_answer`** ("Nothing from {team}. Bold strategy.") has no screen in `v1.0.0`: the TV shows only counts, and calling out a team whose phone may have dropped is closer to mean than cheeky. Kept in the file for a Later use (for example, the host console, or a TV line when exactly one team missed out).
- **`winner`: "{team} wins! Drinks are on them."** Fits the voice, but a venue may not want a line that pushes drinking. Venues can replace the pool (S-10); no change.
- **`close_race`: "Tighter than the parking out back."** Assumes the venue has parking out back. Harmless; venues can replace it.
- **`last_place`** lines are gentle enough for the TV; they never show on the team's own phone.
- **`goodbye`: "Thanks for playing at {pub}."** is skipped automatically when no venue name is set.
- **No line gives away an answer** (S-10): checked, none do.
