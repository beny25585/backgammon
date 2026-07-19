import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";

interface GameResultOverlayProps {
  winner: Color;
  winType: "single" | "gammon" | "backgammon";
  points: number;
  cube: number;
  matchScore: Record<Color, number>;
  matchTarget: number;
  matchWinner: Color | null;
  onNext: () => void;
  onHome: () => void;
}

const winLabels = {
  single: "Wins!",
  gammon: "Gammon! ×2",
  backgammon: "Backgammon! ×3",
};

export default function GameResultOverlay({
  winner,
  winType,
  points,
  cube,
  matchScore,
  matchTarget,
  matchWinner,
  onNext,
  onHome,
}: GameResultOverlayProps) {
  const isMatchOver = matchWinner !== null;
  const youWon = winner === "white";

  function label() {
    const wl = winLabels[winType];
    if (cube > 1) return `${wl} (cube ×${cube}) → +${points}`;
    return `${wl} → +${points}`;
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="flex flex-col items-center gap-4 p-8 rounded-3xl text-center"
        style={{
          background: "linear-gradient(135deg, #1a0e06 0%, #2a1810 50%, #1a0e06 100%)",
          border: "2px solid rgba(255,200,100,0.3)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
          maxWidth: "90vw",
        }}
        initial={{ scale: 0.8, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
      >
        {isMatchOver && (
          <span className="text-5xl mb-2">
            {matchWinner === "white" ? "🏆" : "😞"}
          </span>
        )}

        <h2
          className="text-2xl sm:text-3xl font-bold"
          style={{ color: youWon ? "#f4e4c1" : "#ff6b6b" }}
        >
          {isMatchOver
            ? matchWinner === "white"
              ? "Match Won!"
              : "Match Lost"
            : youWon
              ? "You Win!"
              : "You Lost"}
        </h2>

        <p className="text-lg text-white/80">
          {label()}
        </p>

        <div
          className="w-full p-3 rounded-xl mt-2"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <p className="text-sm text-white/60 mb-1">
            Match Score (first to {matchTarget})
          </p>
          <div className="flex justify-center gap-6 text-lg font-bold">
            <span style={{ color: "#f4e4c1" }}>
              You: {matchScore.white}
            </span>
            <span className="text-white/40">vs</span>
            <span style={{ color: matchWinner === "white" ? "#f4e4c1" : "white" }}>
              Bot: {matchScore.black}
            </span>
          </div>
        </div>

        <div className="flex gap-3 mt-2">
          {!isMatchOver && (
            <button
              onClick={onNext}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #f4e4c1, #d4b880)",
                color: "#1a0e06",
              }}
            >
              Next Game →
            </button>
          )}
          <button
            onClick={onHome}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
            style={{
              background: "rgba(255,255,255,0.1)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            {isMatchOver ? "Back to Home" : "Quit Match"}
          </button>
        </div>

        {!isMatchOver && matchTarget > 1 && (
          <p className="text-xs text-white/30 mt-1">
            Next game starts automatically in 30s
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
