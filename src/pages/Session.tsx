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
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#C99678", "#4B2E24", "#EBD8CC", "#8A8A66"] });
      }
      setTimeout(() => nav("/dashboard"), 4000);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to finalize");
      finalizeStarted.current = false;
    }
  }, [sessionId, totalElapsedSec, nav]);

  // Auto-finalize when timer hits 0 (host only)
  useEffect(() => {
    if (!session || !user) return;
    if (session.status !== "active") return;
    if (session.host_id !== user.id) return;
    if (startedAt && remainingSec === 0 && !finalizeStarted.current) {
      finalize(true);
    }
  }, [session, user, startedAt, remainingSec, finalize]);

  // Auto-end on full success (host only)
  useEffect(() => {
    if (!session || !user) return;
    if (session.status !== "active") return;
    if (session.host_id !== user.id) return;
    if (tasks.length > 0 && tasks.every(t => t.completed) && !finalizeStarted.current) {
      finalize(true);
    }
  }, [session, user, tasks, finalize]);

  useEffect(() => {
    if (!session) return;
    if (session.status === "completed" || session.status === "failed") {
      if (!ended) setEnded({ ok: session.status === "completed" });
      const t = setTimeout(() => nav("/dashboard"), 4000);
      return () => clearTimeout(t);
    }
  }, [session, ended, nav]);

  const myTasks = tasks.filter(t => t.user_id === user?.id);
  const toggleTask = async (t: Task) => {
    if (!user) return;
    if (session?.status !== "active") return;
    const { error } = await supabase.from("tasks").update({ completed: !t.completed }).eq("id", t.id);
    if (error) showSbError("Could not update task", error);
  };

  // Leaving an active session = whole session fails for everyone
  const exitFail = async () => {
    if (!session) return nav("/dashboard");
    if (session.status === "active" || session.status === "lobby") {
      const allDone = tasks.length > 0 && tasks.every(t => t.completed);
      await finalize(allDone);
    } else {
      nav("/dashboard");
    }
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
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            <p className="font-serif text-lg md:text-xl text-coffee">FocusForge<span className="text-clay">.</span></p>
            <span className="text-[10px] md:text-xs uppercase tracking-widest text-taupe truncate">{session.mode === "solo" ? "Solo" : "Group"} · {session.timer_type}</span>
          </div>
          <div className="font-serif text-2xl md:text-3xl tabular-nums order-3 md:order-none w-full md:w-auto text-center">{fmt(remainingSec)}</div>
          <Button variant="outline" size="sm" onClick={exitFail}>
            <X className="w-4 h-4" /> {session.host_id === user?.id ? "End" : "Leave"}
          </Button>
        </div>
        <div className="h-1 bg-sand">
          <div className="h-full bg-coffee transition-all" style={{ width: `${duration ? Math.min(100, ((duration - remainingSec) / duration) * 100) : 0}%` }} />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 md:py-8 grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8">
          <JigsawCanvas tasks={tasks} members={members} userId={user?.id} templateUrl={session.template_url} />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="editorial-panel bg-card p-3">
              <p className="text-[10px] uppercase tracking-widest text-taupe">Group progress</p>
              <p className="font-serif text-xl text-coffee">{completedTasks}/{totalTasks} <span className="text-sm text-taupe">· {groupPct}%</span></p>
            </div>
            <div className="editorial-panel bg-card p-3">
              <p className="text-[10px] uppercase tracking-widest text-taupe">Your progress</p>
              <p className="font-serif text-xl text-coffee">{myDone}/{myTasks.length} <span className="text-sm text-taupe">· {myPct}%</span></p>
            </div>
          </div>
        </section>

        <aside className="lg:col-span-4 space-y-6">
          <div className="editorial-panel bg-card p-5">
            <h3 className="font-serif text-2xl mb-3">Your tasks</h3>
            {myTasks.length === 0 ? (
              <p className="text-taupe text-sm italic">No tasks added.</p>
            ) : (
              <ul className="space-y-2">
                {myTasks.map(t => (
                  <li key={t.id} className="flex items-center gap-3">
                    <Checkbox checked={t.completed} onCheckedChange={() => toggleTask(t)} />
                    <span className={`text-sm ${t.completed ? "line-through text-taupe" : "text-coffee"}`}>{t.title}</span>
                    {t.visibility === "secret" && <EyeOff className="w-3 h-3 text-taupe" />}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-taupe">Tap to mark complete. Each tick reveals a puzzle piece.</p>
          </div>

          {session.mode !== "solo" && (
            <div className="editorial-panel bg-card p-5">
              <h3 className="font-serif text-xl mb-3">Members</h3>
              <ul className="space-y-2 text-sm">
                {members.filter(m => m.user_id !== user?.id).map(m => {
                  const ut = tasks.filter(t => t.user_id === m.user_id);
                  const done = ut.filter(t => t.completed).length;
                  return (
                    <li key={m.user_id}>
                      <div className="flex items-center justify-between">
                        <span>@{m.profile?.username ?? "guest"}</span>
                        <span className="text-taupe">{done}/{ut.length}</span>
                      </div>
                      <ul className="mt-1 ml-3 space-y-0.5">
                        {ut.map(t => (
                          <li key={t.id} className="text-xs text-taupe flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${t.completed ? "bg-olive" : "bg-border"}`} />
                            {t.visibility === "secret" ? (
                              <span className="italic flex items-center gap-1"><EyeOff className="w-3 h-3" /> Secret task</span>
                            ) : (
                              <span className={t.completed ? "line-through" : ""}>{t.title}</span>
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
          <div className="mt-6 editorial-panel bg-blush p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-taupe">Invitation code</p>
              <p className="font-serif text-2xl tracking-[0.3em]">{session.code}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              navigator.clipboard.writeText(session.code);
              toast.success("Code copied");
            }}><Copy className="w-4 h-4" /> Copy</Button>
          </div>
        )}

        <div className="mt-6 editorial-panel bg-card p-4">
          <p className="text-xs uppercase tracking-widest text-taupe mb-3">Who's here</p>
          <ul className="space-y-2 text-sm">
            {members.map(m => {
              const c = tasks.filter(t => t.user_id === m.user_id).length;
              return (
                <li key={m.user_id} className="flex items-center justify-between">
                  <span>@{m.profile?.username ?? "guest"}{m.user_id === userId && " (you)"}{m.user_id === session.host_id && " · host"}</span>
                  <span className={c > 0 ? "text-olive" : "text-taupe italic"}>{c > 0 ? `Ready · ${c} task${c > 1 ? "s" : ""}` : "Awaiting tasks…"}</span>
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
// STUN always on; TURN added when all VITE_WEBRTC_TURN_* env vars are present.
function buildRtcConfig(): RTCConfiguration {
  const stunUrl = (import.meta.env.VITE_WEBRTC_STUN_URL as string | undefined) || "stun:stun.l.google.com:19302";
  const turnUrl = import.meta.env.VITE_WEBRTC_TURN_URL as string | undefined;
  const turnUser = import.meta.env.VITE_WEBRTC_TURN_USERNAME as string | undefined;
  const turnCred = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL as string | undefined;
  const iceServers: RTCIceServer[] = [{ urls: stunUrl }];
  if (turnUrl && turnUser && turnCred) {
    iceServers.push({ urls: turnUrl, username: turnUser, credential: turnCred });
  }
  return { iceServers };
}
const RTC_CONFIG: RTCConfiguration = buildRtcConfig();
const HAS_TURN = !!(import.meta.env.VITE_WEBRTC_TURN_URL && import.meta.env.VITE_WEBRTC_TURN_USERNAME && import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL);
const ICE_TIMEOUT_MS = 15000;
const MAX_PEERS = 6;

function PeopleGrid({ members, sessionId, userId }: { members: Member[]; sessionId: string; userId?: string }) {
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteMuted, setRemoteMuted] = useState<Record<string, { cam: boolean; mic: boolean }>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const ensureLocalStream = useCallback(async (wantCam: boolean, wantMic: boolean) => {
    if (!wantCam && !wantMic) {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      // Remove tracks from all peers
      peersRef.current.forEach(pc => pc.getSenders().forEach(s => s.track && pc.removeTrack(s)));
      return null;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: wantCam, audio: wantMic });
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = s;
      setDenied(false);
      // Attach to existing peers
      peersRef.current.forEach(pc => {
        s.getTracks().forEach(t => pc.addTrack(t, s));
      });
      return s;
    } catch (err: any) {
      console.error("getUserMedia failed", err);
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

  // Toggle handlers
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

  const broadcastState = (cam: boolean, mic: boolean) => {
    channelRef.current?.send({ type: "broadcast", event: "media-state", payload: { from: userId, cam, mic } });
  };

  const createPeer = useCallback((peerId: string, initiator: boolean) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(peerId, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
    }

    pc.ontrack = (e) => {
      setRemoteStreams(prev => ({ ...prev, [peerId]: e.streams[0] }));
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        channelRef.current?.send({ type: "broadcast", event: "ice", payload: { from: userId, to: peerId, candidate: e.candidate } });
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        // Will be cleaned on member leave
      }
    };

    if (initiator) {
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channelRef.current?.send({ type: "broadcast", event: "offer", payload: { from: userId, to: peerId, sdp: offer } });
        } catch (e) { console.error("offer failed", e); }
      })();
    }
    return pc;
  }, [userId]);

  const closePeer = (peerId: string) => {
    const pc = peersRef.current.get(peerId);
    pc?.close();
    peersRef.current.delete(peerId);
    setRemoteStreams(prev => { const n = { ...prev }; delete n[peerId]; return n; });
    setRemoteMuted(prev => { const n = { ...prev }; delete n[peerId]; return n; });
  };

  // Signaling channel
  useEffect(() => {
    if (!userId || !sessionId) return;
    const ch = supabase.channel(`rtc:${sessionId}`, { config: { broadcast: { self: false }, presence: { key: userId } } });
    channelRef.current = ch;

    ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
      if (payload.to !== userId) return;
      const pc = createPeer(payload.from, false);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ch.send({ type: "broadcast", event: "answer", payload: { from: userId, to: payload.from, sdp: answer } });
      } catch (e) { console.error("answer failed", e); }
    });
    ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
      if (payload.to !== userId) return;
      const pc = peersRef.current.get(payload.from);
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)); }
      catch (e) { console.error("setRemoteDescription answer", e); }
    });
    ch.on("broadcast", { event: "ice" }, async ({ payload }) => {
      if (payload.to !== userId) return;
      const pc = peersRef.current.get(payload.from);
      if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
      catch (e) { console.error("addIceCandidate", e); }
    });
    ch.on("broadcast", { event: "media-state" }, ({ payload }) => {
      if (!payload?.from || payload.from === userId) return;
      setRemoteMuted(prev => ({ ...prev, [payload.from]: { cam: !!payload.cam, mic: !!payload.mic } }));
    });
    ch.on("presence", { event: "join" }, ({ key }) => {
      if (key === userId) return;
      // Lower id initiates to avoid double-offer
      if (userId < key && peersRef.current.size < MAX_PEERS) {
        createPeer(key, true);
      }
    });
    ch.on("presence", { event: "leave" }, ({ key }) => {
      if (key !== userId) closePeer(key);
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ user_id: userId });
      }
    });

    return () => {
      peersRef.current.forEach(pc => pc.close());
      peersRef.current.clear();
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
      <div className="grid grid-cols-2 gap-3">
        {members.slice(0, MAX_PEERS).map(m => {
          const isMe = m.user_id === userId;
          const stream = isMe ? localStreamRef.current : remoteStreams[m.user_id];
          const camActive = isMe ? camOn : (remoteMuted[m.user_id]?.cam ?? false);
          const micActive = isMe ? micOn : (remoteMuted[m.user_id]?.mic ?? false);
          return (
            <RemoteTile key={m.user_id} member={m} stream={stream} camOn={camActive} micOn={micActive} isMe={isMe} />
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-taupe italic">P2P video over free STUN. Strict networks may need TURN.</p>
    </div>
  );
}

function RemoteTile({ member, stream, camOn, micOn, isMe }: {
  member: Member; stream: MediaStream | null | undefined; camOn: boolean; micOn: boolean; isMe: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);
  return (
    <div className="aspect-video bg-cocoa relative overflow-hidden border border-border/60">
      {camOn && stream ? (
        <video ref={videoRef} autoPlay playsInline muted={isMe} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center bg-sand">
          <span className="font-serif text-2xl text-coffee">{(member.profile?.username ?? "?")[0]?.toUpperCase()}</span>
        </div>
      )}
      <div className="absolute bottom-1 left-2 text-xs text-ivory bg-coffee/70 px-1.5 py-0.5 rounded-sm">
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
