import type { ComponentProps } from "react";
import { Board } from "../components/Board/Board";
import styles from "../components/GameScreen/GameScreen.module.css";
import GameFrame from "../components/GameScreen/GameFrame";
import { boardThemeClasses } from "../components/BoardThemeSelector/boardThemeClasses";
import { DEFAULT_BOARD_THEME } from "../components/BoardThemeSelector/boardThemes";

export function SizedBoardFixture(props: ComponentProps<typeof Board>) {
  return (
    <div className={`${styles.container} ${boardThemeClasses[DEFAULT_BOARD_THEME]} bg-[#050c0e]`}>
      <GameFrame>
        <div className={styles.boardArea}>
          <Board {...props} />
        </div>
      </GameFrame>
    </div>
  );
}
