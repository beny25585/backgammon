import { useState } from "react";
import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";

interface MatchSettingsProps {
  onStart: (settings: { botColor: Color; target: number }) => void;
  onCancel: () => void;
}

const TARGETS = [1, 3, 5, 7, 9, 11, 13, 15, 21];

export default function MatchSettings({
  onStart,
  onCancel,
}: MatchSettingsProps) {
  const [botColor, setBotColor] = useState<Color>("black");
  const [target, setTarget] = useState(7);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="flex flex-col items-center gap-6 p-8 rounded-3xl"
        style={{
          background:
            "linear-gradient(135deg, #1a0e06 0%, #2a1810 50%, #1a0e06 100%)",
          border: "2px solid rgba(255,200,100,0.3)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
          maxWidth: "90vw",
          width: 360,
        }}
        initial={{ scale: 0.85, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
      >
        <h2 className="text-xl font-bold" style={{ color: "#f4e4c1" }}>
          Match Settings
        </h2>

        {/* ── Player color ─────────────────────────── */}
        <div className="w-full">
          <p className="text-sm text-white/60 mb-2">Play as</p>
          <div className="flex gap-2">
            {(["white", "black"] as Color[]).map((c) => (
              <button
                key={c}
                onClick={() => setBotColor(c === "black" ? "white" : "black")}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background:
                    botColor !== c
                      ?"linear-gradient(135deg, #f4e4c1, #d4b880)"
                      :  "rgba(255,255,255,0.1)",
                  color: botColor !== c ? "rgba(255,255,255,0.6)" : "#1a0e06",
                  border:
                    botColor !== c
                      ? "1px solid rgba(255,255,255,0.15)"
                      : "none",
                }}
              >
                {c === "white" ? "White (first)" : "Black (second)"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Match target ─────────────────────────── */}
        <div className="w-full">
          <p className="text-sm text-white/60 mb-2">
            {target === 1 ? "Single Game" : `First to ${target} points`}
          </p>
          <div className="flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  background:
                    target === t
                      ? "linear-gradient(135deg, #f4e4c1, #d4b880)"
                      : "rgba(255,255,255,0.06)",
                  color: target === t ? "#1a0e06" : "rgba(255,255,255,0.5)",
                  border:
                    target === t ? "none" : "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Actions ──────────────────────────────── */}
        <div className="flex gap-3 w-full mt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onStart({ botColor, target })}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{
              background: "linear-gradient(135deg, #f4e4c1, #d4b880)",
              color: "#1a0e06",
            }}
          >
            Start Match
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
