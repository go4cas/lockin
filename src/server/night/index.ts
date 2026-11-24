// Night engine module (B1): wires the engine into the socket hub and registers
// `GET /media/q/:questionId` and the history API (TECH-SPEC 9.1, 9.2).

import { readFileSync } from "node:fs";
import type { App } from "../app.ts";
import { UPLOAD_CSP, errorResponse, json } from "../http.ts";
import { contentType } from "../static.ts";
import type { Conn } from "../ws.ts";
import { COALESCE_MS, Engine } from "./engine.ts";
import { answerText as answerTextOf, valueText } from "./quiz.ts";
import { ClockScheduler } from "./scheduler.ts";
import { fileSources, type Sources } from "./sources.ts";
import * as brandingModule from "../branding/index.ts";
import type { VenueFile } from "../../shared/formats.ts";
import type { HistoryDetail } from "../../shared/protocol.ts";

/** What B4's branding store offers (PR 11): used when it is there, else the engine reads the files itself. */
interface BrandingLike {
  venueName(): string;
  themeVersion(): string;
  venue(): VenueFile;
  onThemeChange(fn: () => void): void;
}

function sourcesFor(app: App): { sources: Sources; branding: BrandingLike | null } {
  const files = fileSources(app.config.dataDir);
  const get = (brandingModule as unknown as { branding?: (app: App) => BrandingLike }).branding;
  if (typeof get !== "function") return { sources: files, branding: null };
  const b = get(app);
  return {
    sources: { ...files, venueInfo: () => ({ name: b.venueName(), themeVersion: b.themeVersion(), venue: b.venue() }) },
    branding: b,
  };
}
import { historyList, historyNight } from "./store.ts";
import { displayView, unpairedDisplayView, viewFor } from "./views.ts";
import { displayCommand, displaysSummary } from "../display/index.ts";

/** The engine of each app, so tests can reach it (for example to run due timers on a fake clock). */
export const engines = new WeakMap<App, { engine: Engine; scheduler: ClockScheduler }>();

/** GET /api/history/:nightId answers with the shared HistoryDetail (src/shared/protocol.ts, TECH-SPEC 9.2). */
export type { HistoryDetail };

export function register(app: App): void {
  const scheduler = new ClockScheduler(app.clock);
  const { sources, branding } = sourcesFor(app);
  const engine = new Engine({
    db: app.db,
    clock: app.clock,
    scheduler,
    sources,
    rules: () => app.services.rules,
    copy: () => app.services.copyPicker,
    saveAcceptedAnswer: () => {
      const store = app.services.quizStore;
      return store ? (q, id, text) => store.saveAcceptedAnswer(q, id, text) : undefined;
    },
    publicUrl: app.publicUrl,
    log: (m) => app.log(m),
  });
  engines.set(app, { engine, scheduler });
  const hub = app.ws;

  engine.presence = (teamId) => {
    const conns = hub.connections("team").filter((c) => c.teamId === teamId);
    if (conns.length > 0) return { connected: true, lastSeenAt: Math.max(...conns.map((c) => c.lastMessageAt)) };
    return { connected: false, lastSeenAt: lastSeen.get(teamId) ?? null };
  };
  const lastSeen = new Map<string, number>();

  // --- views and sends (10.7) -----------------------------------------------------
  let displayCache: { seq: number; at: number; view: ReturnType<typeof displayView> } | null = null;
  hub.setViewProvider((conn) => {
    engine.ensureRecovered();
    if (conn.role === "display" && !conn.paired) {
      // REVIEW finding 4: an unpaired display sees only its pairing code.
      return { seq: engine.seq, view: unpairedDisplayView(engine, app.services.displayPairing?.codeFor(conn.id) ?? "") };
    }
    if (conn.role === "display" || conn.role === null) {
      const now = app.clock.now();
      if (!displayCache || displayCache.seq !== engine.seq || Math.abs(now - displayCache.at) > 1_000) {
        displayCache = { seq: engine.seq, at: now, view: displayView(engine) };
      }
      return { seq: engine.seq, view: displayCache.view };
    }
    const view = viewFor(engine, conn.role, conn.teamId);
    if (view.role === "host") view.displays = displaysSummary(app);
    return { seq: engine.seq, view };
  });
  hub.setTeamTokenResolver((token) => engine.teamForToken(token));

  let pending: ReturnType<typeof setTimeout> | null = null;
  const broadcastNow = () => {
    if (pending) { clearTimeout(pending); pending = null; }
    hub.broadcastState();
  };
  let submitter: Conn | null = null;
  engine.onChange = (e) => {
    for (const b of e.byes) {
      for (const c of hub.connections("team")) {
        if (c.teamId !== b.teamId || c.id === b.keepConn) continue;
        if (b.reason === "night_closed") { c.bindTeam(null); c.bye("night_closed"); }
        else c.bye(b.reason);
      }
    }
    if (e.hostOnly) {
      hub.broadcastState((c) => c.role === "host");
    } else if (e.coalesce) {
      // The submitting team sees its answer at once; everyone else within COALESCE_MS.
      if (submitter) hub.sendState(submitter);
      if (!pending) pending = setTimeout(() => { pending = null; hub.broadcastState(); }, COALESCE_MS);
    } else {
      broadcastNow();
    }
  };

  hub.setCommandHandler((conn, name, args) => {
    if (name === "display.pair" || name === "display.unpairAll") return displayCommand(app, name, args);
    const actor = conn.role === "team" ? { role: "team" as const, teamId: conn.teamId, connId: conn.id, ip: conn.ip } : { role: "host" as const };
    submitter = conn;
    let result;
    try {
      result = engine.command(actor, name, args);
      if (result.ok && (name === "team.join" || name === "team.rejoin")) {
        conn.bindTeam((result.result as { teamId: string }).teamId);
        hub.sendState(conn);
        engine.touch();   // the host sees the team as connected
      }
    } finally {
      submitter = null;
    }
    return result;
  });

  hub.onConnect((conn) => {
    if (conn.role === "team" && conn.teamId) engine.touch();
  });
  hub.onDisconnect((conn) => {
    if (conn.role === "team" && conn.teamId) {
      lastSeen.set(conn.teamId, conn.lastMessageAt);
      engine.touch();
    }
  });

  branding?.onThemeChange(() => engine.venueChanged());

  app.onStart(() => {
    engine.load();
    if (engine.m) hub.broadcastState();
  });
  app.onStop(() => {
    if (pending) clearTimeout(pending);
    engine.stop();
    scheduler.stop();
  });

  // --- GET /media/q/:questionId (9.1) ----------------------------------------------
  app.route("GET", "/media/q/:questionId", (req, ctx) => {
    const notFound = () => errorResponse(404, "not_found", "There is nothing at this address.");
    const m = engine.m;
    if (!m) return notFound();
    const qid = ctx.params.questionId!;
    const ref = engine.qIndex.get(qid);
    if (!ref || ref.q.media?.kind !== "image") return notFound();
    const status = m.state.questions[qid]?.status;
    const shown = status === "open" || status === "locked";
    if (!shown && !ctx.hostSession) return notFound();
    const path = fileSourcesFor(app).mediaPath(m.night.quizId, ref.q.media.file);
    if (!path) return notFound();
    const body = req.method === "HEAD" ? null : readFileSync(path);
    return new Response(body, {
      headers: {
        "Content-Type": contentType(path), "Content-Security-Policy": UPLOAD_CSP,
        "Cache-Control": ctx.hostSession && !shown ? "private, no-store" : "private, max-age=3600",
      },
    });
  });

  // --- history (9.2, S-08) -----------------------------------------------------------
  app.route("GET", "/api/history", () => json({ nights: historyList(app.db) }), { host: true });

  app.route("GET", "/api/history/:nightId", (_req, ctx) => {
    const h = historyNight(app.db, ctx.params.nightId!);
    if (!h) return errorResponse(404, "not_found", "That night could not be found.");
    const quiz = h.night.quiz;
    const open = engine.m && engine.m.night.id === h.night.id ? engine : null;
    let standings: HistoryDetail["standings"] = h.standings;
    if (open && h.night.status === "open" && open.m!.night.startedAt !== null && open.rules()) {
      const rows = open.standingsRows(Math.min(open.state.round, quiz.rounds.length - 1));
      standings = rows.map((r) => ({ ...r, name: open.m!.teams.get(r.teamId)?.name ?? "" }));
    }
    const specs = new Map(quiz.rounds.flatMap((r) => r.questions.map((q) => [q.id, q.answer] as const)));
    // Sudden-death questions that were asked, in the order asked, as a last "round" with index -1 (Cas, 2026-11-24; shape agreed with B5).
    const sdQuestions = h.sdQuestionIds.map((id) => quiz.suddenDeath.find((q) => q.id === id)).filter((q) => q !== undefined);
    for (const q of sdQuestions) specs.set(q.id, q.answer);
    const detail: HistoryDetail = {
      night: { id: h.night.id, quizTitle: h.night.quizTitle, openedAt: h.night.openedAt, endedAt: h.night.endedAt, status: h.night.status },
      standings,
      rounds: quiz.rounds.map((r, index) => ({
        index, title: r.title,
        questions: r.questions.map((q, i) => ({ id: q.id, number: i + 1, text: q.text, answerText: answerTextOf(q.answer) })),
      })).concat(sdQuestions.length === 0 ? [] : [{
        index: -1, title: "Deadlock",
        questions: sdQuestions.map((q, i) => ({ id: q.id, number: i + 1, text: q.text, answerText: answerTextOf(q.answer) })),
      }]),
      answers: h.answers.filter((a) => a.value !== null && specs.has(a.questionId))
        .map((a) => ({ teamId: a.teamId, questionId: a.questionId, display: valueText(a.value!, specs.get(a.questionId)!), mark: a.mark })),
    };
    return json(detail);
  }, { host: true });
}

const sourcesByApp = new WeakMap<App, ReturnType<typeof fileSources>>();
function fileSourcesFor(app: App) {
  let s = sourcesByApp.get(app);
  if (!s) { s = fileSources(app.config.dataDir); sourcesByApp.set(app, s); }
  return s;
}
