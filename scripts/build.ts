// Build script. B0 provides the development run; B8 adds compiling and packaging.

export {};
//   bun run dev   start the server from source (TECH-SPEC 4.7)

const [command = "dev", ...rest] = process.argv.slice(2);

if (command === "dev") {
  const args = ["--watch", "src/server/main.ts", "serve"];
  // Development defaults (TECH-SPEC 4.7), overridable by flags passed after `bun run dev --`.
  if (!rest.some((a) => a.startsWith("--public-url"))) args.push("--public-url", "http://localhost:8080");
  if (!rest.some((a) => a.startsWith("--bind"))) args.push("--bind", "127.0.0.1");
  if (!rest.some((a) => a.startsWith("--data"))) args.push("--data", "./lockin-data");
  const proc = Bun.spawn(["bun", ...args, ...rest], { stdio: ["inherit", "inherit", "inherit"] });
  process.on("SIGINT", () => proc.kill("SIGINT"));
  process.on("SIGTERM", () => proc.kill("SIGTERM"));
  process.exit(await proc.exited);
} else {
  console.error(`Unknown build command "${command}". B0 only has "dev"; compiling comes with B8.`);
  process.exit(2);
}
