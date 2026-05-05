import { motion } from "framer-motion";

/** Decorative warm clay/taupe blobs and wavy lines for editorial pages. */
export function Ornaments({ variant = "default" }: { variant?: "default" | "minimal" }) {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
      <motion.div
        className="blob blob-clay"
        style={{ width: 420, height: 420, top: -120, right: -80 }}
        animate={{ x: [0, 25, 0], y: [0, -15, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="blob blob-taupe"
        style={{ width: 360, height: 360, bottom: -120, left: -100 }}
        animate={{ x: [0, -20, 0], y: [0, 10, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      {variant === "default" && (
        <motion.div
          className="blob blob-sand"
          style={{ width: 280, height: 280, top: "40%", left: "55%" }}
          animate={{ x: [0, 15, 0], y: [0, 20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <path d="M -50,180 C 200,120 400,260 700,180 S 1200,260 1500,180" className="wavy-line" />
        <path d="M -50,520 C 250,460 500,600 800,520 S 1200,600 1500,520" className="wavy-line" />
      </svg>

      {/* botanical line accent */}
      <svg className="absolute top-6 left-6 opacity-30" width="64" height="120" viewBox="0 0 64 120" fill="none" stroke="hsl(var(--coffee))" strokeWidth="1">
        <path d="M32 4 C 32 30, 32 80, 32 116" />
        <path d="M32 30 C 18 26, 10 38, 14 48 C 22 46, 30 42, 32 32" />
        <path d="M32 60 C 46 56, 54 68, 50 78 C 42 76, 34 72, 32 62" />
        <path d="M32 88 C 18 84, 10 96, 14 106 C 22 104, 30 100, 32 90" />
      </svg>
    </div>
  );
}
