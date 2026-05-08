import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { TopNav } from "@/components/TopNav";
import { UsernameModal } from "@/components/UsernameModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, Flame, BookOpen, Clock, ArrowRight } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { toast } from "sonner";

type Log = { date: string; duration_seconds: number; succeeded: boolean; session_id: string | null; created_at: string };

const Dashboard = () => {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("code");
    if (c) setJoinCode(c.toUpperCase().slice(0, 6));
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("study_logs")
        .select("date, duration_seconds, succeeded, session_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setLogs((data as Log[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  // No rejoin: leaving an active session ends it as a failure.

  const handleJoin = async () => {
    setJoinError(null);
    const code = joinCode.trim().toUpperCase();
    if (!code) return setJoinError("Enter a code first.");
    if (!/^[A-Z0-9]{6}$/.test(code)) return setJoinError("Codes are 6 letters or numbers.");
    setJoining(true);
    const { data: s, error } = await supabase
      .from("sessions").select("id, status, code_expires_at")
      .eq("code", code).maybeSingle();
    setJoining(false);
    if (error) { setJoinError(error.message); console.error(error); return; }
    if (!s) return setJoinError("No session found for that code.");
    if (s.status === "completed" || s.status === "failed") return setJoinError("That session has already ended.");
    if (s.code_expires_at && new Date(s.code_expires_at) < new Date()) return setJoinError("That code has expired.");
    nav(`/session/${s.id}/join`);
  };

  // 7-day chart
  const last7 = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const day = d.toISOString().slice(0, 10);
    const minutes = logs.filter(l => l.date === day).reduce((s, l) => s + l.duration_seconds / 60, 0);
    return { day: d.toLocaleDateString(undefined, { weekday: "short" }), minutes: Math.round(minutes) };
  });

  const successRate = logs.length ? Math.round((logs.filter(l => l.succeeded).length / logs.length) * 100) : 0;

  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments />
      <TopNav />
      <UsernameModal />

      <main className="container mx-auto px-4 py-6 md:py-10 space-y-8 md:space-y-10">
        <section className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="uppercase tracking-[0.3em] text-xs text-taupe mb-3">Your study desk</p>
              <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl break-words">{profile?.username ? `Hello, ${profile.username}.` : "Hello."}</h1>
              <p className="text-coffee/70 mt-2">A quiet record of your focus.</p>
            </div>
          </div>

          {activeSessionId && (
            <div className="editorial-panel bg-blush p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-taupe">Still open</p>
                <p className="font-serif text-lg text-coffee">You have an active session waiting.</p>
              </div>
              <Button variant="outline" onClick={() => nav(`/session/${activeSessionId}`)}>
                Rejoin <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-4 md:items-stretch">
            <Button size="lg" onClick={() => nav("/session/setup")} className="md:flex-1 w-full">
              Start new session
            </Button>
            <div className="editorial-panel bg-card p-3 md:flex-1 flex flex-col sm:flex-row gap-2 sm:items-center">
              <div className="flex-1">
                <Input
                  value={joinCode}
                  onChange={(e) => { setJoinError(null); setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); }}
                  placeholder="JOIN CODE"
                  maxLength={6}
                  className="bg-ivory tracking-[0.4em] font-serif text-center text-lg uppercase border-0 focus-visible:ring-0"
                />
              </div>
              <Button onClick={handleJoin} disabled={joining} variant="outline" className="w-full sm:w-auto shrink-0">
                {joining ? "Looking…" : "Join"}
              </Button>
            </div>
          </div>
          {joinError && <p className="text-sm text-destructive">{joinError}</p>}
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<Star className="w-5 h-5 text-star" />} label="Stars" value={profile?.stars ?? 0} />
          <Stat icon={<Flame className="w-5 h-5 text-flame" />} label="Blue flames" value={profile?.blue_flames ?? 0} />
          <Stat icon={<BookOpen className="w-5 h-5 text-clay" />} label="Sessions" value={profile?.sessions_completed ?? 0} />
          <Stat icon={<Clock className="w-5 h-5 text-olive" />} label="Hours" value={Math.round((profile?.total_seconds ?? 0) / 360) / 10} />
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="editorial-panel bg-card p-6">
            <h3 className="font-serif text-2xl mb-4">Last 7 days</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={last7}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--taupe) / 0.3)" vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--coffee))" fontSize={12} />
                  <YAxis stroke="hsl(var(--coffee))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--ivory))", border: "1px solid hsl(var(--border))", borderRadius: 4, color: "hsl(var(--coffee))" }} />
                  <Bar dataKey="minutes" fill="hsl(var(--clay))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="editorial-panel bg-card p-6">
            <h3 className="font-serif text-2xl mb-4">Success rate</h3>
            <div className="h-56 flex flex-col justify-center">
              <p className="text-6xl font-serif text-clay">{successRate}<span className="text-2xl text-coffee/60">%</span></p>
              <p className="text-coffee/70 text-sm mt-2">Across {logs.length} sessions</p>
              <div className="mt-6 h-2 bg-sand rounded-sm overflow-hidden">
                <div className="h-full bg-coffee transition-all" style={{ width: `${successRate}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="font-serif text-2xl mb-4">Session history</h3>
          <div className="editorial-panel bg-card p-2 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-taupe italic">Loading…</div>
            ) : logs.length === 0 ? (
              <div className="p-10 text-center">
                <p className="font-serif text-xl text-coffee/80">No sessions yet</p>
                <p className="text-taupe text-sm mt-1">Begin one to start your record.</p>
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[420px]">
                <thead className="text-taupe text-xs uppercase tracking-widest">
                  <tr><th className="text-left p-3">Date</th><th className="text-left p-3">Duration</th><th className="text-left p-3">Result</th></tr>
                </thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="p-3">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="p-3">{Math.round(l.duration_seconds / 60)} min</td>
                      <td className="p-3">{l.succeeded ? <span className="text-olive">✓ Completed</span> : <span className="text-destructive">✗ Failed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="editorial-panel bg-card p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-taupe">{icon}{label}</div>
      <div className="font-serif text-4xl mt-2 text-coffee">{value}</div>
    </div>
  );
}

export default Dashboard;
