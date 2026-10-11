import type { ComponentProps } from "react";
import { Board } from "../components/Board/Board";
import styles from "../components/GameScreen/GameScreen.module.css";

export function SizedBoardFixture(props: ComponentProps<typeof Board>) {
  return (
    <div className={styles.container}>
      <div className={styles.gameFrame}>
        <div className={styles.boardArea}>
          <Board {...props} />
        </div>
      </div>
    </div>
  );
}
