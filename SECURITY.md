# Security policy

Lock-In runs pub quiz nights: a server that a venue hosts, a console for the host, a display for the pub's TV and a page for each team's phone. If you find a way to spoil a night, read what you should not (answers before the reveal, the host's console, another team's answers), or get at the server, please tell us privately first.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (or open <https://github.com/go4cas/lockin/security/advisories/new>).
3. Describe the problem.

Only the maintainers can see the report. Helpful things to include:

- what an attacker can do, and what they need first (a phone in a team, the room code, network access to the server, a host sign-in);
- the version or commit you tested (`lockin --version`, or the commit on `main`);
- steps to reproduce it, or a short script;
- anything you know about a fix.

## What happens next

Lock-In is maintained by a small team in spare time, so these are aims rather than promises:

- we aim to acknowledge a report within a week;
- we will tell you whether we can reproduce it, and keep you posted while we fix it;
- we publish a GitHub security advisory with the fixed release, and credit you there unless you would rather not be named.

Please give us a reasonable time to release a fix before you talk about the problem in public.

## Supported versions

Until `v1.0.0`, only the latest commit on `main` is supported. From `v1.0.0`, security fixes go into the latest release. Lock-In ships with the Bun runtime inside its binary, so a fix may be a rebuild on a newer Bun; venues should run the latest release.

## In scope

- The Lock-In server (`src/`), the host console, display and phone pages (`public/`), the release binaries and the build and CI files in this repository.

## Out of scope

- A venue's own server, network, Cloudflare account or tunnel settings. The release notes and run sheet say how to set these up; a problem caused by not following them is not a Lock-In vulnerability, though we welcome reports that the guidance is wrong.
- Flooding a server with traffic (Lock-In has per-address limits, but stopping volume floods is the job of the network in front of it).
- Social engineering of pub staff, and physical access to the host's laptop or the pub's TV.
- Findings that need a host sign-in to affect only that host's own venue.

## Earlier audits

The findings of the independent security audit and what was done about each are in [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md).
