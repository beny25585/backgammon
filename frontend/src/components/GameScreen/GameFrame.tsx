import type { ReactNode } from "react";
import { boardThemeClasses } from "../BoardThemeSelector/boardThemeClasses";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";
import styles from "./GameScreen.module.css";

export default function GameFrame({
  children,
  theme = DEFAULT_BOARD_THEME,
}: {
  children: ReactNode;
  theme?: BoardTheme;
}) {
  return (
    <div
      className={`${styles.gameFrame} ${boardThemeClasses[theme]} grid aspect-[33/20] w-[min(100%,calc((var(--app-height,100dvh)-var(--game-safe-top,0px)-var(--game-safe-bottom,0px)-24px)*1.65))] max-w-[1440px] grid-cols-[minmax(96px,0.28fr)_minmax(0,1fr)_44px] gap-1 [background:var(--lux-rail-bg)]`}
      data-testid="board-frame"
    >
      {children}
    </div>
  );
}
