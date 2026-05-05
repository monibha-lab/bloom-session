import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function UsernameModal() {
  const { user, profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && profile && !profile.username) setOpen(true);
    else setOpen(false);
  }, [user, profile]);

  const submit = async () => {
    const u = name.trim();
    if (u.length < 3 || u.length > 20) return toast.error("Username must be 3-20 characters");
    if (/\s/.test(u)) return toast.error("Username cannot contain spaces");
    setLoading(true);
    const { error } = await supabase.from("profiles").update({ username: u }).eq("id", user!.id);
    setLoading(false);
    if (error) {
      if (error.message.includes("duplicate")) toast.error("Username already taken");
      else toast.error(error.message);
      return;
    }
    toast.success("Welcome, @" + u);
    await refreshProfile();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="bg-ivory border-border" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-coffee">Choose your handle</DialogTitle>
          <DialogDescription className="text-taupe">3–20 characters, no spaces. This is how others will see you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="quietreader" />
          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? "Saving…" : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
