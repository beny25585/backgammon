import { DiceRow } from "../Dice";
import type { Color } from "../../lib/backgammon/engine";

interface Props {
  dice: number[];
  remaining: number[];
  color: Color;
  playerColor: Color;
  onReorder?: () => void;
  forceActive?: boolean;
  usedOpacity?: number;
  kind?: "live" | "blocked" | "following";
}

export default function DiceOverlay({ playerColor, kind = "live", ...props }: Props) {
  return (
    <div className="pointer-events-auto z-40 flex items-center gap-[var(--dice-overlay-gap,8px)] rounded [--dice-gap:clamp(3px,0.65cqw,7px)] [--die-size:clamp(25.5px,4.875cqw,42px)] [--die-radius:4px] [--pip-size:calc(var(--die-size)*0.168)] [@container_game-layout_(width>=900px)_and_(height>=500px)]:[--dice-gap:var(--board-live-dice-gap,10px)] [@container_game-layout_(width>=900px)_and_(height>=500px)]:[--die-size:var(--board-live-die-size,42px)] [@container_game-layout_(width>=900px)_and_(height>=500px)]:[--die-radius:5px]"
      data-testid="dice-overlay" data-roll-kind={kind}
      data-roll-color={props.color} data-roll-owner={props.color === playerColor ? "self" : "opponent"}>
      <DiceRow {...props} />
    </div>
  );
}
