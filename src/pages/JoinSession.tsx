import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const showSbError = (label: string, error: any) => {
  const parts = [
    error?.message,
    error?.details && `details: ${error.details}`,
    error?.hint && `hint: ${error.hint}`,
    error?.code && `code: ${error.code}`,
  ].filter(Boolean).join(" · ");
  toast.error(`${label}: ${parts || "unknown error"}`);
  console.error(label, error);
};

const JoinSession = () => {
  const { id } = useParams();
  const sessionId = id!;
  const nav = useNavigate();
  const { user } = useAuth();

  const [session, setSession] = useState<any>(null);
  const [host, setHost] = useState<{ username: string | null } | null>(null);
  const [tasks, setTasks] = useState<string[]>([""]);
  const [visibility, setVisibility] = useState<"public" | "secret">("public");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
      if (error) { showSbError("Could not load session", error); setLoading(false); return; }
      if (!s) { toast.error("Session not found"); nav("/dashboard"); return; }
      setSession(s);
      const { data: p } = await supabase.from("profiles").select("username").eq("id", s.host_id).maybeSingle();
      setHost(p ?? null);
      setLoading(false);
    })();
  }, [sessionId, nav]);

  const addTask = () => { if (tasks.length < 10) setTasks([...tasks, ""]); };
  const removeTask = (i: number) => setTasks(tasks.filter((_, idx) => idx !== i));
  const updateTask = (i: number, v: string) => setTasks(tasks.map((t, idx) => idx === i ? v : t));

  const submit = async () => {
    if (!user || !session) return;
    const cleaned = tasks.map(t => t.trim()).filter(Boolean);
    if (cleaned.length < 1) return toast.error("Add at least one task");
    if (cleaned.length > 10) return toast.error("Max 10 tasks");
    setSubmitting(true);

    // Ensure membership (RLS allows users to insert own membership)
    const { data: existing } = await supabase
      .from("session_members").select("id")
      .eq("session_id", sessionId).eq("user_id", user.id).maybeSingle();
    if (!existing) {
      const { error: mErr } = await supabase.from("session_members").insert({ session_id: sessionId, user_id: user.id });
      if (mErr) { setSubmitting(false); return showSbError("Could not join session", mErr); }
    }

    const rows = cleaned.map((title, i) => ({
      session_id: sessionId, user_id: user.id, title, position: i,
      visibility,
    }));
    const { error } = await supabase.from("tasks").insert(rows);
    if (error) { setSubmitting(false); return showSbError("Could not save tasks", error); }

    toast.success("You're in.");
    if (session.status === "active") nav(`/session/${sessionId}`);
    else nav(`/session/${sessionId}`); // session room handles lobby vs active state
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-coffee/70 italic bg-ivory">Loading session…</div>;
  }
  if (!session) return null;

  if (session.status === "completed" || session.status === "failed") {
    return (
      <div className="min-h-screen relative bg-ivory text-coffee">
        <TopNav />
        <main className="container mx-auto px-4 py-20 text-center">
          <h1 className="font-serif text-3xl md:text-4xl">This session has already ended.</h1>
          <Button className="mt-6" onClick={() => nav("/dashboard")}>Back to dashboard</Button>
        </main>
      </div>
    );
  }

  const isSolo = session.mode === "solo";

  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments variant="minimal" />
      <TopNav />
      <main className="container mx-auto px-4 py-6 md:py-10 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="uppercase tracking-[0.3em] text-xs text-taupe mb-3">Joining a session</p>
          <h1 className="font-serif text-3xl md:text-4xl">You're invited to study.</h1>
          <div className="mt-4 editorial-panel bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-taupe">Hosted by</p>
              <p className="font-serif text-xl text-coffee">@{host?.username ?? "guest"}</p>
            </div>
            {session.code && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-taupe">Code</p>
                <p className="font-serif text-2xl tracking-[0.3em]">{session.code}</p>
              </div>
            )}
          </div>

          <div className="mt-8">
            <h2 className="font-serif text-2xl mb-1">Your tasks</h2>
            <p className="text-coffee/70 text-sm mb-4">Add 1–10 things you'll work on. They lock once the session begins.</p>

            <div className="space-y-2">
              {tasks.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={t}
                    onChange={(e) => updateTask(i, e.target.value)}
                    placeholder={`Task ${i + 1}`}
                    className="bg-ivory"
                    autoFocus={i === tasks.length - 1}
                    data-task-index={i}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!t.trim()) return;
                        if (i === tasks.length - 1 && tasks.length < 10) {
                          addTask();
                          setTimeout(() => {
                            const next = document.querySelector<HTMLInputElement>(`[data-task-index="${i + 1}"]`);
                            next?.focus();
                          }, 0);
                        } else {
                          const next = document.querySelector<HTMLInputElement>(`[data-task-index="${i + 1}"]`);
                          next?.focus();
                        }
                      }
                    }}
                  />
                  {tasks.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeTask(i)}><X className="w-4 h-4" /></Button>}
                </div>
              ))}
            </div>
            {tasks.length < 10 && (
              <Button variant="outline" size="sm" className="mt-3" onClick={addTask}>
                <Plus className="w-4 h-4" /> Add task
              </Button>
            )}
          </div>

          {!isSolo && (
            <div className="mt-8">
              <Label className="text-xs uppercase tracking-widest text-taupe">Task visibility</Label>
              <div className="mt-2 inline-flex border border-border bg-card overflow-hidden">
                <button
                  onClick={() => setVisibility("public")}
                  className={`px-4 py-2 text-sm flex items-center gap-2 transition-all ${visibility === "public" ? "bg-coffee text-ivory" : "text-coffee hover:bg-blush"}`}
                >
                  <Eye className="w-4 h-4" /> Public
                </button>
                <button
                  onClick={() => setVisibility("secret")}
                  className={`px-4 py-2 text-sm flex items-center gap-2 transition-all border-l border-border ${visibility === "secret" ? "bg-coffee text-ivory" : "text-coffee hover:bg-blush"}`}
                >
                  <EyeOff className="w-4 h-4" /> Secret
                </button>
              </div>
              <p className="text-xs text-taupe mt-2">
                {visibility === "public"
                  ? "Other members can read your task titles."
                  : "Only you see your task titles. Others see your progress."}
              </p>
            </div>
          )}

          <div className="mt-10 flex justify-between gap-3">
            <Button variant="outline" onClick={() => nav("/dashboard")}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Joining…" : session.status === "active" ? "Join active session" : "Enter lobby"}
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default JoinSession;
