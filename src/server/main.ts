// The `lockin` command (TECH-SPEC 4.1).
//   lockin [serve]         start the server
//   lockin reset-password  remove the host password, print a new setup code
//   lockin setup-code      print the current setup code
//   lockin --version       print the version

import { join } from "node:path";
import { startServer, VERSION } from "./app.ts";
import { Auth } from "./auth.ts";
import { ConfigError, ensureDataDir, parseArgs, resolveConfig, resolveDataDir } from "./config.ts";
import { openDb } from "./db.ts";

const HELP = `Lock-In ${VERSION}: a pub quiz app.

Usage:
  lockin [serve] --public-url <url> [options]   Start the server
  lockin reset-password [--data <folder>]       Remove the host password and print a new setup code
  lockin setup-code [--data <folder>]           Print the setup code (when no password is set)
  lockin --version                              Print the version

Options (each also from an environment variable or <data>/config.json):
  --data <folder>       Data folder (LOCKIN_DATA, default ./lockin-data)
  --port <number>       Port (LOCKIN_PORT, default 8080)
  --bind <address>      Address to listen on (LOCKIN_BIND, default 127.0.0.1)
  --public-url <url>    Public address, e.g. https://quiz.example.com (LOCKIN_PUBLIC_URL, required)
`;

export async function main(argv: string[], env: Record<string, string | undefined>, cwd: string): Promise<number> {
  try {
    const args = parseArgs(argv);
    switch (args.command) {
      case "version":
        console.log(VERSION);
        return 0;
      case "help":
        console.log(HELP);
        return 0;
      case "reset-password":
      case "setup-code": {
        const dataDir = resolveDataDir(args.flags, env, cwd);
        ensureDataDir(dataDir);
        const db = openDb(join(dataDir, "lockin.db"));
        try {
          const auth = new Auth(db, dataDir, { now: () => Date.now() }, true);
          if (args.command === "reset-password") {
            const code = auth.resetPassword();
            console.log("The host password has been removed and every host has been signed out.");
            console.log(`Open the host console and set a new password with this setup code: ${code}`);
            console.log("If Lock-In is running, it uses the new code straight away; open sockets sign out when they next send a command.");
          } else {
            const code = auth.ensureSetupCode();
            if (code) console.log(code);
            else console.log("A host password is already set, so there is no setup code. To start again, run: lockin reset-password");
          }
          return 0;
        } finally {
          db.close();
        }
      }
      case "serve": {
        const config = resolveConfig(args, env, cwd);
        const running = await startServer(config);
        const stop = async () => {
          await running.stop();
          process.exit(0);
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
        return -1; // keep running
      }
    }
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`Lock-In cannot start: ${e.message}`);
      return 2;
    }
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "EADDRINUSE") {
      console.error("Lock-In cannot start: the port is already in use. Stop the other program or choose another port with --port.");
      return 3;
    }
    throw e;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), process.env, process.cwd());
  if (code >= 0) process.exit(code);
}
