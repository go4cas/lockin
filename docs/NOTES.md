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

### 5. League, prizes and seasons (2026-11-23)

- **Two milestones, not one.** Cas distinguishes the **pilot** (first nights at the one pub) from the **product launch**. League, weekly standings and hall of fame are not needed for the pilot but are needed before launch. Requirements should make clear whether "MVP" means pilot or launch (see open questions).
- **Prizes:** an optional space to show the night's prizes (for example on the TV in the lobby, at halftime and at the winner moment). The app does not manage or award prizes; the host announces them.
- **Keep event history from day 1.** Every night's teams, scores and results are stored from the first pilot night, so a later league or hall of fame has real data. Affects the data model from B0 onward even though no league screens exist yet.
- **Reusing teams and members across nights is a bonus** (nice to have, not pilot).

### 6. The questions (2026-11-23)

- **A regular quizmaster (QM) writes the questions, a couple of days ahead.**
- **They are written on paper today.** So the QM types every question into Lock-In: the quiz builder must be a friendly screen a non-technical QM can use, not hand-edited Markdown or JSON. Plain files can still be the stored format, written by the builder. Import from other formats is not a pilot need.
- **No editing questions on the night.** Instead, a spelling and grammar check in the builder is a wanted feature, so mistakes are caught before the night.
- **Acceptable alternatives for typed answers are added by the QM while marking**, not listed up front. Interviewer's note: once the QM accepts an answer, the same (or fuzzily same) answer from other teams on that question should be accepted too, so the QM marks each distinct answer once.
- **AI help is wanted (interviewer suggests Later):** generating questions, and a new idea, checking the accuracy of the QM's questions and answers. The brief already lists an optional AI generator with host review. Points for Requirements/Architecture: it needs internet and an API key (a secret, so never in the repo), and it must stay optional so local mode and offline nights work without it.

### 7. Scoring and the joker (2026-11-23)

- **1 point per question.** A bonus question worth more is an idea for later.
- **No negative marking** (a wrong answer scores 0) and **speed never affects score**.
- **Joker is played before a round starts** and cannot be changed once the round begins. It can be played on the final round. Points in that round count double.
- **Ties need sudden death.** Cas's idea: one question at a time, repeated until one tied team gets it right and the other does not. Interviewer's note: "first right" can go many rounds if both teams keep getting questions right or wrong, so the QM needs a stock of tiebreak questions; a closest-number question settles it in one go and matches the brief's "closest-guess tiebreaker". Cas chose **right/wrong sudden death**: tied teams answer one question; if exactly one is right, it wins; otherwise ask another. **The QM sets the maximum number of sudden-death questions; still tied after that, the teams share the position.**
- **Sudden death gets its own branding** (Cas). Design should treat it as a key moment alongside join, locked, reveal, leaderboard, halftime and winner, with its own look and copy. Finding: the `tiebreak` copy pool includes "Closest guess wins. No pressure.", which no longer fits right/wrong sudden death; the copy review should fix it and consider a dedicated sudden-death pool.
- **Tie rule for positions:** if teams are level on points, the team with more round wins ranks higher; if still level, they share the position. Interviewer's note: "round win" needs defining (suggest: highest score in that round, joker included, shared top scores count as a win for each).
- **Configurable (both):** whether sudden death applies to first place only or to other places too, and whether a closest-number question scores the closest team only or every team within a range.

### 8. Joining and team names (2026-11-23)

- **No name approval or rude-word filter.** The QM can rename a team from the console.
- **A second phone joining an existing team** either joins as a viewer or gets a "this team already has a phone" message; **configurable**. Default to be set by Requirements (interviewer suggests viewer, since teammates will want to see the question).
- **Replacing a team's phone:** the team's phone shows a short rejoin code, and the host can also move a team to a new phone from the console. The team keeps its name, answers and score.
- **No late joining.** The night has explicit **Quiz Start** and **Quiz End** events. Joining is open before Quiz Start and closed after it (rejoining an existing team still works). Quiz End closes the night and is the point where results are saved to history (topic 5).

### 9. Open source and venue branding (2026-11-23)

- **The `lockin` repo is already public** (the brief says it "starts private"; that is out of date). Everything committed here is public from now on, so the no-secrets, no-venue-data rule applies to every commit, including these notes.
- **Release path:** build and test in the public repo up to `v1.0.0`, then take it to the pilot pub. So the pilot runs `v1.0.0`.
- **A private, branded pilot repo exists.** Interviewer's recommendation (pending Cas's agreement): do not fork the code for the pilot. Treat a venue's branding as data: uploaded through the host's settings screen, stored on the server's data folder as plain files, and covered by backups. A private repo is then only useful, if at all, for the venue's own data (theme files, quiz packs, deploy settings), never a copy of the code. This keeps one codebase and avoids a fork that drifts.
- **Venue themes are made by non-technical people** (pub staff, designers). So branding needs a settings screen (name, logo, colours, fonts, TV background, copy lines) rather than hand-editing a theme file. The theme file stays the stored format, and can be exported and imported.
- **The pilot pub uses its own branding**, with the small "Powered by Lock-In" credit.
- **Licence: decide later** (Cas, 2026-11-23). The repo stays public without a licence for now; the recommendation below stands for when it is picked up.

#### Licence recommendation

What matters here: Lock-In is a server app that venues self-host or that someone could run as a paid hosted service; it has no runtime dependencies, so there are no licence-compatibility constraints; and venues' own themes and quiz packs are data, not code, so no licence touches them.

- **AGPL-3.0 (recommended).** Free for any pub to run, modified or not. Anyone who runs a *modified* version as a service for others must publish their changes. Stops a company taking Lock-In, improving it in private and selling it as a closed hosted service. Cas, as copyright holder, can still run a paid hosted version. Cost: some companies avoid AGPL code, and if Cas ever wants to sell other licences, outside contributions need a contributor agreement.
- **MIT or Apache-2.0.** Anyone can do anything, including a closed paid service built on it. Most adoption and least friction; Apache-2.0 adds a patent grant. Choose this if wide reuse matters more than keeping improvements open.
- **MPL-2.0.** A middle ground: changes to Lock-In's own files must be shared when distributed, but the network-service loophole stays open, so it does not stop a closed hosted service.

## Requirements decisions (2026-11-23)

- **MVP means the pilot** (`v1.0.0`). Ranks are MVP, Launch (needed before the public launch), Later and Won't (Cas chose this on the Requirements thread).
- **Cas added:** more answer types (free text, multiple choice, number, closest number, date or time); image, sound and video questions; the AI question generator and AI verifier; QM moderation of equivalent free-text answers ("JFK" for "John F Kennedy"); a configurable pre-quiz holding page (countdown, registered teams, a guide to adding Lock-In to the phone's home screen, a brand animation); prizes on TV and phones.
- **Ranking:** image questions, the new answer types, moderation, the holding page, the home-screen (PWA) install and prizes on phones are MVP. Sound and video questions and both AI features are Launch (Cas confirmed), because sound needs speakers (topic 3) and AI needs internet and an API key (topic 6).
- **Proposed by Requirements, not objected to:** host login, removing a team, pausing or extending the timer, copy-pool editing and theme export moved to Launch, browser spellcheck for the pilot with grammar check Later, and the defaults table in REQUIREMENTS.md.

- **Changes on review (Cas, 2026-11-23):** the joker is off by default; one phone per team with no viewer mode (a second phone gets a "this team already has a phone" message), replacing the configurable choice in topic 8; ties are two named steps, the **tie breaker** (most round wins, automatic) and then **sudden death**.

## Open questions

- **Licence.** Cas chose to decide later. Recommendation is AGPL-3.0 (see topic 9). Until a licence is added, the public repo is "all rights reserved" by default, so outsiders cannot legally reuse or contribute; settle it before inviting contributors and before `v1.0.0`.
- **Private pilot repo.** Recommendation is to drop it or keep it for venue data only, never a code fork (topic 9); Cas to confirm.
- **MVP = pilot or launch?** Cas has two milestones (pilot at `v1.0.0`, then product launch). Requirements should rank Pilot / Launch / Later / Won't, or define MVP as the pilot and list launch items separately.
- **How much is configurable for the pilot?** Cas answered "configurable" to many questions. Each option needs a sensible default so a non-technical host never touches settings, and Requirements should decide which options ship for the pilot and which stay fixed until later.
- **Host on the TV laptop or a separate device?** Cas wants both supported, but analysed first (topic 3). Architecture should compare before Design commits to a console layout.
- **"Members" vs "no account".** Reusing *members* across nights implies knowing individual players, while the brief says one device per team and no accounts. Decide before team history is designed (Later).
- **Defaults to confirm:** halftime after round 3; design target of 20 teams (working at 30); second phone joins as a viewer by default; definition of a "round win" for the tie rule.
- **Brief needs updating:** it says the repo "starts private" (it is public), lists a closest-guess tiebreaker (Cas chose right/wrong sudden death), and does not mention Quiz Start/End, prizes, sudden-death branding, spelling check or AI accuracy checks. The brief is raw material, so Requirements carries these forward rather than editing the brief.
