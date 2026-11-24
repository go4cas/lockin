// Night engine module (B1): wires the engine into the socket hub and registers
// `GET /media/q/:questionId` and the history API (TECH-SPEC 9.1, 9.2).

import { readFileSync } from "node:fs";
import type { App } from "../app.ts";
import { UPLOAD_CSP, errorResponse, json } from "../http.ts";
import { contentType } from "../static.ts";
import { safely, type CommandResult, type Conn } from "../ws.ts";
import { COALESCE_MS, Engine } from "./engine.ts";
import { answerText as answerTextOf, valueText } from "./quiz.ts";
import { ClockScheduler } from "./scheduler.ts";
import { imageVersion } from "./media.ts";
import { fileSources, venueFrom } from "./sources.ts";
import type { CommandName, HistoryDetail } from "../../shared/protocol.ts";
import { historyList, historyNight } from "./store.ts";
import { displayView, unpairedDisplayView, viewFor } from "./views.ts";
import { DISPLAY_COMMANDS, displayCommand, displaysSummary, type DisplayCommand } from "../display/index.ts";

/** The engine of each app, so tests can reach it (for example to run due timers on a fake clock). */
export const engines = new WeakMap<App, { engine: Engine; scheduler: ClockScheduler }>();

/** GET /api/history/:nightId answers with the shared HistoryDetail (src/shared/protocol.ts, TECH-SPEC 9.2). */
export type { HistoryDetail };

export function register(app: App): void {
  const scheduler = new ClockScheduler(app.clock, (m) => app.log(m));
  const { branding, quizStore } = app.services;
  const sources = fileSources(app.config.dataDir, venueFrom(branding));
  const engine = new Engine({
    db: app.db,
    clock: app.clock,
    scheduler,
    sources,
    rules: app.services.rules,
    copy: app.services.copyPicker,
    saveAcceptedAnswer: (q, id, text) => quizStore.saveAcceptedAnswer(q, id, text),
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
      return { seq: engine.seq, view: unpairedDisplayView(engine, app.services.displayPairing.codeFor(conn.id, conn.ip)) };
    }
    if (conn.role === "display" || conn.role === null) {
      const now = app.clock.now();
      if (!displayCache || displayCache.seq !== engine.seq || Math.abs(now - displayCache.at) > 1_000) {
        displayCache = { seq: engine.seq, at: now, view: displayView(engine) };
      }
      return { seq: engine.seq, view: displayCache.view };
    }
    const view = viewFor(engine, conn.role, conn.teamId);
    if (view.role === "host") {
      view.displays = displaysSummary(app);
      if (engine.joinPausedUntil > app.clock.now()) view.joinPausedUntil = engine.joinPausedUntil;
    }
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
      hub.broadcastHosts();   // presence: at most one every HOST_UPDATE_MS (SA-04)
    } else if (e.coalesce) {
      // The submitting team sees its answer at once; everyone else within COALESCE_MS.
      if (submitter) hub.sendState(submitter);
      if (!pending) pending = setTimeout(() => { pending = null; safely(app.log, "Answer broadcast", () => hub.broadcastState()); }, COALESCE_MS);
    } else {
      broadcastNow();
    }
  };

  /** SA-17: the security log line for a command, if it is one worth a line. Never a code or token. */
  const logCommand = (conn: Conn, name: string, args: Record<string, unknown>, result: CommandResult, teamBefore: string | null): void => {
    const ip = conn.ip;
    const teamName = (id: unknown) => (typeof id === "string" ? engine.m?.teams.get(id)?.name : undefined) ?? "";
    if (!result.ok) {
      if (result.error.code === "too_many_tries" && (name === "team.join" || name === "team.rejoin")) {
        app.security.event("limiter_tripped", ip, name === "team.join" ? "room code" : "rejoin code");
      }
      return;
    }
    const id = (result.result as { teamId?: string; id?: string } | undefined);
    switch (name) {
      case "team.join": app.security.event("team_joined", ip, teamName(id?.teamId)); break;
      case "team.rejoin": {
        // Move codes are 8 characters (from the host), rejoin codes 6.
        const viaMove = typeof args.code === "string" && args.code.trim().length === 8;
        app.security.event(viaMove ? "team_moved" : "team_rejoined", ip, teamName(id?.teamId));
        break;
      }
      case "team.remove": app.security.event("team_removed", ip, teamBefore ?? ""); break;
      case "display.pair": app.security.event("display_paired", ip, id?.id ? `display ${id.id}` : undefined); break;
      case "display.unpair": app.security.event("display_unpaired", ip, typeof args.id === "string" ? `display ${args.id}` : undefined); break;
      case "display.unpairAll": app.security.event("displays_unpaired_all", ip); break;
    }
  };

  hub.setCommandHandler((conn, name, args) => {
    const teamBefore = name === "team.remove" && typeof args.teamId === "string" ? engine.m?.teams.get(args.teamId)?.name ?? null : null;
    const result = runCommand(conn, name, args);
    logCommand(conn, name, args, result, teamBefore);
    return result;
  });

  const runCommand = (conn: Conn, name: CommandName, args: Record<string, unknown>): CommandResult => {
    if ((DISPLAY_COMMANDS as readonly string[]).includes(name)) return displayCommand(app, name as DisplayCommand, args);
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
  };

  hub.onConnect((conn) => {
    if (conn.role === "team" && conn.teamId) engine.touch();
  });
  hub.onDisconnect((conn) => {
    if (conn.role === "team" && conn.teamId) {
      lastSeen.set(conn.teamId, conn.lastMessageAt);
      engine.touch();
    }
  });

  branding.onThemeChange(() => engine.venueChanged());

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
    // ?v= names the night and the image (LI-003). A different version is another night's
    // or another image's address: never answer it with this night's bytes.
    const v = ctx.url.searchParams.get("v");
    if (v !== null && v !== imageVersion(m.night.id, ref.q.media.file)) return notFound();
    const path = sources.mediaPath(m.night.quizId, ref.q.media.file);
    if (!path) return notFound();
    const body = req.method === "HEAD" ? null : readFileSync(path);
    return new Response(body, {
      headers: {
        "Content-Type": contentType(path), "Content-Security-Policy": UPLOAD_CSP,
        // Only a versioned address of a shown question may be cached.
        "Cache-Control": shown && v !== null ? "private, max-age=3600" : "private, no-store",
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
    if (open && h.night.status === "open" && open.m!.night.startedAt !== null) {
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
      // A record with no value is kept with its mark and flagged noAnswer (LI-006): the host may
      // mark a team right that sent nothing (a dead phone, an answer told in person).
      answers: h.answers.filter((a) => specs.has(a.questionId))
        .map((a) => a.value === null
          ? { teamId: a.teamId, questionId: a.questionId, display: "", mark: a.mark, noAnswer: true as const }
          : { teamId: a.teamId, questionId: a.questionId, display: valueText(a.value, specs.get(a.questionId)!), mark: a.mark }),
    };
    return json(detail);
  }, { host: true });
}
