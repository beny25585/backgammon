import type { HTMLAttributes } from "react";

export type BoardSide = "left" | "right";

interface Props extends HTMLAttributes<HTMLDivElement> {
  side: BoardSide;
}

/** Occupy the actual playing half's grid track, excluding the bar and trays. */
export default function BoardHalfOverlay({ side, className = "", ...props }: Props) {
  return (
    <div
      {...props}
      data-overlay-side={side}
      className={`pointer-events-none relative row-start-1 flex min-h-0 min-w-0 items-center justify-center ${side === "left" ? "col-start-1" : "col-start-3"} ${className}`}
    />
  );
}
