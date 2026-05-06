import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { Ornaments } from "@/components/Ornaments";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { BookOpen, Users, Timer } from "lucide-react";

const Index = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen relative bg-ivory text-coffee">
      <Ornaments />
      <TopNav />

      <main className="container mx-auto px-4">
        <section className="grid md:grid-cols-12 gap-8 md:gap-10 items-center py-12 md:py-28">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="md:col-span-7">
            <p className="uppercase tracking-[0.3em] text-xs text-taupe mb-4 md:mb-6">Vol. 01 — A quiet practice</p>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-7xl leading-[1.05] tracking-tight">
              Study deeper,<br />
              <em className="text-clay not-italic font-light">together</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-coffee/80 leading-relaxed">
              FocusForge is a calm, editorial study room. Set your tasks, light a quiet timer, and reveal a lo-fi scene as you work — alone or with friends.
            </p>
            <div className="mt-8 md:mt-10 flex gap-3 flex-wrap">
              <Button asChild size="lg" className="w-full sm:w-auto"><Link to={user ? "/dashboard" : "/auth"}>{user ? "Open dashboard" : "Begin a session"}</Link></Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto"><Link to="/auth">Create an account</Link></Button>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }}
            className="md:col-span-5">
            <div className="editorial-panel p-6 md:p-8 bg-blush relative overflow-hidden">
              <div className="absolute -top-12 -right-10 w-44 h-44 rounded-full bg-clay/60 blur-2xl" />
              <p className="font-serif italic text-xl md:text-2xl leading-snug text-coffee/90">
                "A page revealed, line by line, as the hour folds into focus."
              </p>
              <div className="mt-6 h-px bg-coffee/20" />
              <p className="mt-4 text-xs uppercase tracking-widest text-taupe">— Field notes</p>
            </div>
          </motion.div>
        </section>

        <section className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 pb-16 md:pb-24">
          {[
            { icon: BookOpen, title: "Editorial templates", body: "Choose a lo-fi scene that unveils as you complete tasks." },
            { icon: Users, title: "Study with friends", body: "Invite up to six readers with a private 6-character code." },
            { icon: Timer, title: "Custom or Pomodoro", body: "Set a single quiet block, or four 25-minute chapters." },
          ].map((f, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
              className="editorial-panel p-6 bg-card">
              <f.icon className="w-6 h-6 text-clay" />
              <h3 className="font-serif text-2xl mt-4">{f.title}</h3>
              <p className="text-coffee/70 mt-2 text-sm leading-relaxed">{f.body}</p>
            </motion.div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-taupe">
        © FocusForge — A small almanac for focused study.
      </footer>
    </div>
  );
};

export default Index;
