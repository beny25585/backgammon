import GameBoard from "../components/GameScreen/GameBoard";
import type { Color, GameState, Source, Target } from "../lib/backgammon/engine";
import { MockGameWrapper } from "./wrappers";
import styles from "../components/GameScreen/GameScreen.module.css";
import appStyles from "../App.module.css";

export interface DragMoveCall {
  from: Source;
  to: Target;
  die?: number;
}

interface MultiDragHarnessProps {
  state: GameState;
  playerColor: Color;
  pending?: boolean;
  onMove: (move: DragMoveCall) => void;
}

// Keep the synchronous pending getter in the browser. Playwright transports
// callbacks supplied by a test asynchronously, which cannot model this gate.
export function MultiDragHarness({
  state,
  playerColor,
  pending = false,
  onMove,
}: MultiDragHarnessProps) {
  return (
    <div className={appStyles.gameContent}>
      <div className={styles.container}>
        <MockGameWrapper state={state} playerColor={playerColor}>
          <GameBoard
            state={state}
            playerColor={playerColor}
            hasPendingMoves={() => pending}
            makeMove={(from, to, options) => onMove({ from, to, die: options?.die })}
          />
        </MockGameWrapper>
      </div>
    </div>
  );
}
