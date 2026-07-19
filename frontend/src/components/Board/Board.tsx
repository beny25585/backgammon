import { motion } from "motion/react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import { BAR, OFF, type Source, type Target } from "@/lib/backgammon/engine";

interface BoardProps {
  state: GameState;
  myColor: Color | null;
  selected: Source | null;
  legalTargets: (Target)[];
  onSelect: (from: Source | null) => void;
  onMove: (to: Target) => void;
  legalFromPoints: (Source)[];
}

const TOP_POINTS = [23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12];
const BOTTOM_POINTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Fluid sizes: scale with viewport, capped for large screens
const POINT_H = "clamp(140px, 28vw, 240px)";
const BAR_W = "clamp(28px, 4vw, 42px)";
const BEAROFF_W = "clamp(40px, 6vw, 58px)";
const CHECKER = "clamp(22px, 4.2vw, 36px)";

export function Board({
  state,
  myColor,
  selected,
  legalTargets,
  onSelect,
  onMove,
  legalFromPoints,
}: BoardProps) {
  function handleClick(idx: Source) {
    if (typeof idx === "number" && legalTargets.includes(idx)) {
      onMove(idx);
      return;
    }
    if (selected === idx) {
      // Double-click: auto-move if only one target
      if (legalTargets.length === 1) {
        onMove(legalTargets[0]);
      } else {
        onSelect(null);
      }
    } else if (legalFromPoints.includes(idx)) {
      onSelect(idx);
    }
  }

  return (
    <div
      className="relative rounded-3xl p-2 sm:p-3 shadow-2xl mx-auto w-full"
      style={{
        background: "linear-gradient(145deg, #5a3a20, #2a1810)",
        maxWidth: "min(920px, 100%)",
        boxShadow:
          "0 30px 80px -30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      <div
        className="grid grid-cols-[1fr_auto_1fr_auto] gap-0 rounded-lg overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #9c6535, #7a4a24)",
          boxShadow: "inset 0 0 60px rgba(0,0,0,0.55)",
        }}
      >
        <div className="grid grid-rows-2">
          <div className="grid grid-cols-6">
            {TOP_POINTS.slice(0, 6).map((idx) => (
              <PointCell
                key={idx}
                index={idx}
                top
                state={state}
                selected={selected === idx}
                isLegalTarget={legalTargets.includes(idx)}
                isLegalFrom={legalFromPoints.includes(idx)}
                onClick={() => handleClick(idx)}
              />
            ))}
          </div>
          <div className="grid grid-cols-6">
            {BOTTOM_POINTS.slice(0, 6).map((idx) => (
              <PointCell
                key={idx}
                index={idx}
                state={state}
                selected={selected === idx}
                isLegalTarget={legalTargets.includes(idx)}
                isLegalFrom={legalFromPoints.includes(idx)}
                onClick={() => handleClick(idx)}
              />
            ))}
          </div>
        </div>

        <Bar
          state={state}
          myColor={myColor}
          selected={selected === BAR}
          isLegalFrom={legalFromPoints.includes(BAR)}
          onClick={() => handleClick(BAR)}
        />

        <div className="grid grid-rows-2">
          <div className="grid grid-cols-6">
            {TOP_POINTS.slice(6).map((idx) => (
              <PointCell
                key={idx}
                index={idx}
                top
                state={state}
                selected={selected === idx}
                isLegalTarget={legalTargets.includes(idx)}
                isLegalFrom={legalFromPoints.includes(idx)}
                onClick={() => handleClick(idx)}
              />
            ))}
          </div>
          <div className="grid grid-cols-6">
            {BOTTOM_POINTS.slice(6).map((idx) => (
              <PointCell
                key={idx}
                index={idx}
                state={state}
                selected={selected === idx}
                isLegalTarget={legalTargets.includes(idx)}
                isLegalFrom={legalFromPoints.includes(idx)}
                onClick={() => handleClick(idx)}
              />
            ))}
          </div>
        </div>

        <BearOff
          state={state}
          myColor={myColor}
          isLegalTarget={legalTargets.includes(OFF)}
          onClick={() => legalTargets.includes(OFF) && onMove(OFF)}
        />
      </div>
    </div>
  );
}

function PointCell({
  index,
  top,
  state,
  selected,
  isLegalTarget,
  isLegalFrom,
  onClick,
}: {
  index: number;
  top?: boolean;
  state: GameState;
  selected: boolean;
  isLegalTarget: boolean;
  isLegalFrom: boolean;
  onClick: () => void;
}) {
  const isLight = index % 2 === 0;
  const count = Math.abs(state.points[index]);
  const color: "white" | "black" | null =
    state.points[index] > 0
      ? "white"
      : state.points[index] < 0
        ? "black"
        : null;

  return (
    <motion.button
      whileHover={isLegalFrom || isLegalTarget ? { y: -2 } : undefined}
      onClick={onClick}
      className="relative flex flex-col items-center overflow-hidden focus:outline-none group"
      style={{ direction: "ltr", height: POINT_H }}
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
        {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
          <Checker
            key={i}
            color={color!}
            label={i === 4 && count > 5 ? String(count) : undefined}
          />
        ))}
      </div>
    </motion.button>
  );
}

function Checker({
  color,
  label,
}: {
  color: "white" | "black";
  label?: string;
}) {
  const isWhite = color === "white";
  return (
    <motion.div
      layout
      initial={{ scale: 0.5, opacity: 0, y: -8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className="rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{
        width: CHECKER,
        height: CHECKER,
        background: isWhite
          ? "radial-gradient(circle at 30% 25%, #ffffff, #f4e4c1 55%, #b89660 100%)"
          : "radial-gradient(circle at 30% 25%, #6a4830, #2a1810 55%, #0a0402 100%)",
        boxShadow:
          "0 3px 6px rgba(0,0,0,0.55), inset 0 -3px 4px rgba(0,0,0,0.35), inset 0 2px 2px rgba(255,255,255,0.15)",
        color: isWhite ? "#3d2817" : "#f4e4c1",
        border: isWhite ? "1px solid #c9a961" : "1px solid #000",
      }}
    >
      {label}
    </motion.div>
  );
}

function Bar({
  state,
  selected,
  isLegalFrom,
  onClick,
}: {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col justify-between items-center py-3 focus:outline-none"
      style={{
        width: BAR_W,
        height: `calc(${POINT_H} * 2)`,
        background: "linear-gradient(180deg, #4a2f1a, #1a0e06)",
        boxShadow:
          "inset 2px 0 4px rgba(0,0,0,0.5), inset -2px 0 4px rgba(0,0,0,0.5)",
      }}
    >
      {(selected || isLegalFrom) && (
        <div className="absolute inset-0 bg-[rgba(232,191,135,0.28)] animate-pulse-glow" />
      )}
      <div className="flex flex-col gap-1 items-center relative">
        {Array.from({ length: state.bar.black }).map((_, i) => (
          <Checker key={i} color="black" />
        ))}
      </div>
      <div className="flex flex-col gap-1 items-center relative">
        {Array.from({ length: state.bar.white }).map((_, i) => (
          <Checker key={i} color="white" />
        ))}
      </div>
    </button>
  );
}

function BearOff({
  state,
  isLegalTarget,
  onClick,
}: {
  state: GameState;
  myColor: Color | null;
  isLegalTarget: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col justify-between p-1.5 sm:p-2 focus:outline-none"
      style={{
        width: BEAROFF_W,
        height: `calc(${POINT_H} * 2)`,
        background: "linear-gradient(180deg, #1a0e06, #0a0603)",
      }}
    >
      {isLegalTarget && (
        <div className="absolute inset-0 bg-[rgba(232,191,135,0.4)] animate-pulse-glow" />
      )}
      <div className="flex flex-col gap-0.5 items-center relative">
        <div className="text-[9px] sm:text-[10px] text-gold mb-1">
          שחור
        </div>
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
