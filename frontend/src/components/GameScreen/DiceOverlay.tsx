import { DiceRow } from "../Dice";
import type { Color } from "../../lib/backgammon/engine";
import styles from "./GameScreen.module.css";

interface Props {
  dice: number[];
  remaining: number[];
  color: Color;
  playerColor: Color;
  onReorder?: () => void;
  forceActive?: boolean;
  kind?: "live" | "blocked" | "following";
}

export default function DiceOverlay({ playerColor, kind = "live", ...props }: Props) {
  return (
    <div className={`${styles.boardOverlay} pointer-events-auto`}
      data-testid="dice-overlay" data-roll-kind={kind}
      data-roll-color={props.color} data-roll-owner={props.color === playerColor ? "self" : "opponent"}>
      <DiceRow {...props} />
    </div>
  );
}
