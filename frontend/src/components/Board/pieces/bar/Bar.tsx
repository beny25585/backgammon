import type { GameState, Color, Source } from "@/lib/backgammon/engine";
import Checker from "../checker/Checker";
import { BAR_W, POINT_H } from "../../layout";

interface BarProps {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  onClick: () => void;
}

export default function Bar({ state, selected, isLegalFrom, onClick }: BarProps) {
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
      data-point-idx="bar"
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
