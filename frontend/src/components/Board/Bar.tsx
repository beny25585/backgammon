import type { GameState, Color } from "@/lib/backgammon/engine";
import { Checker } from "./Checker";
import styles from "./Bar.module.css";

export function Bar({
  state,
  selected,
  isLegalFrom,
  onClick,
  className,
}: {
  state: GameState;
  myColor: Color | null;
  selected: boolean;
  isLegalFrom: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`${styles.bar} focus:outline-none ${className ?? ""}`}
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
