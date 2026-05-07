import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATES } from "@/lib/templates";
import { Upload, Plus, X, Users, User, Check, Eye, EyeOff, Copy } from "lucide-react";
import { toast } from "sonner";

type Step = 1 | 2 | 3 | 4;

const generateCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const SessionSetup = () => {
  const nav = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [templateUrl, setTemplateUrl] = useState<string>(TEMPLATES[0].url);
  const [templateName, setTemplateName] = useState(TEMPLATES[0].name);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Step 2
  const [mode, setMode] = useState<"solo" | "invite">("solo");

  // Step 3 visibility (group only)
  const [visibility, setVisibility] = useState<"public" | "secret">("public");

  // Lobby readiness
  const [memberTaskCounts, setMemberTaskCounts] = useState<Record<string, number>>({});

  // Step 3
  const [tasks, setTasks] = useState<string[]>([""]);

  // Step 4
  const [timerType, setTimerType] = useState<"custom" | "pomodoro">("custom");
  const [minutes, setMinutes] = useState(50);

  // Session-in-progress (after step 2 host creates one)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [members, setMembers] = useState<{ user_id: string; profile?: { username: string | null; avatar_url: string | null } }[]>([]);

  // Realtime members watch
  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase.channel(`setup:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_members", filter: `session_id=eq.${sessionId}` }, () => loadMembers())
      .subscribe();
    loadMembers();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const loadMembers = async () => {
    if (!sessionId) return;
    const { data: ms } = await supabase.from("session_members").select("user_id").eq("session_id", sessionId);
    if (!ms) return;
    const ids = ms.map(m => m.user_id);
    const { data: profs } = await supabase.from("profiles").select("id, username, avatar_url").in("id", ids);
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    setMembers(ms.map(m => ({ user_id: m.user_id, profile: map.get(m.user_id) as any })));
  };

  const onUpload = async (file: File) => {
    if (!user) return toast.error("You must be signed in to upload templates");
    if (!["image/jpeg", "image/png"].includes(file.type)) return toast.error("Only JPG or PNG please");
    if (file.size > 5 * 1024 * 1024) return toast.error("Max file size is 5MB");
    setUploading(true);
    // NOTE: The `templates` bucket is intentionally PUBLIC so template image URLs
    // can render directly inside template cards and the session canvas (<image href>).
    // Do not flip it to private — that will break image display.
    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("templates").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      setUploading(false);
      return toast.error(`Upload failed: ${error.message}`);
    }
    const { data: pub } = supabase.storage.from("templates").getPublicUrl(path);
    setTemplateUrl(pub.publicUrl);
    setTemplateName(file.name);
    setUploading(false);
    toast.success("Template uploaded");
  };

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

  const ensureProfile = async () => {
    if (!user) return false;
    const { data, error } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (error) { showSbError("Profile lookup failed", error); return false; }
    if (!data) {
      const { error: insErr } = await supabase.from("profiles").insert({ id: user.id });
      if (insErr) { showSbError("Profile creation failed", insErr); return false; }
    }
    return true;
  };

  const proceedFromStep2 = async () => {
    if (!user) return toast.error("Please sign in first");
    if (!(await ensureProfile())) return;
    const code = mode === "invite" ? generateCode() : null;
    const expiresAt = mode === "invite" ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
    const { data: session, error } = await supabase.from("sessions").insert({
      host_id: user.id,
      mode: mode === "solo" ? "solo" : "group",
      code, code_expires_at: expiresAt,
      template_url: templateUrl, template_name: templateName,
      timer_type: timerType, duration_seconds: minutes * 60,
      status: "lobby",
    }).select().single();
    if (error || !session) return showSbError("Session create failed", error);

    const { error: mErr } = await supabase.from("session_members").insert({ session_id: session.id, user_id: user.id });
    if (mErr) return showSbError("Adding host to session failed", mErr);
    setSessionId(session.id);
    if (code) setCreatedCode(code);
    setStep(3);
  };

  const addTask = () => { if (tasks.length < 10) setTasks([...tasks, ""]); };
  const removeTask = (i: number) => setTasks(tasks.filter((_, idx) => idx !== i));
  const updateTask = (i: number, v: string) => setTasks(tasks.map((t, idx) => idx === i ? v : t));

  const proceedFromStep3 = async () => {
    if (!user || !sessionId) return;
    const cleaned = tasks.map(t => t.trim()).filter(Boolean);
    if (cleaned.length < 1) return toast.error("Add at least one task");
    if (cleaned.length > 10) return toast.error("Max 10 tasks");
    const taskVisibility = mode === "solo" ? "public" : visibility;
    const rows = cleaned.map((title, i) => ({ session_id: sessionId, user_id: user.id, title, position: i, visibility: taskVisibility }));
    const { error } = await supabase.from("tasks").insert(rows);
    if (error) return showSbError("Saving tasks failed", error);
    setStep(4);
  };

  const startSession = async () => {
    if (!sessionId || !user) return toast.error("No session in progress");
    const dur = timerType === "pomodoro" ? (25 * 4 + 5 * 3 + 15) * 60 : minutes * 60;
    const { error } = await supabase.from("sessions").update({
      status: "active",
      timer_type: timerType,
      duration_seconds: dur,
      started_at: new Date().toISOString(),
    }).eq("id", sessionId);
    if (error) return showSbError("Starting session failed", error);
    nav(`/session/${sessionId}`);
  };

  const stepLabels = ["Template", "Mode", "Tasks", "Timer"];

  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments variant="minimal" />
      <TopNav />

      <main className="container mx-auto px-4 py-6 md:py-10 max-w-4xl">
        <div className="mb-6 md:mb-8 flex items-center gap-2 md:gap-3 text-[10px] md:text-xs uppercase tracking-widest text-taupe overflow-x-auto">
          {stepLabels.map((label, i) => {
            const n = (i + 1) as Step;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} className="flex items-center gap-2 shrink-0">
                <span className={`w-6 h-6 grid place-items-center rounded-sm border ${active ? "bg-coffee text-ivory border-coffee" : done ? "bg-clay text-ivory border-clay" : "border-border text-taupe"}`}>
                  {done ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className={active ? "text-coffee" : ""}>{label}</span>
                {i < 3 && <span className="w-4 md:w-8 h-px bg-border mx-1 md:mx-2" />}
              </div>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.section key="s1" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h1 className="font-serif text-3xl md:text-4xl mb-2">Pick a template</h1>
              <p className="text-coffee/70 mb-6">A scene that will reveal slowly as you complete each task.</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {TEMPLATES.map(t => (
                  <motion.button
                    key={t.id}
                    whileHover={{ y: -4 }}
                    onClick={() => { setTemplateUrl(t.url); setTemplateName(t.name); }}
                    className={`editorial-panel bg-card text-left overflow-hidden relative ${templateUrl === t.url ? "ring-2 ring-coffee" : ""}`}
                  >
                    <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-clay/40 blur-xl" />
                    <img src={t.url} alt={t.name} loading="lazy" className="aspect-square object-cover w-full" />
                    <div className="p-3 border-t border-border/60">
                      <p className="font-serif text-lg">{t.name}</p>
                      <p className="text-xs uppercase tracking-widest text-taupe mt-1">Lo-fi · editorial</p>
                    </div>
                  </motion.button>
                ))}
              </div>

              <div className="mt-6 editorial-panel bg-card p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-serif text-lg">Upload your own</p>
                  <p className="text-xs text-taupe">JPG or PNG, square works best</p>
                </div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png" className="hidden"
                  onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
                <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : "Upload"}
                </Button>
              </div>

              <div className="mt-8 flex justify-end">
                <Button onClick={() => setStep(2)}>Continue</Button>
              </div>
            </motion.section>
          )}

          {step === 2 && (
            <motion.section key="s2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h1 className="font-serif text-3xl md:text-4xl mb-6">Who's studying?</h1>
              <div className="grid sm:grid-cols-2 gap-4">
                <ModeCard active={mode === "solo"} onClick={() => setMode("solo")} icon={<User className="w-5 h-5" />} title="Solo Study" body="A quiet room of your own." />
                <ModeCard active={mode === "invite"} onClick={() => setMode("invite")} icon={<Users className="w-5 h-5" />} title="Invite Friends" body="Up to six readers with a private code." />
              </div>
              <p className="text-xs text-taupe mt-4">Joining someone else's session? Use the join code on your dashboard.</p>
              <div className="mt-8 flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={proceedFromStep2}>Continue</Button>
              </div>
            </motion.section>
          )}

          {step === 3 && (
            <motion.section key="s3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h1 className="font-serif text-3xl md:text-4xl mb-2">What will you read?</h1>
              <p className="text-coffee/70 mb-6">Add 1–10 tasks. They lock when the session begins.</p>

              {createdCode && (
                <div className="editorial-panel bg-blush p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-taupe">Invitation code</p>
                    <p className="font-serif text-2xl md:text-3xl tracking-[0.3em] text-coffee break-all">{createdCode}</p>
                  </div>
                  <p className="text-sm text-taupe">Expires in 30 minutes</p>
                </div>
              )}

              {members.length > 0 && (
                <div className="mb-6 flex items-center gap-2 flex-wrap text-sm text-taupe">
                  <span className="uppercase text-xs tracking-widest">In the room:</span>
                  {members.map(m => (
                    <span key={m.user_id} className="px-2 py-1 bg-sand rounded-sm text-coffee">@{m.profile?.username ?? "guest"}</span>
                  ))}
                </div>
              )}

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

              <div className="mt-8 flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                <Button onClick={proceedFromStep3}>Continue</Button>
              </div>
            </motion.section>
          )}

          {step === 4 && (
            <motion.section key="s4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h1 className="font-serif text-3xl md:text-4xl mb-6">Set your timer</h1>
              <div className="grid sm:grid-cols-2 gap-4">
                <ModeCard active={timerType === "custom"} onClick={() => setTimerType("custom")} icon={<></>} title="Custom"
                  body="One quiet block from 10 minutes to 8 hours." />
                <ModeCard active={timerType === "pomodoro"} onClick={() => setTimerType("pomodoro")} icon={<></>} title="Pomodoro"
                  body="Four 25-minute chapters with 5-min breaks, then a 15-min rest." />
              </div>

              {timerType === "custom" && (
                <div className="mt-6 max-w-md">
                  <Label>Duration: {Math.floor(minutes / 60)}h {minutes % 60}m</Label>
                  <input type="range" min={10} max={480} step={5} value={minutes}
                    onChange={(e) => setMinutes(parseInt(e.target.value))}
                    className="w-full accent-coffee" />
                  <div className="flex justify-between text-xs text-taupe mt-1"><span>10 min</span><span>8 h</span></div>
                </div>
              )}

              <div className="mt-8 flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
                <Button onClick={startSession}>Begin session</Button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

function ModeCard({ active, onClick, icon, title, body }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button onClick={onClick}
      className={`editorial-panel text-left p-5 transition-all text-coffee ${active ? "bg-card border-coffee -translate-y-1 shadow-[0_12px_30px_-10px_rgba(75,46,36,0.45)] ring-2 ring-coffee" : "bg-card hover:bg-blush hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-12px_rgba(75,46,36,0.35)]"}`}>
      <div className="text-clay">{icon}</div>
      <p className="font-serif text-2xl mt-2">{title}</p>
      <p className="text-sm mt-1 text-coffee/70">{body}</p>
    </button>
  );
}

export default SessionSetup;
