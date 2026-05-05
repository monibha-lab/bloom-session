import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Flame, Star } from "lucide-react";

export function TopNav() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  return (
    <header className="relative z-10 border-b border-border/60 bg-ivory/70 backdrop-blur-sm">
      <div className="container mx-auto flex items-center justify-between py-4">
        <Link to="/" className="font-serif text-2xl tracking-tight text-coffee">
          FocusForge<span className="text-clay">.</span>
        </Link>
        <nav className="flex items-center gap-3">
          {user && profile ? (
            <>
              <div className="hidden md:flex items-center gap-4 text-sm text-coffee/80">
                <span className="flex items-center gap-1"><Star className="w-4 h-4 text-star" /> {profile.stars}</span>
                <span className="flex items-center gap-1"><Flame className="w-4 h-4 text-flame" /> {profile.blue_flames}</span>
                {profile.username && <span className="text-coffee">@{profile.username}</span>}
              </div>
              <Button variant="outline" size="sm" onClick={() => nav("/dashboard")}>Dashboard</Button>
              <Button variant="ghost" size="sm" onClick={async () => { await signOut(); nav("/"); }}>Sign out</Button>
            </>
          ) : (
            <Button variant="default" size="sm" onClick={() => nav("/auth")}>Sign in</Button>
          )}
        </nav>
      </div>
    </header>
  );
}
