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
}

export default function DiceOverlay({ playerColor, ...props }: Props) {
  return (
    <div className={`${styles.boardOverlay} pointer-events-auto`}
      data-testid="dice-overlay" data-roll-owner={props.color === playerColor ? "self" : "opponent"}>
      <DiceRow {...props} />
    </div>
  );
}
