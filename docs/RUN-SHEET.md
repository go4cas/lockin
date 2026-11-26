# Lock-In: host run sheet

What the quizmaster does on a quiz night. One page, meant to be printed. Setting up the server is in [RELEASE.md](RELEASE.md); this sheet assumes Lock-In is already running at your quiz address (written below as `quiz.example.com`).

## The day before

- [ ] Sign in at `https://quiz.example.com/host`. The quiz for tomorrow shows **Ready** in the library. A quiz marked **Not ready** says what to fix.
- [ ] Check tonight's prizes and the planned start time (you can also set them when you open the night).
- [ ] Charge the host laptop or tablet. Note the pub's Wi-Fi password.

## Setting up (30 minutes before)

1. **Connect the laptop to the pub's Wi-Fi** and sign in to the console.
2. **Open the night:** Run night, pick the quiz, check prizes and start time, **Open the night**. The lobby opens and the room code appears on the console.
3. **Put the quiz on the display.** Two ways:
   - **The display is the laptop's second screen (HDMI):** set the laptop to **extend** the screen, **never mirror it**. A mirrored screen shows the room your answers and marks. Click **Open display**, drag the new window to the TV, and make it full screen (F11, or Ctrl+Cmd+F on a Mac). A display opened from the signed-in console needs no pairing; it stays paired until you sign out.
   - **The TV's own browser or a casting device:** open `https://quiz.example.com/display` on it. It shows a **6-digit code**. On the console, under **Pair a display** (on Run night, or Venue settings, Displays), type the six digits and press **Pair**. The console says which address it paired; if that does not look like the pub, press **Unpair** next to it. A paired TV remembers its pairing; you only do this once per screen (unless it is not used for 90 days). Run night offers it only before the quiz starts, so do it now; Venue settings, Displays works at any time.
4. **If you are not sure the room cannot see your screen**, turn on **Hide answers on this screen** (next to the answer, or in the Night menu). Answers stay blurred until you tap one.
5. Check the display shows the venue's waiting screen, then the lobby with the **QR code** and room code.

## Teams joining (the lobby)

- Teams **scan the QR code** on the display, type a team name and join. They can also go to the address on the display and type the 4-letter room code.
- **One phone per team.** A second phone trying the same name is told to use the team's rejoin code instead.
- Phones on the pub's Wi-Fi or on mobile data both work.
- You can rename or remove a team in the lobby (Team tools). Teams can only be removed before the quiz starts.
- **"Someone is guessing the room code"** on the console means someone is trying codes. Teams who scan the QR code still get in. If you think the code got out of the room, press **New room code**: every team keeps its place, and the display shows the new code and QR code.
- When everyone is in, press **Start the quiz**. Joining then closes; teams that drop out can still rejoin.

## Running the quiz

Follow the console: it always shows the next step (ask, lock, mark, reveal, leaderboard, next round). A few things worth knowing:

- **Locked answers are final.** Once a team locks, or the timer ends, the answer cannot change. Nobody can take one back.
- **Pause** stops the timer if something happens in the room.
- **Marking:** typed answers are marked automatically; check the groups and change any the quiz got wrong. The reveal waits until every answer is marked.
- **Disputes:** "Change a mark" fixes a mark after the reveal; the scores update.
- **Ties for a place** that matters are settled by **Deadlock** (sudden death), from the console after the last round.
- **End the quiz** shows the winner and saves the night to History.

## When something goes wrong

| What happens | What to do |
|---|---|
| A team's phone dies or they switch phones | On their old phone, the team menu shows a **rejoin code**; on the new phone, **Already playing? Use a rejoin code**. If the old phone is gone, open the team in Team tools and press **Move to a new phone**: the new phone scans that QR code (it works once, for 10 minutes). |
| A phone says **Offline, reconnecting** | It is reconnecting by itself; answering is paused until it does. Move closer to the Wi-Fi or switch to mobile data. |
| The display or console shows a yellow **reconnecting** banner | Wait a few seconds; it carries on where it was. If it stays, reload the page. Check the laptop's Wi-Fi. |
| The pub's internet drops | Phones on mobile data carry on. The laptop and TV reconnect when it is back, and nothing is lost: the night is saved on the server. A laptop can share a phone's mobile data (hotspot) to carry on. |
| Lock-In itself restarts (rare) | Every screen reconnects within seconds and the night carries on from where it was. |
| The TV shows **This browser is too old** | Use the casting device, or a laptop on HDMI (extend, not mirror). |
| The TV shows a 6-digit code mid-quiz | It lost its pairing, and pairing is only offered before the quiz starts. Carry on from the laptop: in the same browser as the console, open `quiz.example.com/display` in a new window and drag it to the TV (extend, not mirror). Pair the TV again before the next night. |
| A display you do not recognise is paired | Unpair it on the console: Venue settings, Displays (any time), or the list under Pair a display on Run night (before the quiz starts). To be safe, **Unpair all**: every display goes back to a code and you pair the pub's again. |
| You forgot the host password | Whoever looks after the server runs `lockin reset-password` (see RELEASE.md) and gives you a setup code to choose a new one. Already signed-in consoles are signed out. |

## After the night

- **Sign out** of the console if the laptop is not yours. Signing out also unpairs a display opened from the console.
- The night is in **History** with its final standings.
- The server backs everything up every morning by itself.
