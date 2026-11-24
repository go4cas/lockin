# Lock-In: release and server guide

How to cut a release, set up the server, keep it backed up and move it, and what to check before a quiz night. The host's own checklist for the night is the [host run sheet](RUN-SHEET.md).

Lock-In runs as one binary on a Linux VPS. It listens only on `127.0.0.1`; a Cloudflare tunnel on the same machine carries the public address (HTTPS and WebSockets) to it, so the server has no open web port at all (TECH-SPEC 4.5).

```
phones, display, host console ──HTTPS──▶ Cloudflare ──tunnel──▶ cloudflared ──▶ 127.0.0.1:8080 lockin
                                                                (on the VPS)      data: /var/lib/lockin
```

The files in [`deploy/`](../deploy/) do the server side:

| File | What it is |
|---|---|
| `deploy/setup.sh` | Installs or updates Lock-In on the server. Safe to run again at any time. |
| `deploy/backup.sh` | Writes one backup archive of the data folder (run daily by a timer). |
| `deploy/restore.sh` | Puts a backup back, on this server or a new one. |
| `deploy/systemd/lockin.service` | The service: restarts on any exit, own user, hardened. |
| `deploy/systemd/lockin-backup.service`, `.timer` | The daily backup at 05:00 server time. |
| `deploy/offsite.sh`, `deploy/systemd/lockin-offsite.service` | Copies each new backup to a private R2 bucket, once set up. |
| `deploy/journald-lockin.conf` | Keeps Lock-In's own logs for 30 days. |

Contents:

1. [Cut a release](#1-cut-a-release)
2. [Set up the server](#2-set-up-the-server)
3. [Cloudflare](#3-cloudflare)
4. [First start: the host password](#4-first-start-the-host-password)
5. [Backups](#5-backups)
6. [Updating, and Bun security releases](#6-updating-and-bun-security-releases)
7. [Move to a new server](#7-move-to-a-new-server)
8. [Logs](#8-logs)
9. [Repository settings](#9-repository-settings)
10. [Before the first night](#10-before-the-first-night)
11. [Release notes for v1.0.0](#11-release-notes-for-v100)
12. [After v1.0.0](#12-after-v100)

---

## 1. Cut a release

Releases are built by GitHub, not on a laptop, so every binary can be tied to a commit (SA-16). A tag such as `v1.0.0` runs `.github/workflows/release.yml`, which tests, builds two binaries, writes their SHA-256 files, attests them and publishes a GitHub release.

1. **Real-hardware checks first** (REVIEW finding 2). Before `v1.0.0`: the pilot pub's smart TV (or casting device) shows `/display`; current and previous iOS Safari and Android Chrome can join and play; a phone can add the quiz to its home screen and open it full screen. See [section 10](#10-before-the-first-night).
2. **Set the version.** In a pull request, change `"version"` in `package.json` to the new number (for example `1.0.0`). Merge it.
3. **Tag the merged commit** on `main`:

   ```sh
   git switch main && git pull
   git tag v1.0.0
   git push origin v1.0.0
   ```

   The workflow refuses a tag that does not match `package.json`.
4. **Check the release.** The first tag is also the first run of `release.yml`, so check it properly. The release page should have four files:

   | File | For |
   |---|---|
   | `lockin-linux-x64` | Most servers (CPU with AVX2) |
   | `lockin-linux-x64.sha256` | Its checksum |
   | `lockin-linux-x64-baseline` | Older CPUs without AVX2 |
   | `lockin-linux-x64-baseline.sha256` | Its checksum |

   On any machine with the GitHub CLI, check a download against its checksum and its build attestation:

   ```sh
   gh release download v1.0.0 -R go4cas/lockin -p 'lockin-linux-x64*'
   sha256sum -c lockin-linux-x64.sha256
   gh attestation verify lockin-linux-x64 -R go4cas/lockin
   ```

   If the workflow fails, fix it on a branch, then delete the tag (`git push --delete origin v1.0.0`, `git tag -d v1.0.0`) and tag again. Only do that before any server has installed the release.

## 2. Set up the server

**What you need:** a VPS with Ubuntu 24.04 LTS or Debian 12 (x86-64), 1 vCPU and 1 GB of memory at least (2 GB is comfortable), SSH access as a user who can `sudo`, and a domain on Cloudflare.

1. **Check the CPU.** On the VPS:

   ```sh
   grep -qw avx2 /proc/cpuinfo && echo "AVX2: use lockin-linux-x64" || echo "No AVX2: use lockin-linux-x64-baseline"
   ```

   `setup.sh` checks this too and downloads the right one.
2. **Firewall: only SSH comes in.** The tunnel makes outgoing connections only, so no web port is ever opened.

   ```sh
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow OpenSSH
   sudo ufw enable
   ```

   **Never open Lock-In's port (8080) or set `LOCKIN_BIND` to `0.0.0.0` on a server.** Lock-In believes the visitor address Cloudflare sends (`CF-Connecting-IP`) only from `127.0.0.1`. If the port were reachable directly, the sign-in and join limits would see the wrong addresses (SA-06). The service also tells the kernel to drop anything to Lock-In that does not come from this machine (`IPAddressDeny=any`), as a second guard.
3. **Get the setup files** from the release's tag and run the setup:

   ```sh
   git clone --depth 1 --branch v1.0.0 https://github.com/go4cas/lockin.git
   sudo lockin/deploy/setup.sh --public-url https://quiz.example.com --version v1.0.0
   ```

   Use your real quiz address. On a server that already runs other apps, add `--port <free port>` (see [Sharing a server](#sharing-a-server-with-other-apps)). `setup.sh`:

   - installs `sqlite3` and `curl` if missing (the backup needs `sqlite3`);
   - adds a system user `lockin` with no login shell;
   - downloads the release binary for this CPU, checks its SHA-256 and installs it as `/usr/local/bin/lockin`;
   - writes `/etc/lockin/lockin.env` (public URL, port, `LOCKIN_BIND=127.0.0.1`; never secrets);
   - refuses a port another program already listens on;
   - installs the service, the backup script and timer, and the 30-day log setting for Lock-In's own logs;
   - starts Lock-In, checks that it is Lock-In answering on `http://127.0.0.1:<port>/api/ping`, and prints the setup code.

   Running it again changes only what differs and restarts Lock-In only if something changed. Later runs need no options: it keeps the saved public URL and port. To install a binary you have (for example one you built with `bun run build`), use `--binary <file>` instead of `--version`. Pass `--no-journald` to skip Lock-In's log retention file.

### Sharing a server with other apps

Lock-In is made to sit next to other apps on one VPS without touching them:

- **Its own user, folders and settings:** user `lockin`; `/usr/local/bin/lockin`, `/usr/local/lib/lockin/`, `/etc/lockin/`, `/var/lib/lockin/`. No global Bun: the binary carries its own.
- **Its own port, on `127.0.0.1` only.** The default is 8080, which other apps often use. Before the first run, list the ports in use with `sudo ss -ltnp` and pass a free one with `--port` (for example `--port 8092`). `setup.sh` refuses a port another program is listening on, and checks the answer on that port really is Lock-In's. The port is saved, so later runs keep it.
- **Its own logs:** the service writes to its own journal namespace (`LogNamespace=lockin`), so its 30-day retention applies to Lock-In's logs only. Read them with `journalctl --namespace=lockin` (see [Logs](#8-logs)).
- **Capped:** at most 1 GB of memory and 150% CPU.
- **Its own backups:** in `/var/lib/lockin/backups`, at 05:00 server time.
- **The same tunnel:** if `cloudflared` already runs on the server, Lock-In gets one more public hostname on that tunnel (see [The tunnel](#the-tunnel)); nothing is installed and no port is opened.

The data folder is `/var/lib/lockin`, owned by `lockin`, mode `0700`; Lock-In keeps its files there `0600` (SA-10). Do not loosen these modes: the folder holds the password hash, the rejoin codes and every quiz's answers.

### The service

`/etc/systemd/system/lockin.service` runs `lockin serve --data /var/lib/lockin` as `lockin` with:

- `Restart=always`, `RestartSec=1` and no start limit: Lock-In stops itself on an error nothing caught (SA-09), and a fresh process picks up the night from the database within a second or two;
- its own user, `NoNewPrivileges`, `ProtectSystem=strict` with only `/var/lib/lockin` writable, `PrivateTmp`, no capabilities, kernel and device protections, `MemoryMax=1G`;
- `IPAddressAllow=localhost` and `IPAddressDeny=any`;
- `CPUQuota=150%` and its own journal namespace, `LogNamespace=lockin`, for sharing a server.

It does not set `MemoryDenyWriteExecute`, because Bun's JavaScript engine compiles code while running. These settings have been checked with `systemd-analyze verify` but not yet on a live VPS: if Lock-In will not start after setup, `journalctl --namespace=lockin -u lockin -n 50` shows why (and `journalctl -u lockin -n 20` shows systemd's own lines about starting it).

Useful commands:

```sh
systemctl status lockin                  # is it running
sudo systemctl restart lockin            # restart (a night in progress carries on)
journalctl --namespace=lockin -f         # follow the log
curl -s http://127.0.0.1:8080/api/ping   # {"app":"lockin","version":"1.0.0"} (use your port)
```

## 3. Cloudflare

These are steps in your Cloudflare account; nothing in the repo does them.

### The tunnel

**If the server already has a tunnel** for other apps, do not install a second `cloudflared`: in Zero Trust, Networks, Tunnels, open that tunnel and do step 3 only, adding Lock-In's hostname with Lock-In's port. Every app on the tunnel gets its own hostname and its own port.

For a server with no tunnel yet:

1. In the Cloudflare dashboard, go to Zero Trust, then Networks, then Tunnels, and create a tunnel of type **Cloudflared**. Name it after the server.
2. Choose Debian (64-bit) and run the install commands it shows on the VPS. The last one looks like `sudo cloudflared service install <token>`: that token is a secret, so do not paste it anywhere else or commit it.
3. Add a public hostname (the dashboard may call it a published application route): your quiz address, for example `quiz.example.com`, with service type **HTTP** and URL **`127.0.0.1:<port>`** (the port from `setup.sh`, 8080 unless you chose another).
4. Open `https://quiz.example.com/api/ping` in a browser. It should show `{"app":"lockin",...}`.

`cloudflared` runs as its own systemd service and restarts itself. It updates through the Cloudflare package repository with the rest of the system (`sudo apt upgrade`).

### Zone settings

These settings belong to the whole domain (the zone), so on a domain other sites share, check them rather than change them: Lock-In needs nothing unusual, and each item below is fine for ordinary sites. In the domain's settings:

- **SSL/TLS:** Always Use HTTPS on. Lock-In sends HSTS itself when its public URL is `https`.
- **Network:** WebSockets on (the default). Phones, the display and the console all use `/ws`; Cloudflare closes idle sockets after 100 s, and Lock-In pings every 25 s, so nothing else is needed.
- **Caching:** add no Cache Rules and no "Cache Everything" for this hostname. Browser Cache TTL set to "Respect existing headers" is right for Lock-In. Lock-In marks its own responses (`no-cache` with ETags for app files, `no-store` for the API and pages, `private` for question pictures), and a cache rule could serve one team's or the host's answer to someone else.
- **Do not** turn on "I'm Under Attack" mode or a challenge for this hostname during a night: phones reconnecting to `/ws` cannot answer a browser challenge.

### Rate-limiting rules

Lock-In limits sign-ins, joins and sockets per visitor itself (SA-01, SA-08, SA-14). The Cloudflare rules stop a flood before it reaches the server. Go to Security, then WAF, then Rate limiting rules.

**Always include the hostname** in the expression (replace `quiz.example.com` with yours). Rules apply to the whole domain, and other sites on it may have their own `/ws` or `/api/auth/` paths that this rule must not touch.

**Mind the pub's Wi-Fi.** Every phone on the pub's Wi-Fi, the host and the display reach Cloudflare from the same address. Lock-In allows up to 120 sockets per address for that reason, so the `/ws` limit must be generous: a whole room reconnecting at once after a Wi-Fi blip must never trip it.

On the **Free plan** (one rule per domain, counted per IP over 10 seconds, blocking for 10 seconds; checked against Cloudflare's docs on 2026-11-24), make one rule. If another site on the domain already uses the one rule, decide which needs it more; Lock-In's own limits still hold without it.

- Name: `Lock-In sign-in and sockets`
- When incoming requests match (expression editor):

  ```
  (http.host eq "quiz.example.com") and ((starts_with(http.request.uri.path, "/api/auth/")) or (http.request.uri.path eq "/ws"))
  ```

- Characteristics: IP. Rate: **100 requests per 10 seconds**. Action: Block, for 10 seconds.

On **Pro or higher** (two rules, longer periods), make two:

| Rule | Expression | Rate | Block for |
|---|---|---|---|
| Lock-In sign-in | `http.host eq "quiz.example.com" and starts_with(http.request.uri.path, "/api/auth/")` | 20 requests per 1 minute | 10 minutes |
| Lock-In sockets | `http.host eq "quiz.example.com" and http.request.uri.path eq "/ws"` | 300 requests per 1 minute | 1 minute |

After a first real night, look at Security, then Events: if a rule ever fired on the pub's own address, raise its rate.

## 4. First start: the host password

`setup.sh` prints the setup code on a fresh install. To see it again:

```sh
sudo -u lockin lockin setup-code --data /var/lib/lockin
```

Open `https://quiz.example.com/host`, enter the setup code and choose the host password. **Use a long passphrase**: three or four words that only you would put together (D4). Anyone on the internet can reach the sign-in page; the passphrase and the limits are what keep them out.

**Forgotten password** (S-03): on the server, run

```sh
sudo -u lockin lockin reset-password --data /var/lib/lockin
```

It removes the password, signs every host out and prints a new setup code. Lock-In does not need a restart. Always run these commands as `lockin` (`sudo -u lockin`): run as root, they would leave files in the data folder that Lock-In cannot read.

## 5. Backups

**What is backed up:** everything in `/var/lib/lockin` except its `backups/` folder: the database (nights, teams, answers, history), quizzes and their pictures, the venue's theme and settings, paired displays and the host password hash.

**When:** every day at 05:00 server time (`lockin-backup.timer`; if the server was off then, it runs at the next boot), and by `setup.sh` before it replaces a binary.

**How:** `backup.sh` copies the database with SQLite's online backup, so the copy is consistent even during a night, checks it with `PRAGMA integrity_check`, and packs it with the other files into `/var/lib/lockin/backups/lockin-backup-<UTC time>.tar.gz`. Each file keeps its mode (`0600` files, `0700` folders), and the archive itself is `0600`. The newest 14 are kept.

```sh
sudo systemctl start lockin-backup       # take a backup now
journalctl -u lockin-backup -n 5         # did the last one work
systemctl list-timers lockin-backup      # when is the next
sudo ls -l /var/lib/lockin/backups       # what is there
```

### Off-server copy (R2)

A backup on the same disk does not survive the VPS being lost. After each good backup, `lockin-offsite.service` uploads it to a private Cloudflare R2 bucket. It does nothing until you give it credentials, which live only on the server.

1. **In Cloudflare, R2:** create a bucket, for example `lockin-backups` (a bucket of its own, not shared with another app). In its settings, add a lifecycle rule that deletes objects after **30 days**.
2. **R2 API token:** Manage API tokens, Create API token, permission **Object Read & Write**, applied to **that bucket only**. Note the Access Key ID, the Secret Access Key and your Account ID. Keep them in your password manager, not in chat, email or a repository.
3. **On the server**, make the root-only credentials file and fill it in:

   ```sh
   sudo install -m 600 -o root -g root /dev/null /etc/lockin/r2.env
   sudo nano /etc/lockin/r2.env
   ```

   ```
   R2_ACCOUNT_ID=<your account ID>
   R2_BUCKET=lockin-backups
   R2_ACCESS_KEY_ID=<access key ID>
   R2_SECRET_ACCESS_KEY=<secret access key>
   ```

4. **Try it:** `sudo systemctl start lockin-backup`, then `journalctl -u lockin-offsite -n 5` should end with `copied lockin-backup-... to bucket lockin-backups`, and the file shows in the bucket.

systemd reads the file as root and hands the upload a private copy for that run (`LoadCredential`); the key never appears on a command line or in the settings file. The archives hold the password hash, rejoin codes and every quiz's answers, so keep the bucket private (no public access, no custom domain).

**Without R2**, pull the newest backup to a computer you trust at least weekly, and before any big change:

```sh
latest=$(ssh you@your-server 'sudo ls /var/lib/lockin/backups | grep "tar.gz$" | tail -1')
ssh you@your-server "sudo cat /var/lib/lockin/backups/$latest" > "$latest"
chmod 600 "$latest"
```

Treat backup files like passwords: they hold the password hash, team rejoin codes and the answers to every quiz. Do not commit them to any repository.

### Restore a backup

```sh
sudo /usr/local/lib/lockin/restore.sh /var/lib/lockin/backups/lockin-backup-20261128-050312.tar.gz
```

`restore.sh` checks the archive (one `lockin-backup-*` folder, nothing outside it, a database that passes its integrity check), stops Lock-In and the backup timer, moves what is in the data folder now to `/var/lib/lockin.before-restore-<time>` (nothing is deleted; `backups/` stays where it is), unpacks the backup with its modes, gives the files to `lockin`, and starts Lock-In again. Delete the `before-restore` folder once you are happy.

**Try a restore once before the pilot**, so you know the backups work. To try one without touching the live server, unpack into a spare folder as yourself:

```sh
sudo cp /var/lib/lockin/backups/<newest>.tar.gz /tmp/ && sudo chown $USER /tmp/<newest>.tar.gz
/usr/local/lib/lockin/restore.sh /tmp/<newest>.tar.gz --data /tmp/lockin-try --no-service
```

## 6. Updating, and Bun security releases

**To install a new release:**

```sh
cd lockin && git fetch --depth 1 origin tag v1.0.1 && git checkout v1.0.1
sudo deploy/setup.sh --version v1.0.1
```

`setup.sh` backs up the data first, keeps the old binary as `/usr/local/bin/lockin.previous`, restarts Lock-In and checks it answers. Avoid updating during a night: the restart is quick and the night carries on, but phones and the display reconnect.

**To go back** to the previous binary:

```sh
sudo cp -p /usr/local/bin/lockin.previous /usr/local/bin/lockin && sudo systemctl restart lockin
```

A newer version may have changed the database; if the old one will not start, restore the backup `setup.sh` took just before the update.

**Bun security releases** (SA-05). The binary carries its own Bun, so a Bun security fix only reaches the pub once Lock-In is rebuilt. The weekly "Bun release check" workflow fails when a newer Bun 1.4.x is out. When it does:

1. Read that Bun release's notes.
2. If it has security fixes: in a pull request, raise `MIN_BUN` in `src/server/runtime.ts`, `engines.bun` in `package.json`, and `bun-version` in `.github/workflows/ci.yml` and `release.yml` to the new version, and bump Lock-In's patch version (for example `1.0.1`). Lock-In refuses to start on a Bun older than `MIN_BUN` (currently 1.4.5).
3. Merge, tag, check the release ([section 1](#1-cut-a-release)), and update the server as above.
4. If it has no security fixes, update the pins with the next normal release.

**The rest of the server:** let Ubuntu or Debian install security updates by themselves (`sudo apt install unattended-upgrades`, on by default on Ubuntu), and reboot when they ask, on a day without a quiz.

## 7. Move to a new server

Everything Lock-In knows is in the data folder, and the public address lives in Cloudflare, so a move is: set up the new server, bring the data across, point the tunnel at it. Teams and the display notice nothing but a short reconnect, so do it between nights.

1. **New server:** set it up as in [section 2](#2-set-up-the-server), with the same `--public-url` and the same release. Skip the setup code; the restore brings the password across.
2. **Last backup on the old server**, then stop it so nothing changes after the backup:

   ```sh
   sudo systemctl start lockin-backup
   sudo systemctl stop lockin
   ```

3. **Copy the newest backup across**: download it from the R2 bucket (Cloudflare dashboard, R2, the bucket, the newest object, Download), or through your own computer (as in [section 5](#5-backups)), or straight between the servers. Keep it private (`chmod 600`). If the old server is lost, the newest R2 copy is the one to use. Then make `/etc/lockin/r2.env` on the new server too.
4. **Restore it on the new server:**

   ```sh
   sudo /usr/local/lib/lockin/restore.sh ./lockin-backup-<time>.tar.gz
   ```

   The `lockin` user can have a different number on the new server; `restore.sh` gives every file to the new server's `lockin` and keeps the modes.
5. **Point Lock-In's hostname at the new server.** Move only Lock-In's public hostname; the hostname stays the same, so QR codes, saved phones and paired displays keep working.
   - **If the old server's tunnel also carries other apps** (the usual case): leave `cloudflared` on the old server alone; uninstalling it would take the other apps offline. If the new server already has a tunnel, add Lock-In's hostname to it with Lock-In's port; if not, make a new tunnel for the new server ([section 3](#the-tunnel)) and add the hostname there. Then delete Lock-In's hostname from the old tunnel.
   - **If the old tunnel served only Lock-In:** install `cloudflared` on the new server with the same tunnel's token (Zero Trust, Networks, Tunnels, the tunnel, its install command), then remove it from the old one (`sudo cloudflared service uninstall`).
6. **Check** `https://quiz.example.com/api/ping`, sign in to the console, and see the quizzes and history are there.
7. **Retire Lock-In on the old server** after a night has run on the new one. If other apps still run there, remove only Lock-In's parts:

   ```sh
   sudo systemctl disable --now lockin lockin-backup.timer
   sudo rm -f /etc/systemd/system/lockin.service /etc/systemd/system/lockin-backup.* /etc/systemd/system/lockin-offsite.service /etc/systemd/journald@lockin.conf
   sudo systemctl daemon-reload
   sudo rm -rf /var/lib/lockin /etc/lockin /usr/local/lib/lockin /usr/local/bin/lockin /usr/local/bin/lockin.previous
   sudo userdel lockin
   ```

   Delete the VPS itself only if nothing else runs on it.

## 8. Logs

Lock-In writes to the system journal: start-up lines (version, public URL, the setup code while no password is set), errors, and one line per security event, `Security: <event> from <ip>` (SA-17). Events include failed and good sign-ins, limiter trips, display pairings and teams joining or being removed; no line holds a password, code or token.

```sh
journalctl --namespace=lockin --since today                    # tonight's log
journalctl --namespace=lockin --since "7 days ago" | grep "Security:"
journalctl --namespace=lockin -p err --since "7 days ago"      # errors only
```

**Retention: 30 days.** Security lines hold visitors' IP addresses, which are personal information, so Lock-In logs to its own journal namespace (`LogNamespace=lockin`) and `setup.sh` sets that namespace to keep logs for 30 days and at most 500 MB (`/etc/systemd/journald@lockin.conf`). It does not change the retention of other apps' logs on the server. To keep Lock-In's logs longer or shorter, edit `MaxRetentionSec` in that file and run `sudo systemctl restart systemd-journald@lockin`; `setup.sh` puts it back unless run with `--no-journald`. A plain `journalctl` does not show Lock-In's lines: add `--namespace=lockin`.

## 9. Repository settings

In GitHub, under the repository's Settings, then Security (SA-16):

- **Private vulnerability reporting:** on (done 2026-11-24). `SECURITY.md` points to it.
- **Secret scanning** and **push protection:** check both are on (secret scanning is on by default for public repositories; push protection may need turning on).
- **Dependabot** alerts and updates: `.github/dependabot.yml` proposes action and Bun updates weekly.

## 10. Before the first night

What only a person with the real kit can check (REVIEW finding 2). Do these once before tagging `v1.0.0`, and again at the pilot pub:

- [ ] **The display:** the pub's smart TV browser (or the casting device) opens `https://<address>/display`, shows the pairing code, and pairs from the console. If the TV's browser shows "This browser is too old", use the casting device or a laptop.
- [ ] **Phones:** current and previous iOS Safari and Android Chrome scan the QR code, join, answer, lock, and rejoin after being closed. Try at least one phone on the pub's Wi-Fi and one on mobile data.
- [ ] **Home screen:** on one iPhone and one Android phone, add the quiz to the home screen and open it: it opens full screen.
- [ ] **The venue's look:** the logo, colours and fonts on the phone, the display and the console.
- [ ] **A restore** from a backup has been tried ([section 5](#5-backups)).
- [ ] **A short rehearsal** at the pub: one round with two or three phones, through the pub's Wi-Fi, with the display paired and the console on the host's laptop. Then pull the pub's internet cable for a minute: phones on mobile data carry on, the laptop and display reconnect when it is back.

The host's checklist for every night is the [host run sheet](RUN-SHEET.md).

## 11. Release notes for v1.0.0

Lock-In 1.0.0 is the first release, for the first pilot pub.

**In it:** teams join and answer on their phones (installable from the browser), the quiz plays on the pub's display, and the host builds quizzes, runs the night, marks, settles disputes and runs sudden death from one console, in the venue's own branding. Details are in the [requirements](REQUIREMENTS.md) and the [tech spec](TECH-SPEC.md).

**Known limits:**

- **A power cut can lose the last moment of the night.** Each host command and answer is saved as it happens, and a crash or restart of Lock-In loses nothing. But the database is written with `synchronous = NORMAL`, so if the whole server loses power or its kernel crashes, the last second or so of writes (an answer, a mark) may be gone after it comes back. The host re-marks or re-asks; everything before it is there.
- **Linux x86-64 servers only.** `lockin-linux-x64` needs a CPU with AVX2; `lockin-linux-x64-baseline` is for older ones. `setup.sh` picks the right one.
- **Hosted only.** Every device needs the internet to reach the server. Running from a laptop in the pub with no internet is planned for later.
- **Modern displays only:** about Chrome 86 or Safari 14 and newer (most TVs from 2022 on). Older TVs show a "browser too old" page; use a casting device or a laptop.
- **One host password, set up once.** No way to change it from the console yet; `lockin reset-password` on the server starts again.
- **Checked in real browsers by machine, not yet on real phones and TVs** until the checks in [section 10](#10-before-the-first-night) are done.

**Upgrading from a test install:** host sessions signed in before 1.0.0 move to the new cookie name `__Host-lockin_host` the first time they load a page, so nobody is signed out.

## 12. After v1.0.0

Small jobs saved for after the pilot:

- **Remove the old cookie name** `lockin_host` (SA-13). 1.0.0 still reads it so test installs are not signed out; take it out in the next minor release.
- Local laptop mode (TECH-SPEC 4.8), when it is ranked again.
