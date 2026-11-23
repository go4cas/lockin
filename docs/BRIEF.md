# Lock-In: project brief

Lock-In is a pub quiz app. Teams answer on their phones, the quiz plays on the pub's TV, and the host runs the night from a laptop or tablet. It is being built first for one local pub in Cape Town, then released as open source so any venue can run it under its own branding.

This brief is the starting point, not a spec. It gathers the research, ideas and brand work done so far. The Interview and Requirements threads turn it into decisions and a feature list.

## Why build it

- **Commercial tools** (SpeedQuizzing, Quizado and others) work, but they cost money, some need players to install an app, and venue Wi-Fi often causes them trouble.
- **Open-source quiz apps** (Razzia, Quibble, ClassQuiz, Quizzoria, QuizDock and others) are mostly Kahoot clones. They have one player per phone, multiple choice, and scores based on speed.
- **The gap:** nothing open source is built around how a real pub quiz works. That means teams at tables, themed rounds, typed answers, a host who marks the borderline ones, a joker round, a leaderboard reveal after each round and a halftime break.

## Three screens, one server

1. **Host console** (laptop or tablet): builds and runs the quiz, moves between rounds and questions, marks answers, settles disputes.
2. **TV display**: shows questions, picture and music rounds, timers, the "answers locked" moment and the leaderboard.
3. **Team phones**: a web page opened from a QR code or room code. One device per team, with no app to install and no account.

## Candidate features

This list is raw material for the Requirements thread, not a commitment.

**Likely core**
- Quiz builder made of rounds; questions can be typed-answer, multiple choice, picture, or closest number
- Typed answers marked with fuzzy matching, plus a host review queue to accept or reject borderline answers
- Joker round: each team picks one round in which its points count double
- Answers lock when the timer ends (the app's signature moment)
- Leaderboard reveal after each round; halftime standings
- Teams can rejoin after losing their connection without losing their score

**Possible later**
- Music round with audio clips; a picture round where the image is revealed bit by bit
- Wager rounds; closest-guess tiebreakers
- Season league: returning teams, weekly standings, a hall of fame
- Anti-Googling: a team is flagged if it switches away from the quiz tab
- Paper mode: the host types in scores from paper answer sheets, as a bridge for pubs used to paper
- Questions imported from the Open Trivia DB; an optional AI question generator, with the host reviewing every question before use

**Open-source shape**
- Quiz packs stored as plain files (Markdown or JSON, plus images) that can live in a git repo
- Venue branding in a theme file
- Easy to self-host

## Constraints

- **Runtime:** Bun and TypeScript, with vanilla JS in the browser. No frameworks and no runtime dependencies.
- **Realtime and storage:** WebSockets and SQLite.
- **Shipping:** one single binary, which has to work in two modes:
  - **Local mode:** runs on the host's laptop on the pub's network and keeps working when the internet is flaky. This matters most, because unreliable venue Wi-Fi is the biggest real-world problem.
  - **Hosted mode:** runs on a VPS behind a Cloudflare tunnel.
- **Simplicity:** plain files are the source of truth wherever that is practical.
- **Open source:** the repo starts private and will be opened later, so keep it free of secrets and venue-specific data from the start.

## Brand

- **Name:** Lock-In (spelled `lockin` in code, the repo and the CLI). It means "lock in your answer" and is also the after-hours pub lock-in.
- **Signature moment:** when the timer ends, a padlock snaps shut on the TV and every phone shows "Answers locked".
- **Logo idea:** a padlock whose shackle is a question mark, with the keyhole as its dot.
- **Voice:** cheeky, warm and quick, like a good quizmaster. Short lines. Teases teams but is never mean, and never gives away an answer.
- **Copy pools:** `docs/brand/copy.en.json` holds the taglines and host-voice lines grouped by moment (lobby, locked, joker played, lead change, winner and others). The app shows a random line from the right list each time, never repeating the previous one. Lines can contain the team name, pub name, round number, a count or seconds left. A venue theme can replace or add to any list.

## Theme: Chalkboard

**This theme is a concept only.** It was sketched quickly to explore the brand, and the Design thread will unpack it, test it and redo it as needed. Nothing below is final.

- **Look:** a charcoal chalkboard background, chalk-white text, coral for actions, teal for status.
- **Type:** a chalky hand-drawn display font for headlines and the host's voice; a clean sans-serif for scores, labels and forms.
- **Starting values:** blackboard #17191B, charcoal #1E2124, chalk #EDEAE2, dust #A9A69E, coral #FF7A5C, teal #3CC6B8.
- **Team colours:** teal, coral, amber, sky, lilac, lime.
- **Other theme ideas:** Brass & Oak (a traditional pub) and Neon Taproom (a craft beer bar).
- **Venue branding:** a venue changes its name, logo, colours, fonts and TV background through a theme file. Lock-In's own brand shrinks to a small "Powered by Lock-In" credit.
- **Basic needs for any theme:**
  - The TV must be readable from the back of a busy room.
  - Phones default to a dark screen, because pubs are dim.
  - Tap targets are at least 44 px.

## Open questions for the Interview

- Who hosts: Cas, the pub staff, or a rotating quizmaster?
- How many teams on a typical night, and how many rounds and questions?
- Is the TV a smart TV with a browser, or a laptop plugged in over HDMI?
- Does the pub want a league, prizes or a season format?
- Who writes the questions, and how far ahead?
- Does the pilot run in local mode, hosted mode, or both?
- When to open-source it, and under which licence?
