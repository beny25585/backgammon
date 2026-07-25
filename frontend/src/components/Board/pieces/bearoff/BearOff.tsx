import { motion } from "motion/react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import { BEAROFF_W, POINT_H, CHECKER } from "../../layout";

interface BearOffProps {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
}

export default function BearOff({ state, isLegalTarget, onClick }: BearOffProps) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col justify-between p-1.5 sm:p-2 focus:outline-none"
      style={{
        width: BEAROFF_W,
        height: `calc(${POINT_H} * 2)`,
        background: "linear-gradient(180deg, #1a0e06, #0a0603)",
      }}
      data-point-idx="off"
    >
      {isLegalTarget && (
        <div className="absolute inset-0 bg-[rgba(232,191,135,0.4)] animate-pulse-glow" />
      )}
      <div className="flex flex-col gap-0.5 items-center relative">
        <div className="text-[9px] sm:text-[10px] text-gold mb-1">שחור</div>
        {Array.from({ length: Math.min(state.home.black, 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="h-1.5 sm:h-2 rounded-sm"
            style={{
              width: `calc(${CHECKER} - 4px)`,
              background: "linear-gradient(180deg, #4a3020, #2a1810)",
              border: "1px solid #000",
            }}
          />
        ))}
      </div>
      <div className="flex flex-col-reverse gap-0.5 items-center relative">
        <div className="text-[9px] sm:text-[10px] text-gold mt-1">לבן</div>
        {Array.from({ length: Math.min(state.home.white, 15) }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="h-1.5 sm:h-2 rounded-sm"
            style={{
              width: `calc(${CHECKER} - 4px)`,
              background: "linear-gradient(180deg, #fff7e0, #d4b880)",
              border: "1px solid #c9a961",
            }}
          />
        ))}
      </div>
    </button>
  );
}
