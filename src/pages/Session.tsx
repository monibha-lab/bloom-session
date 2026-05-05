import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Delaunay } from "d3-delaunay";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Camera, CameraOff, Mic, MicOff, X, Star } from "lucide-react";
import { toast } from "sonner";

type Profile = { id: string; username: string | null; avatar_url: string | null };
type Member = { user_id: string; profile?: Profile };
type Task = { id: string; user_id: string; title: string; completed: boolean; position: number };

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

  // load + realtime
  const loadAll = useCallback(async () => {
    const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
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
        try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=").play().catch(() => {}); } catch {}
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

  // If session moved to completed/failed (e.g. by host), navigate after 4s
  useEffect(() => {
    if (!session) return;
    if (session.status === "completed" || session.status === "failed") {
      if (!ended) setEnded({ ok: session.status === "completed" });
      setTimeout(() => nav("/dashboard"), 4000);
    }
  }, [session, ended, nav]);

  const myTasks = tasks.filter(t => t.user_id === user?.id);
  const toggleTask = async (t: Task) => {
    if (!user) return;
    if (session?.status !== "active") return;
    await supabase.from("tasks").update({ completed: !t.completed }).eq("id", t.id);
  };

  const exitFail = async () => {
    if (session?.host_id === user?.id) {
      await finalize(false);
    } else {
      // member quits -> just leave
      await supabase.from("session_members").delete().eq("session_id", sessionId).eq("user_id", user!.id);
      nav("/dashboard");
    }
  };

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  };

  if (!session) {
    return <div className="min-h-screen flex items-center justify-center text-coffee/70 italic">Loading session…</div>;
  }

  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments variant="minimal" />

      {/* Top timer bar */}
      <header className="relative z-10 border-b border-border/60 bg-ivory/80 backdrop-blur">
        <div className="container mx-auto py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <p className="font-serif text-xl text-coffee">FocusForge<span className="text-clay">.</span></p>
            <span className="text-xs uppercase tracking-widest text-taupe">{session.mode === "solo" ? "Solo" : "Group"} · {session.timer_type}</span>
          </div>
          <div className="font-serif text-3xl tabular-nums">{fmt(remainingSec)}</div>
          <Button variant="outline" size="sm" onClick={exitFail}>
            <X className="w-4 h-4" /> {session.host_id === user?.id ? "End" : "Leave"}
          </Button>
        </div>
        <div className="h-1 bg-sand">
          <div className="h-full bg-coffee transition-all" style={{ width: `${duration ? Math.min(100, ((duration - remainingSec) / duration) * 100) : 0}%` }} />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-8">
          <VoronoiCanvas members={members} tasks={tasks} templateUrl={session.template_url} />
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
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-taupe">Tap to mark complete. The scene reveals as you progress.</p>
          </div>

          <PeopleGrid members={members} />
        </aside>
      </main>

      <AnimatePresence>
        {ended && <EndOverlay ok={ended.ok} />}
      </AnimatePresence>
    </div>
  );
};

function VoronoiCanvas({ members, tasks, templateUrl }: { members: Member[]; tasks: Task[]; templateUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<{ x: number; y: number; member: Member; done: number; total: number } | null>(null);

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (ref.current) setSize({ w: ref.current.clientWidth, h: Math.max(400, ref.current.clientWidth * 0.7) });
    });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const points = useMemo(() => {
    const n = Math.max(1, members.length);
    return members.map((_, i) => {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const c = i % cols, r = Math.floor(i / cols);
      return [
        size.w * (c + 0.5 + (Math.sin(i * 7.7) * 0.15)) / cols,
        size.h * (r + 0.5 + (Math.cos(i * 5.3) * 0.15)) / rows,
      ] as [number, number];
    });
  }, [members, size]);

  const polygons = useMemo(() => {
    if (members.length === 0) return [];
    if (members.length === 1) {
      // single rectangle
      return [[[0, 0], [size.w, 0], [size.w, size.h], [0, size.h]] as [number, number][]];
    }
    const d = Delaunay.from(points);
    const v = d.voronoi([0, 0, size.w, size.h]);
    return members.map((_, i) => v.cellPolygon(i) as [number, number][]).filter(Boolean);
  }, [points, members, size]);

  return (
    <div ref={ref} className="editorial-panel bg-card p-3 relative">
      <p className="text-xs uppercase tracking-widest text-taupe mb-2">Study canvas</p>
      <div className="relative" style={{ width: "100%", height: size.h }}>
        <svg width={size.w} height={size.h} className="block">
          <defs>
            <pattern id="template-img" patternUnits="userSpaceOnUse" width={size.w} height={size.h}>
              <image href={templateUrl} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="xMidYMid slice" />
            </pattern>
          </defs>
          {/* Base white background */}
          <rect x="0" y="0" width={size.w} height={size.h} fill="hsl(var(--ivory))" />
          {polygons.map((poly, i) => {
            const m = members[i]; if (!m || !poly) return null;
            const userTasks = tasks.filter(t => t.user_id === m.user_id);
            const done = userTasks.filter(t => t.completed).length;
            const total = userTasks.length || 1;
            const progress = userTasks.length === 0 ? 0 : done / total;
            const path = "M" + poly.map(p => p.join(",")).join("L") + "Z";
            const clipId = `clip-${i}`;
            return (
              <g key={i}
                onMouseMove={(e) => {
                  const r = (e.currentTarget.ownerSVGElement!.getBoundingClientRect());
                  setHover({ x: e.clientX - r.left, y: e.clientY - r.top, member: m, done, total: userTasks.length });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <clipPath id={clipId}><path d={path} /></clipPath>
                <path d={path} fill="hsl(var(--ivory))" />
                <g clipPath={`url(#${clipId})`} opacity={progress}>
                  <rect x="0" y="0" width={size.w} height={size.h} fill="url(#template-img)" />
                </g>
                <path d={path} fill="none" stroke="hsl(var(--coffee))" strokeWidth="1" opacity="0.6" />
              </g>
            );
          })}
        </svg>

        {hover && (
          <div className="absolute pointer-events-none bg-ivory border border-border px-3 py-2 text-xs shadow-md"
            style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <div className="font-serif text-sm text-coffee">@{hover.member.profile?.username ?? "guest"}</div>
            <div className="text-taupe">Tasks {hover.done}/{hover.total}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PeopleGrid({ members }: { members: Member[] }) {
  return (
    <div className="editorial-panel bg-card p-5">
      <h3 className="font-serif text-2xl mb-3">In the room</h3>
      <div className="grid grid-cols-2 gap-3">
        {members.map(m => <PersonTile key={m.user_id} member={m} />)}
      </div>
    </div>
  );
}

function PersonTile({ member }: { member: Member }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { user } = useAuth();
  const isMe = user?.id === member.user_id;
  const [cam, setCam] = useState(false);
  const [mic, setMic] = useState(false);

  useEffect(() => {
    if (!isMe) return;
    if (cam || mic) {
      navigator.mediaDevices.getUserMedia({ video: cam, audio: mic }).then(s => {
        streamRef.current = s;
        if (videoRef.current && cam) videoRef.current.srcObject = s;
      }).catch(() => { setCam(false); setMic(false); toast.error("Could not access camera/mic"); });
    } else if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [cam, mic, isMe]);

  return (
    <div className="aspect-video bg-cocoa relative overflow-hidden border border-border/60">
      {isMe && cam ? (
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center bg-sand">
          <span className="font-serif text-2xl text-coffee">{(member.profile?.username ?? "?")[0]?.toUpperCase()}</span>
        </div>
      )}
      <div className="absolute bottom-1 left-2 text-xs text-ivory bg-coffee/70 px-1.5 py-0.5 rounded-sm">
        @{member.profile?.username ?? "guest"}{isMe && " (you)"}
      </div>
      {isMe && (
        <div className="absolute top-1 right-1 flex gap-1">
          <button onClick={() => setCam(c => !c)} className="bg-coffee/80 text-ivory p-1 rounded-sm">
            {cam ? <Camera className="w-3 h-3" /> : <CameraOff className="w-3 h-3" />}
          </button>
          <button onClick={() => setMic(c => !c)} className="bg-coffee/80 text-ivory p-1 rounded-sm">
            {mic ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
          </button>
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
            <h2 className="font-serif text-5xl text-coffee">A chapter complete.</h2>
            <p className="text-coffee/70 mt-3">Stars and progress recorded.</p>
          </>
        ) : (
          <>
            <motion.div animate={{ rotate: [0, -3, 3, 0], opacity: [1, 0.6, 0.3] }} transition={{ duration: 0.8 }}>
              <h2 className="font-serif text-5xl text-destructive">The page tore.</h2>
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
