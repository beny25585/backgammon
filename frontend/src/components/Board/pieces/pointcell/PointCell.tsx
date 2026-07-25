import { motion } from "motion/react";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";
import Checker from "../checker/Checker";
import { POINT_H } from "../../layout";

interface PointCellProps {
  index: number;
  top?: boolean;
  state: GameState;
  selected: boolean;
  isLegalTarget: boolean;
  isLegalFrom: boolean;
  lastMoveFrom: Source | null;
  lastMoveTo: Target | null;
  onClick: () => void;
}

export default function PointCell({
  index,
  top,
  state,
  selected,
  isLegalTarget,
  isLegalFrom,
  lastMoveFrom,
  lastMoveTo,
  onClick,
}: PointCellProps) {
  const isLight = index % 2 === 0;
  const count = Math.abs(state.points[index]);
  const color: "white" | "black" | null =
    state.points[index] > 0
      ? "white"
      : state.points[index] < 0
        ? "black"
        : null;

  const isMoveTarget = lastMoveTo === index;
  const displayedCount = Math.min(count, 5);
  const newCheckerIndex = isMoveTarget ? displayedCount - 1 : -1;

  return (
    <motion.button
      whileHover={isLegalFrom || isLegalTarget ? { y: -2 } : undefined}
      onClick={onClick}
      className="relative flex flex-col items-center overflow-hidden focus:outline-none group"
      style={{ direction: "ltr", height: POINT_H }}
      data-point-idx={index}
    >
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? `linear-gradient(${top ? "180deg" : "0deg"}, #e8bf87 0%, #b98548 100%)`
            : `linear-gradient(${top ? "180deg" : "0deg"}, #4a2f1a 0%, #1a0e06 100%)`,
          clipPath: top
            ? "polygon(0 0, 100% 0, 50% 100%)"
            : "polygon(50% 0, 100% 100%, 0 100%)",
        }}
      />
      {(selected || isLegalTarget || isLegalFrom) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`absolute inset-0 pointer-events-none ${isLegalTarget ? "animate-pulse-glow" : ""}`}
          style={{
            background: isLegalTarget
              ? "radial-gradient(circle at 50% 50%, rgba(232,191,135,0.55), transparent 70%)"
              : selected
                ? "radial-gradient(circle at 50% 50%, rgba(232,191,135,0.75), transparent 70%)"
                : "radial-gradient(circle at 50% 50%, rgba(232,191,135,0.2), transparent 70%)",
          }}
        />
      )}
      <div
        className={`flex items-center gap-0.5 py-2 ${
          top ? "relative flex-col" : "absolute bottom-0 flex-col-reverse"
        }`}
      >
        {Array.from({ length: displayedCount }).map((_, i) => (
          <Checker
            key={i}
            color={color!}
            flyIn={i === newCheckerIndex}
            label={i === 4 && count > 5 ? String(count) : undefined}
          />
        ))}
      </div>
    </motion.button>
  );
}
