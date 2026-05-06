import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const AuthPage = () => {
  const nav = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (user) nav("/dashboard"); }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) toast.error(error.message);
      else toast.success("Account created — you're in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
    }
    setLoading(false);
  };

  const google = async () => {
    const { lovable } = await import("@/integrations/lovable");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/dashboard`,
    });
    if (result.error) toast.error((result.error as any)?.message ?? "Google sign-in failed");
    // If result.redirected, the browser is navigating to Google.
    // Otherwise, session is set and the useEffect above will redirect to /dashboard.
  };

  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments variant="minimal" />
      <TopNav />
      <main className="container mx-auto flex items-center justify-center py-16">
        <div className="grid md:grid-cols-2 gap-10 max-w-4xl w-full items-center">
          <div>
            <p className="uppercase tracking-[0.3em] text-xs text-taupe mb-4">Sign in</p>
            <h1 className="font-serif text-5xl leading-tight">Welcome back to your quiet desk.</h1>
            <p className="text-coffee/70 mt-4 leading-relaxed">Pick up where you left off, or begin a new chapter of focused work.</p>
          </div>

          <div className="editorial-panel bg-card p-8">
            <div className="flex gap-2 mb-6 text-sm">
              <button onClick={() => setMode("signin")} className={`pb-1 border-b-2 ${mode === "signin" ? "border-coffee text-coffee" : "border-transparent text-taupe"}`}>Sign in</button>
              <button onClick={() => setMode("signup")} className={`pb-1 border-b-2 ${mode === "signup" ? "border-coffee text-coffee" : "border-transparent text-taupe"}`}>Create account</button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-ivory" />
              </div>
              <div>
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-ivory" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-taupe">
              <div className="h-px bg-border flex-1" /> or <div className="h-px bg-border flex-1" />
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={google}>
              Continue with Google
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AuthPage;
