import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Camera, CameraOff, Mic, MicOff, X, Star, Eye, EyeOff, Copy } from "lucide-react";
import { toast } from "sonner";

type Profile = { id: string; username: string | null; avatar_url: string | null };
type Member = { user_id: string; profile?: Profile };
type Task = { id: string; user_id: string; title: string; completed: boolean; position: number; visibility?: string };

const showSbError = (label: string, error: any) => {
  const parts = [
    error?.message,
    error?.details && `details: ${error.details}`,
    error?.hint && `hint: ${error.hint}`,
    error?.code && `code: ${error.code}`,
  ].filter(Boolean).join(" · ");
  toast.error(`${label}`);
  console.error(label, parts, error);
};

const Session = () => {
  const { id } = useParams();
  const sessionId = id!;
  const nav = useNavigate();
  const { user } = useAuth();

  const [session, setSession] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(Date.now());
  const [ended, setEnded] = useState<null | { ok: boolean }>(null);
  const finalizeStarted = useRef(false);

  const loadAll = useCallback(async () => {
    const { data: s, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    if (error) showSbError("Could not load session", error);
    setSession(s);
    const { data: ms } = await supabase.from("session_members").select("user_id").eq("session_id", sessionId);
    const ids = (ms ?? []).map(m => m.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id, username, avatar_url").in("id", ids)
      : { data: [] as Profile[] };
    const map = new Map((profs ?? []).map((p: any) => [p.id, p as Profile]));
    setMembers((ms ?? []).map(m => ({ user_id: m.user_id, profile: map.get(m.user_id) })));
    const { data: ts } = await supabase.from("tasks").select("*").eq("session_id", sessionId).order("position");
    setTasks((ts as Task[]) ?? []);
  }, [sessionId]);

  useEffect(() => {
    loadAll();
    const ch = supabase.channel(`room:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `session_id=eq.${sessionId}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_members", filter: `session_id=eq.${sessionId}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, loadAll]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const startedAt = session?.started_at ? new Date(session.started_at).getTime() : null;
  const duration = session?.duration_seconds ?? 0;
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const remainingSec = startedAt ? Math.max(0, duration - Math.floor(elapsedMs / 1000)) : duration;
  const totalElapsedSec = Math.floor(elapsedMs / 1000);

  const finalize = useCallback(async (succeeded: boolean) => {
    if (finalizeStarted.current) return;
    finalizeStarted.current = true;
    try {
      const { data, error } = await supabase.functions.invoke("process-session-end", {
        body: { session_id: sessionId, succeeded, duration_seconds: totalElapsedSec },
      });
      if (error) throw error;
      const ok = data?.succeeded ?? succeeded;
      setEnded({ ok });
      if (ok) {
        confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, colors: ["#C99678", "#4B2E24", "#EBD8CC", "#8A8A66"] });
      }
      setTimeout(() => nav("/dashboard"), 3500);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to finalize");
      finalizeStarted.current = false;
    }
  }, [sessionId, totalElapsedSec, nav]);

  // Auto-end on full task completion (any client; edge function is idempotent)
  useEffect(() => {
    if (!session || !user) return;
    if (session.status !== "active") return;
    if (tasks.length > 0 && tasks.every(t => t.completed) && !finalizeStarted.current) {
      finalize(true);
    }
  }, [session, user, tasks, finalize]);

  // Timer hits zero → success only if all tasks complete; otherwise fail (host triggers)
  useEffect(() => {
    if (!session || !user) return;
    if (session.status !== "active") return;
    if (session.host_id !== user.id) return;
    if (startedAt && remainingSec === 0 && !finalizeStarted.current) {
      const allDone = tasks.length > 0 && tasks.every(t => t.completed);
      finalize(allDone);
    }
  }, [session, user, startedAt, remainingSec, tasks, finalize]);

  useEffect(() => {
    if (!session) return;
    if (session.status === "completed" || session.status === "failed") {
      if (!ended) setEnded({ ok: session.status === "completed" });
      const t = setTimeout(() => nav("/dashboard"), 3500);
      return () => clearTimeout(t);
    }
  }, [session, ended, nav]);

  const myTasks = tasks.filter(t => t.user_id === user?.id);
  const toggleTask = async (t: Task) => {
    if (!user) return;
    if (session?.status !== "active") return;
    if (finalizeStarted.current) return;
    const { error } = await supabase.from("tasks").update({ completed: !t.completed }).eq("id", t.id);
    if (error) showSbError("Could not update task", error);
  };

  // End/Leave with confirmation
  const exitFail = async () => {
    if (!session) return nav("/dashboard");
    if (session.status === "lobby") return nav("/dashboard");
    if (session.status !== "active") return nav("/dashboard");
    const allDone = tasks.length > 0 && tasks.every(t => t.completed);
    if (allDone) {
      await finalize(true);
      return;
    }
    const ok = window.confirm("Ending now before the puzzle is complete will fail the session for everyone.");
    if (!ok) return;
    await finalize(false);
  };

  // Best-effort: warn before tab close during active session
  useEffect(() => {
    if (session?.status !== "active") return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session?.status]);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  };

  if (!session) {
    return <div className="min-h-screen flex items-center justify-center text-coffee/70 italic bg-ivory">Loading session…</div>;
  }

  // Lobby state — show waiting room
  if (session.status === "lobby") {
    return <LobbyView session={session} members={members} tasks={tasks} userId={user?.id} sessionId={sessionId} onLeave={() => nav("/dashboard")} />;
  }

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const myDone = myTasks.filter(t => t.completed).length;
  const groupPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const myPct = myTasks.length ? Math.round((myDone / myTasks.length) * 100) : 0;

  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments variant="minimal" />

      <header className="relative z-10 border-b border-border/60 bg-ivory/80 backdrop-blur">
        <div className="container mx-auto px-4 py-3 md:py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <p className="font-serif text-lg md:text-xl text-coffee shrink-0">FocusForge<span className="text-clay">.</span></p>
            <span className="text-[10px] md:text-xs uppercase tracking-widest text-taupe truncate min-w-0">{session.mode === "solo" ? "Solo" : "Group"} · {session.timer_type}</span>
          </div>
          <div className="font-serif text-2xl md:text-3xl tabular-nums order-3 md:order-none w-full md:w-auto text-center">{fmt(remainingSec)}</div>
          <Button variant="outline" size="sm" onClick={exitFail} className="shrink-0">
            <X className="w-4 h-4" /> {session.host_id === user?.id ? "End" : "Leave"}
          </Button>
        </div>
        <div className="h-1 bg-sand">
          <div className="h-full bg-coffee transition-all" style={{ width: `${duration ? Math.min(100, ((duration - remainingSec) / duration) * 100) : 0}%` }} />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 md:py-8 grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8 min-w-0 order-1">
          <JigsawCanvas tasks={tasks} members={members} userId={user?.id} templateUrl={session.template_url} />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="editorial-panel bg-card p-3 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-taupe">Group progress</p>
              <p className="font-serif text-xl text-coffee">{completedTasks}/{totalTasks} <span className="text-sm text-taupe">· {groupPct}%</span></p>
            </div>
            <div className="editorial-panel bg-card p-3 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-taupe">Your progress</p>
              <p className="font-serif text-xl text-coffee">{myDone}/{myTasks.length} <span className="text-sm text-taupe">· {myPct}%</span></p>
            </div>
          </div>
        </section>

        <aside className="lg:col-span-4 space-y-6 min-w-0 order-2">
          <div className="editorial-panel bg-card p-5 min-w-0">
            <h3 className="font-serif text-2xl mb-3">Your tasks</h3>
            {myTasks.length === 0 ? (
              <p className="text-taupe text-sm italic">No tasks added.</p>
            ) : (
              <ul className="space-y-2">
                {myTasks.map(t => (
                  <li key={t.id} className="flex items-start gap-3 min-w-0">
                    <Checkbox checked={t.completed} onCheckedChange={() => toggleTask(t)} className="mt-0.5 shrink-0" />
                    <span className={`text-sm break-words min-w-0 flex-1 ${t.completed ? "line-through text-taupe" : "text-coffee"}`}>{t.title}</span>
                    {t.visibility === "secret" && <EyeOff className="w-3 h-3 text-taupe shrink-0 mt-1" />}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-taupe">Tap to mark complete. Each tick reveals a puzzle piece.</p>
          </div>

          {session.mode !== "solo" && (
            <div className="editorial-panel bg-card p-5 min-w-0">
              <h3 className="font-serif text-xl mb-3">Members</h3>
              <ul className="space-y-2 text-sm">
                {members.filter(m => m.user_id !== user?.id).map(m => {
                  const ut = tasks.filter(t => t.user_id === m.user_id);
                  const done = ut.filter(t => t.completed).length;
                  return (
                    <li key={m.user_id} className="min-w-0">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="truncate min-w-0">@{m.profile?.username ?? "guest"}</span>
                        <span className="text-taupe shrink-0">{done}/{ut.length}</span>
                      </div>
                      <ul className="mt-1 ml-3 space-y-0.5">
                        {ut.map(t => (
                          <li key={t.id} className="text-xs text-taupe flex items-start gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${t.completed ? "bg-olive" : "bg-border"}`} />
                            {t.visibility === "secret" ? (
                              <span className="italic flex items-center gap-1"><EyeOff className="w-3 h-3" /> Secret task</span>
                            ) : (
                              <span className={`break-words min-w-0 flex-1 ${t.completed ? "line-through" : ""}`}>{t.title}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <PeopleGrid members={members} sessionId={sessionId} userId={user?.id} />
        </aside>
      </main>

      <AnimatePresence>
        {ended && <EndOverlay ok={ended.ok} />}
      </AnimatePresence>
    </div>
  );
};

/* ---------------- Lobby waiting view (for joiners while host hasn't started) ---------------- */
function LobbyView({ session, members, tasks, userId, sessionId, onLeave }: {
  session: any; members: Member[]; tasks: Task[]; userId?: string; sessionId: string; onLeave: () => void;
}) {
  const isHost = session.host_id === userId;
  const myTaskCount = tasks.filter(t => t.user_id === userId).length;

  // If host arrives here (shouldn't normally — they're in /session/setup), redirect them gently
  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments variant="minimal" />
      <main className="container mx-auto px-4 py-10 max-w-2xl">
        <p className="uppercase tracking-[0.3em] text-xs text-taupe mb-3">Lobby</p>
        <h1 className="font-serif text-3xl md:text-4xl">Waiting for the host to begin…</h1>
        <p className="text-coffee/70 mt-2">When everyone is ready, the chapter opens.</p>

        {session.code && (
          <div className="mt-6 editorial-panel bg-blush p-4 flex flex-wrap items-center justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-widest text-taupe">Invitation code</p>
              <p className="font-serif text-2xl tracking-[0.3em] break-all">{session.code}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => {
              navigator.clipboard.writeText(session.code);
              toast.success("Code copied");
            }}><Copy className="w-4 h-4" /> Copy</Button>
          </div>
        )}

        <div className="mt-6 editorial-panel bg-card p-4 min-w-0">
          <p className="text-xs uppercase tracking-widest text-taupe mb-3">Who's here</p>
          <ul className="space-y-2 text-sm">
            {members.map(m => {
              const c = tasks.filter(t => t.user_id === m.user_id).length;
              return (
                <li key={m.user_id} className="flex items-center justify-between gap-2 min-w-0">
                  <span className="truncate min-w-0">@{m.profile?.username ?? "guest"}{m.user_id === userId && " (you)"}{m.user_id === session.host_id && " · host"}</span>
                  <span className={`shrink-0 text-right ${c > 0 ? "text-olive" : "text-taupe italic"}`}>{c > 0 ? `Ready · ${c} task${c > 1 ? "s" : ""}` : "Awaiting…"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-8 flex justify-between gap-3">
          <Button variant="outline" onClick={onLeave}>Leave lobby</Button>
          {isHost && <Button onClick={() => window.location.href = `/session/setup`}>Open host controls</Button>}
        </div>
        {myTaskCount === 0 && (
          <p className="mt-4 text-sm text-destructive">You haven't submitted any tasks yet.</p>
        )}
      </main>
    </div>
  );
}

/* ---------------- Jigsaw puzzle canvas ---------------- */
function JigsawCanvas({ tasks, members, userId, templateUrl }: {
  tasks: Task[]; members: Member[]; userId?: string; templateUrl: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 560 });
  const [imgRatio, setImgRatio] = useState<number | null>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (ref.current) setBox({ w: ref.current.clientWidth, h: Math.max(280, Math.min(620, ref.current.clientWidth * 0.66)) });
    });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  // Load template natural aspect
  useEffect(() => {
    if (!templateUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImgRatio(img.naturalWidth / img.naturalHeight);
    img.src = templateUrl;
  }, [templateUrl]);

  // Fitted rect (object-fit: contain) inside the box
  const fit = useMemo(() => {
    const r = imgRatio ?? (box.w / box.h);
    const boxR = box.w / box.h;
    let w = box.w, h = box.h, x = 0, y = 0;
    if (r > boxR) { h = box.w / r; y = (box.h - h) / 2; }
    else { w = box.h * r; x = (box.w - w) / 2; }
    return { x, y, w, h };
  }, [box, imgRatio]);

  // Grid sized to number of tasks, fitted exactly to image rect (no gaps)
  const total = Math.max(1, tasks.length);
  const { cols, rows } = useMemo(() => {
    let bestCols = 1, bestDiff = Infinity;
    for (let c = 1; c <= total; c++) {
      const r = Math.ceil(total / c);
      const tileRatio = (fit.w / c) / (fit.h / r);
      const diff = Math.abs(tileRatio - 1);
      if (diff < bestDiff) { bestDiff = diff; bestCols = c; }
    }
    return { cols: bestCols, rows: Math.ceil(total / bestCols) };
  }, [total, fit]);

  const tileW = fit.w / cols;
  const tileH = fit.h / rows;

  // Place "extra" pieces (when total < cols*rows) by widening last-row pieces so they still cover
  // Map index -> rectangle covering its share of fit area.
  const rects = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; c: number; r: number }[] = [];
    const lastRowCount = total - (rows - 1) * cols; // pieces in final row
    for (let i = 0; i < total; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const isLastRow = r === rows - 1;
      const countThisRow = isLastRow ? lastRowCount : cols;
      const w = fit.w / countThisRow;
      const x = fit.x + c * w;
      const y = fit.y + r * tileH;
      out.push({ x, y, w, h: tileH, c, r });
    }
    return out;
  }, [total, cols, rows, tileH, fit]);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.user_id < b.user_id) return -1;
      if (a.user_id > b.user_id) return 1;
      return a.position - b.position;
    });
  }, [tasks]);

  const memberMap = useMemo(() => {
    const m = new Map<string, Member>();
    members.forEach(x => m.set(x.user_id, x));
    return m;
  }, [members]);

  return (
    <div ref={ref} className="editorial-panel bg-card p-3 relative">
      <p className="text-xs uppercase tracking-widest text-taupe mb-2">Study canvas · {sortedTasks.length} pieces</p>
      <div className="relative" style={{ width: "100%", height: box.h, background: "hsl(var(--ivory))" }}>
        <svg width={box.w} height={box.h} className="block">
          <defs>
            <clipPath id="fit-clip"><rect x={fit.x} y={fit.y} width={fit.w} height={fit.h} /></clipPath>
          </defs>
          {/* Ivory backdrop board where the image sits (clear, no overlay) */}
          <rect x={fit.x} y={fit.y} width={fit.w} height={fit.h} fill="hsl(var(--sand) / 0.35)" />
          {/* Faint grid of unrevealed pieces */}
          {sortedTasks.map((t, idx) => {
            const r = rects[idx];
            return (
              <rect key={`bg-${t.id}`} x={r.x} y={r.y} width={r.w} height={r.h}
                fill="hsl(var(--sand) / 0.25)" stroke="hsl(var(--coffee) / 0.18)" strokeWidth="1" />
            );
          })}
          {/* Revealed pieces: each shows the corresponding slice of the template */}
          {sortedTasks.map((t, idx) => {
            const r = rects[idx];
            if (!t.completed) return null;
            return (
              <motion.g key={`rv-${t.id}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                style={{ transformOrigin: `${r.x + r.w / 2}px ${r.y + r.h / 2}px` }}
              >
                <clipPath id={`pc-${idx}`}><rect x={r.x} y={r.y} width={r.w} height={r.h} /></clipPath>
                <g clipPath={`url(#pc-${idx})`}>
                  <image href={templateUrl} x={fit.x} y={fit.y} width={fit.w} height={fit.h}
                    preserveAspectRatio="none" />
                </g>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none"
                  stroke="hsl(var(--coffee))" strokeWidth="1.2" opacity="0.55" />
              </motion.g>
            );
          })}
          {/* Hover hit-test layer */}
          {sortedTasks.map((t, idx) => {
            const r = rects[idx];
            return (
              <rect key={`hit-${t.id}`} x={r.x} y={r.y} width={r.w} height={r.h}
                fill="transparent"
                onMouseMove={(e) => {
                  const svgRect = (e.currentTarget.ownerSVGElement!.getBoundingClientRect());
                  setHover({ idx, x: e.clientX - svgRect.left, y: e.clientY - svgRect.top });
                }}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>

        {hover && sortedTasks[hover.idx] && (() => {
          const t = sortedTasks[hover.idx];
          const owner = memberMap.get(t.user_id);
          const isMine = t.user_id === userId;
          const showText = isMine || t.visibility !== "secret";
          const ownerTasks = sortedTasks.filter(x => x.user_id === t.user_id);
          const done = ownerTasks.filter(x => x.completed).length;
          return (
            <div className="absolute pointer-events-none bg-ivory border border-border px-3 py-2 text-xs shadow-md z-10"
              style={{ left: Math.min(hover.x + 12, box.w - 180), top: Math.min(hover.y + 12, box.h - 60) }}>
              <div className="font-serif text-sm text-coffee">@{owner?.profile?.username ?? "guest"}</div>
              <div className="text-taupe">{done}/{ownerTasks.length} complete</div>
              <div className="mt-1 text-coffee/80">
                {showText ? t.title : <span className="italic flex items-center gap-1"><EyeOff className="w-3 h-3" /> Secret task</span>}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ---------------- WebRTC People Grid ---------------- */
// Mesh P2P with Supabase Realtime broadcast as signaling.
// Metered ICE defaults; overridable via VITE_WEBRTC_* env vars.
const METERED_DEFAULTS = {
  stun: "stun:stun.relay.metered.ca:80",
  turnUrls: [
    "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443",
    "turns:global.relay.metered.ca:443?transport=tcp",
  ],
  user: "7994e1537e170f97269ef54d",
  cred: "JMUIK1fpGE3dVz9Z",
};
function buildRtcConfig(): RTCConfiguration {
  const stunUrl = (import.meta.env.VITE_WEBRTC_STUN_URL as string | undefined) || METERED_DEFAULTS.stun;
  const turnUrlEnv = import.meta.env.VITE_WEBRTC_TURN_URL as string | undefined;
  const turnUser = (import.meta.env.VITE_WEBRTC_TURN_USERNAME as string | undefined) || METERED_DEFAULTS.user;
  const turnCred = (import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL as string | undefined) || METERED_DEFAULTS.cred;
  const envTurnUrls = turnUrlEnv?.split(/[\s,]+/).map(url => url.trim()).filter(Boolean) ?? [];
  const turnUrls = envTurnUrls.some(url => url.includes("global.relay.metered.ca")) || envTurnUrls.length === 0
    ? METERED_DEFAULTS.turnUrls
    : envTurnUrls;
  const turnReady = !!(turnUrls.length && turnUser && turnCred);
  if (turnReady) {
    return {
      iceTransportPolicy: "relay",
      iceServers: [
        { urls: [stunUrl] },
        { urls: turnUrls, username: turnUser, credential: turnCred },
      ],
    };
  }
  return { iceTransportPolicy: "all", iceServers: stunUrl ? [{ urls: [stunUrl] }] : [] };
}
const RTC_CONFIG: RTCConfiguration = buildRtcConfig();
const HAS_STUN = !!RTC_CONFIG.iceServers?.some(s => String(s.urls).includes("stun"));
const HAS_TURN = !!RTC_CONFIG.iceServers?.some(s => String(s.urls).includes("turn"));
const ICE_POLICY = (RTC_CONFIG as any).iceTransportPolicy || "all";
console.log(`[WebRTC] TURN configured: ${HAS_TURN} | ICE policy: ${ICE_POLICY} | ICE servers: ${RTC_CONFIG.iceServers?.length ?? 0}`);
const ICE_TIMEOUT_MS = 15000;
const MAX_PEERS = 6;

type SignalKind = "offer" | "answer" | "ice";
type SignalPayload = {
  session_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  from?: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const peerLabel = (peerId: string) => peerId.slice(0, 6);

const candidateType = (candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined) => {
  const explicitType = (candidate as any)?.type as string | undefined;
  if (explicitType) return explicitType;
  const text = (candidate as any)?.candidate as string | undefined;
  return text?.match(/ typ (host|srflx|prflx|relay)( |$)/)?.[1] ?? "unknown";
};

function PeopleGrid({ members, sessionId, userId }: { members: Member[]; sessionId: string; userId?: string }) {
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferRef = useRef<Map<string, boolean>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const relayCandidateCountRef = useRef<Map<string, number>>(new Map());
  const iceTimersRef = useRef<Map<string, number>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteMuted, setRemoteMuted] = useState<Record<string, { cam: boolean; mic: boolean }>>({});
  const [peerWarnings, setPeerWarnings] = useState<Record<string, string>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [, force] = useState(0);

  const sendSignal = useCallback((event: SignalKind, toUserId: string, payload: Omit<SignalPayload, "session_id" | "from_user_id" | "to_user_id" | "from" | "to">) => {
    if (!channelRef.current || !userId) return;
    console.log(`[WebRTC] ${event === "ice" ? "ICE candidate" : event} sent to ${peerLabel(toUserId)}`);
    channelRef.current.send({
      type: "broadcast",
      event,
      payload: { session_id: sessionId, from_user_id: userId, to_user_id: toUserId, ...payload },
    });
  }, [sessionId, userId]);

  const readSignal = useCallback((payload: SignalPayload) => {
    const from = payload.from_user_id ?? payload.from;
    const to = payload.to_user_id ?? payload.to;
    if (!from || !to) return null;
    if (payload.session_id && payload.session_id !== sessionId) return null;
    if (from === userId || to !== userId) return null;
    return { from, to };
  }, [sessionId, userId]);

  const flushQueuedCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerId) ?? [];
    if (!queued.length || !pc.remoteDescription) return;
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error(`[WebRTC] add queued ICE candidate failed for ${peerLabel(peerId)}`, (e as Error)?.name);
      }
    }
  }, []);

  const broadcastState = useCallback((cam: boolean, mic: boolean) => {
    channelRef.current?.send({ type: "broadcast", event: "media-state", payload: { from: userId, cam, mic } });
  }, [userId]);

  const attachLocalTracksToPeer = (pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const senders = pc.getSenders();
    stream.getTracks().forEach(track => {
      const sender = senders.find(s => s.track?.kind === track.kind);
      if (sender) {
        sender.replaceTrack(track).catch(e => console.error("replaceTrack failed", e?.name));
      } else {
        pc.addTrack(track, stream);
      }
    });
  };

  const removeLocalTracksFromPeer = (pc: RTCPeerConnection) => {
    pc.getSenders().forEach(s => { if (s.track) { try { pc.removeTrack(s); } catch {} } });
  };

  const ensureLocalStream = useCallback(async (wantCam: boolean, wantMic: boolean) => {
    if (!wantCam && !wantMic) {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      peersRef.current.forEach(pc => removeLocalTracksFromPeer(pc));
      force(n => n + 1);
      return null;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: wantCam, audio: wantMic });
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = s;
      setDenied(false);
      peersRef.current.forEach(pc => attachLocalTracksToPeer(pc));
      force(n => n + 1);
      return s;
    } catch (err: any) {
      console.error("getUserMedia failed", err?.name);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        setDenied(true);
        toast.error("Camera/mic permission denied. Enable it in your browser settings.");
      } else {
        toast.error(`Could not access camera/mic: ${err?.message ?? "unknown"}`);
      }
      setCamOn(false); setMicOn(false);
      return null;
    }
  }, []);

  const toggleCam = async () => {
    const next = !camOn;
    setCamOn(next);
    await ensureLocalStream(next, micOn);
    broadcastState(next, micOn);
  };
  const toggleMic = async () => {
    const next = !micOn;
    setMicOn(next);
    await ensureLocalStream(camOn, next);
    broadcastState(camOn, next);
  };

  const startIceTimer = (peerId: string) => {
    const existing = iceTimersRef.current.get(peerId);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      const pc = peersRef.current.get(peerId);
      if (!pc) return;
      if (pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
        const relays = relayCandidateCountRef.current.get(peerId) ?? 0;
        const message = ICE_POLICY === "relay" && relays === 0
          ? "TURN server did not return relay candidates. Check TURN URL, username, credential, or provider quota."
          : "TURN candidates gathered, but signaling or peer negotiation failed.";
        setPeerWarnings(prev => ({ ...prev, [peerId]: message }));
        toast.error(message);
      }
    }, ICE_TIMEOUT_MS);
    iceTimersRef.current.set(peerId, t as unknown as number);
  };

  const createPeer = useCallback((peerId: string, polite: boolean) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(peerId, pc);
    makingOfferRef.current.set(peerId, false);
    ignoreOfferRef.current.set(peerId, false);
    relayCandidateCountRef.current.set(peerId, 0);

    if (localStreamRef.current) attachLocalTracksToPeer(pc);

    pc.ontrack = (e) => {
      console.log(`[WebRTC] remote track received from ${peerLabel(peerId)}: ${e.track.kind}`);
      const [incoming] = e.streams;
      setRemoteStreams(prev => {
        const stream = prev[peerId] ?? incoming ?? new MediaStream();
        if (!stream.getTracks().some(track => track.id === e.track.id)) stream.addTrack(e.track);
        return { ...prev, [peerId]: stream };
      });
      e.track.onunmute = () => setPeerWarnings(prev => { const n = { ...prev }; delete n[peerId]; return n; });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const type = candidateType(e.candidate);
        if (type === "relay") relayCandidateCountRef.current.set(peerId, (relayCandidateCountRef.current.get(peerId) ?? 0) + 1);
        console.log(`[WebRTC] candidate gathered for ${peerLabel(peerId)}: ${type}; relay total: ${relayCandidateCountRef.current.get(peerId) ?? 0}`);
        sendSignal("ice", peerId, { candidate: e.candidate.toJSON() });
      }
    };
    pc.onicegatheringstatechange = () => {
      console.log(`[WebRTC] ICE gathering state for ${peerLabel(peerId)}: ${pc.iceGatheringState}`);
      if (pc.iceGatheringState === "complete" && ICE_POLICY === "relay" && (relayCandidateCountRef.current.get(peerId) ?? 0) === 0) {
        const message = "TURN server did not return relay candidates. Check TURN URL, username, credential, or provider quota.";
        setPeerWarnings(prev => ({ ...prev, [peerId]: message }));
        toast.error(message);
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        makingOfferRef.current.set(peerId, true);
        await pc.setLocalDescription();
        sendSignal("offer", peerId, { sdp: pc.localDescription?.toJSON() });
      } catch (e) {
        console.error(`[WebRTC] negotiation failed for ${peerLabel(peerId)}`, (e as Error)?.name);
      } finally {
        makingOfferRef.current.set(peerId, false);
      }
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      console.log(`[WebRTC] ICE connection state for ${peerLabel(peerId)}: ${st}`);
      if (st === "checking" || st === "new") {
        startIceTimer(peerId);
      } else if (st === "connected" || st === "completed") {
        const t = iceTimersRef.current.get(peerId);
        if (t) window.clearTimeout(t);
        setPeerWarnings(prev => { const n = { ...prev }; delete n[peerId]; return n; });
      } else if (st === "failed") {
        const relays = relayCandidateCountRef.current.get(peerId) ?? 0;
        const message = ICE_POLICY === "relay" && relays === 0
          ? "TURN server did not return relay candidates. Check TURN URL, username, credential, or provider quota."
          : "TURN candidates gathered, but signaling or peer negotiation failed.";
        setPeerWarnings(prev => ({ ...prev, [peerId]: message }));
        toast.error(message);
        try { pc.restartIce(); } catch {}
      }
    };
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] peer connection state for ${peerLabel(peerId)}: ${pc.connectionState}`);
    };
    return pc;
  }, [sendSignal]);

  const closePeer = (peerId: string) => {
    const pc = peersRef.current.get(peerId);
    pc?.close();
    peersRef.current.delete(peerId);
    const t = iceTimersRef.current.get(peerId);
    if (t) window.clearTimeout(t);
    iceTimersRef.current.delete(peerId);
    setRemoteStreams(prev => { const n = { ...prev }; delete n[peerId]; return n; });
    setRemoteMuted(prev => { const n = { ...prev }; delete n[peerId]; return n; });
    setPeerWarnings(prev => { const n = { ...prev }; delete n[peerId]; return n; });
    makingOfferRef.current.delete(peerId);
    ignoreOfferRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);
    relayCandidateCountRef.current.delete(peerId);
  };

  useEffect(() => {
    if (!userId || !sessionId) return;
    const ch = supabase.channel(`rtc:${sessionId}`, { config: { broadcast: { self: false }, presence: { key: userId } } });
    channelRef.current = ch;

    ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
      const signal = readSignal(payload);
      if (!signal) return;
      console.log(`[WebRTC] offer received from ${peerLabel(signal.from)}`);
      const polite = userId > signal.from;
      const pc = peersRef.current.get(signal.from) ?? createPeer(signal.from, polite);
      const making = makingOfferRef.current.get(signal.from) || false;
      const offerCollision = making || pc.signalingState !== "stable";
      ignoreOfferRef.current.set(signal.from, !polite && offerCollision);
      if (ignoreOfferRef.current.get(signal.from)) return;
      try {
        if (offerCollision) {
          await Promise.all([
            (pc as any).setLocalDescription({ type: "rollback" }).catch(() => {}),
            pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
        await flushQueuedCandidates(signal.from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal("answer", signal.from, { sdp: pc.localDescription?.toJSON() });
      } catch (e) { console.error(`[WebRTC] answer failed for ${peerLabel(signal.from)}`, (e as Error)?.name); }
    });
    ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
      const signal = readSignal(payload);
      if (!signal) return;
      console.log(`[WebRTC] answer received from ${peerLabel(signal.from)}`);
      const pc = peersRef.current.get(signal.from);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushQueuedCandidates(signal.from, pc);
      }
      catch (e) { console.error(`[WebRTC] set answer failed for ${peerLabel(signal.from)}`, (e as Error)?.name); }
    });
    ch.on("broadcast", { event: "ice" }, async ({ payload }) => {
      const signal = readSignal(payload);
      if (!signal) return;
      console.log(`[WebRTC] ICE candidate received from ${peerLabel(signal.from)}: ${candidateType(payload.candidate)}`);
      const pc = peersRef.current.get(signal.from);
      if (!pc) return;
      if (!pc.remoteDescription) {
        const queued = pendingCandidatesRef.current.get(signal.from) ?? [];
        pendingCandidatesRef.current.set(signal.from, [...queued, payload.candidate]);
        return;
      }
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
      catch (e) { console.error(`[WebRTC] add ICE candidate failed for ${peerLabel(signal.from)}`, (e as Error)?.name); }
    });
    ch.on("broadcast", { event: "media-state" }, ({ payload }) => {
      if (!payload?.from || payload.from === userId) return;
      setRemoteMuted(prev => ({ ...prev, [payload.from]: { cam: !!payload.cam, mic: !!payload.mic } }));
    });
    ch.on("presence", { event: "join" }, ({ key }) => {
      if (key === userId) return;
      if (userId < key && peersRef.current.size < MAX_PEERS) {
        const pc = createPeer(key, false);
        try {
          if (pc.getTransceivers().length === 0) {
            pc.addTransceiver("video", { direction: "recvonly" });
            pc.addTransceiver("audio", { direction: "recvonly" });
          }
        } catch {}
      }
    });
    ch.on("presence", { event: "leave" }, ({ key }) => {
      if (key !== userId) closePeer(key);
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ user_id: userId });
        // Re-broadcast our current media state so late joiners learn it
        broadcastState(camOn, micOn);
      }
    });

    return () => {
      peersRef.current.forEach(pc => pc.close());
      peersRef.current.clear();
      iceTimersRef.current.forEach(t => window.clearTimeout(t));
      iceTimersRef.current.clear();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sessionId]);

  return (
    <div className="editorial-panel bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif text-2xl">In the room</h3>
        <div className="flex gap-2">
          <button onClick={toggleCam} title={camOn ? "Turn camera off" : "Turn camera on"}
            className={`p-2 rounded-sm border ${camOn ? "bg-coffee text-ivory" : "bg-ivory text-coffee border-border"}`}>
            {camOn ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
          </button>
          <button onClick={toggleMic} title={micOn ? "Mute mic" : "Unmute mic"}
            className={`p-2 rounded-sm border ${micOn ? "bg-coffee text-ivory" : "bg-ivory text-coffee border-border"}`}>
            {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {denied && <p className="text-xs text-destructive mb-2">Camera/mic blocked. Check browser permissions.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
        {members.slice(0, MAX_PEERS).map(m => {
          const isMe = m.user_id === userId;
          const stream = isMe ? localStreamRef.current : remoteStreams[m.user_id];
          const mediaState = remoteMuted[m.user_id];
          const camActive = isMe ? camOn : (mediaState?.cam ?? false);
          const micActive = isMe ? micOn : (mediaState?.mic ?? false);
          const status = isMe
            ? (camOn || micOn ? null : "Camera off")
            : peerWarnings[m.user_id]
              ? peerWarnings[m.user_id]
              : mediaState === undefined
                ? "Waiting for media"
                : (!camActive && !micActive ? "Camera off" : null);
          return (
            <RemoteTile key={m.user_id} member={m} stream={stream} camOn={camActive} micOn={micActive} isMe={isMe} status={status} />
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-taupe italic">
        P2P video over {HAS_TURN ? "STUN + TURN" : "STUN only"}.{HAS_TURN ? "" : " Strict networks may need TURN."}
      </p>
    </div>
  );
}

function RemoteTile({ member, stream, camOn, micOn, isMe, status }: {
  member: Member; stream: MediaStream | null | undefined; camOn: boolean; micOn: boolean; isMe: boolean; status?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasFrames, setHasFrames] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== (stream ?? null)) {
      v.srcObject = stream ?? null;
      setHasFrames(false);
    }
    if (!stream) return;
    const onPlaying = () => setHasFrames(true);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("loadeddata", onPlaying);
    return () => {
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("loadeddata", onPlaying);
    };
  }, [stream]);
  const initials = (member.profile?.username ?? "?").trim().slice(0, 2).toUpperCase();
  const showVideo = camOn && !!stream;
  return (
    <div className="aspect-video bg-cocoa relative overflow-hidden border border-border/60">
      {showVideo ? (
        <>
          <video ref={videoRef} autoPlay playsInline muted={isMe} className="w-full h-full object-cover" />
          {!isMe && !hasFrames && (
            <div className="absolute inset-0 grid place-items-center bg-cocoa/70">
              <div className="text-[10px] uppercase tracking-widest text-ivory/80">Connecting video…</div>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full grid place-items-center bg-sand">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-coffee text-ivory font-serif text-xl grid place-items-center">
              {initials || "?"}
            </div>
            {status && <div className="mt-1 text-[10px] uppercase tracking-widest text-coffee/70">{status}</div>}
          </div>
        </div>
      )}
      <div className="absolute bottom-1 left-2 right-8 text-xs text-ivory bg-coffee/70 px-1.5 py-0.5 rounded-sm truncate">
        @{member.profile?.username ?? "guest"}{isMe && " (you)"}
      </div>
      {!micOn && (
        <div className="absolute bottom-1 right-1 bg-coffee/80 text-ivory p-1 rounded-sm">
          <MicOff className="w-3 h-3" />
        </div>
      )}
    </div>
  );
}

function EndOverlay({ ok }: { ok: boolean }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-ivory/95 grid place-items-center">
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-center">
        {ok ? (
          <>
            <div className="flex justify-center gap-2 mb-4">
              {[0, 1, 2].map(i => (
                <motion.div key={i} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.15 }}>
                  <Star className="w-12 h-12 text-star fill-star" />
                </motion.div>
              ))}
            </div>
            <h2 className="font-serif text-3xl md:text-5xl text-coffee">A chapter complete.</h2>
            <p className="text-coffee/70 mt-3">Stars and progress recorded.</p>
          </>
        ) : (
          <>
            <motion.div animate={{ rotate: [0, -3, 3, 0], opacity: [1, 0.6, 0.3] }} transition={{ duration: 0.8 }}>
              <h2 className="font-serif text-3xl md:text-5xl text-destructive">The page tore.</h2>
            </motion.div>
            <p className="text-coffee/70 mt-3">A penalty has been recorded. Try again soon.</p>
          </>
        )}
        <p className="text-xs text-taupe mt-6 uppercase tracking-widest">Returning to your desk…</p>
      </motion.div>
    </motion.div>
  );
}

export default Session;
