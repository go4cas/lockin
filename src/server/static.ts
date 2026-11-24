// Static files and the host console's pages (TECH-SPEC 9.1).
// Files are read through a FileSource so that B8 can swap the disk for files
// embedded in the binary (TECH-SPEC 4.6) without touching the routes.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { App } from "./app.ts";
import { redirect } from "./http.ts";

/** Reads a file by its repo-relative path, e.g. "public/shared/base.css". */
export interface FileSource {
  read(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  exists(path: string): boolean;
}

export const REPO_ROOT = resolve(import.meta.dir, "../..");

export function diskSource(root: string = REPO_ROOT): FileSource {
  return {
    async read(path) {
      try {
        return new Uint8Array(await readFile(join(root, path)));
      } catch {
        return null;
      }
    },
    exists(path) {
      return existsSync(join(root, path));
    },
  };
}

export const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
};

export function contentType(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Rejects anything that could leave the folder: "..", backslashes, NUL, empty or hidden segments. */
export function safeRelative(path: string): string | null {
  if (path.includes("\\") || path.includes("\0")) return null;
  const segs = path.split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return null;
  return segs.join("/");
}

/** The default theme: Design's tokens, served at /static/shared/tokens.css (TECH-SPEC 9.1). */
export const TOKENS_PATH = "docs/design/tokens.css";

/**
 * Maps a /static/... URL path to a repo-relative file path, or null.
 *   shared/tokens.css   -> docs/design/tokens.css
 *   fonts/<id>.woff2    -> docs/design/fonts/<id>-400.woff2 (TECH-SPEC 5.3 names fonts by id);
 *   fonts/<file>        -> docs/design/fonts/<file> (e.g. atkinson-hyperlegible-700.woff2, OFL-*.txt)
 *   logo/<file>         -> docs/design/logo/<file> (the Lock-In mark)
 *   anything else       -> public/<path>
 */
export function staticPath(rest: string, files: FileSource): string | null {
  const rel = safeRelative(rest);
  if (!rel) return null;
  if (rel === "shared/tokens.css") return TOKENS_PATH;
  if (rel.startsWith("fonts/")) {
    const exact = `docs/design/${rel}`;
    const byId = /^fonts\/([a-z0-9-]+)\.woff2$/.exec(rel);
    if (!files.exists(exact) && byId) return `docs/design/fonts/${byId[1]}-400.woff2`;
    return exact;
  }
  if (rel.startsWith("logo/")) return `docs/design/${rel}`;
  return `public/${rel}`;
}

function etagOf(bytes: Uint8Array): string {
  return `"${Bun.hash(bytes).toString(16)}"`;
}

/**
 * Serves a file with `Cache-Control: no-cache` and an ETag (TECH-SPEC 4.5),
 * answering 304 when the browser already has it.
 */
export async function serveFile(req: Request, files: FileSource, path: string, extraHeaders?: Record<string, string>): Promise<Response | null> {
  const bytes = await files.read(path);
  if (!bytes) return null;
  const etag = etagOf(bytes);
  const headers: Record<string, string> = { "Cache-Control": "no-cache", ETag: etag, "Content-Type": contentType(path), ...extraHeaders };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(req.method === "HEAD" ? null : bytes, { headers });
}

/** Host console sections: URL segment -> folder in public/host/ and its owner thread. */
export const HOST_SECTIONS = {
  build: "Library",       // B3
  brand: "Branding",      // B4
  run: "Run night",       // B5
  history: "History",     // B5
} as const;

export function registerStatic(app: App): void {
  const files = app.files;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  app.route("GET", "/static/*", async (req, ctx) => {
    const path = staticPath(ctx.params["*"] ?? "", files);
    if (!path) return notFound();
    return (await serveFile(req, files, path)) ?? notFound();
  });

  // Host console pages. Signed-out visitors go to the setup or login page.
  const page = async (req: Request, path: string) => (await serveFile(req, files, path)) ?? notFound();
  const gate = (signedIn: boolean, here: string): Response | null => {
    if (app.auth.setupNeeded()) return redirect("/host/setup");
    if (!signedIn) return redirect(`/host/login?next=${encodeURIComponent(here)}`);
    return null;
  };

  app.route("GET", "/host/setup", async (req) => {
    if (!app.auth.setupNeeded()) return redirect("/host/login");
    return page(req, "public/host/setup.html");
  });
  app.route("GET", "/host/login", async (req, ctx) => {
    if (app.auth.setupNeeded()) return redirect("/host/setup");
    if (ctx.hostSession) return redirect("/host");
    return page(req, "public/host/login.html");
  });
  app.route("GET", "/host", async (req, ctx) => gate(!!ctx.hostSession, "/host") ?? page(req, "public/host/index.html"));
  app.route("GET", "/host/:section", async (req, ctx) => {
    const section = ctx.params.section!;
    if (!(section in HOST_SECTIONS)) return notFound();
    return gate(!!ctx.hostSession, `/host/${section}`) ?? page(req, `public/host/${section}/index.html`);
  });
}
