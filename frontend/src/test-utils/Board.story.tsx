import type { ComponentProps } from "react";
import { Board } from "../components/Board/Board";
import styles from "../components/GameScreen/GameScreen.module.css";
import GameFrame from "../components/GameScreen/GameFrame";
import { boardThemeClasses } from "../components/BoardThemeSelector/boardThemeClasses";
import { DEFAULT_BOARD_THEME, type BoardTheme } from "../components/BoardThemeSelector/boardThemes";

export function SizedBoardFixture({ theme = DEFAULT_BOARD_THEME, ...props }: ComponentProps<typeof Board> & { theme?: BoardTheme }) {
  return (
    <div className={`${styles.container} ${boardThemeClasses[theme]} bg-[#050c0e]`}>
      <GameFrame theme={theme}>
        <div className={`${styles.boardArea} col-start-3 row-start-1`}>
          <Board {...props} />
        </div>
      </GameFrame>
    </div>
  );
}
