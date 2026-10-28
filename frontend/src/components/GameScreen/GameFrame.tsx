import type { CSSProperties, ReactNode } from "react";
import { boardThemeClasses } from "../BoardThemeSelector/boardThemeClasses";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";
import styles from "./GameScreen.module.css";
import "../../styles/game-font.css";
import charcoalLeather from "../../assets/6b-charcoal-leather.png";
import BoardMaterialProvider from "../Board/materials/BoardMaterialProvider";
import { boardMaterialThemes } from "../Board/materials/boardMaterialThemes";
import GameSettingsDrawer from "../SidePanel/GameSettingsDrawer";

export default function GameFrame({
  children,
  theme = DEFAULT_BOARD_THEME,
  settings,
}: {
  children: ReactNode | ((settingsToggle: ReactNode) => ReactNode);
  theme?: BoardTheme;
  settings?: ReactNode;
}) {
  // Fit the board itself to 8:5; the player rail sits outside that ratio.
  return (
    <BoardMaterialProvider enabled theme={theme}>
    <div className="@container/game-layout grid size-full min-h-0 min-w-0 place-items-center [container-type:size]">
      <div
        className={`${styles.gameFrame} ${boardThemeClasses[theme]} grid h-[min(100cqh,calc((100cqw_-_var(--player-rail-width))/1.6))] w-[min(100cqw,calc(160cqh_+_var(--player-rail-width)))] min-w-0 grid-cols-[var(--player-rail-width)_minmax(0,1fr)] grid-rows-[0px_minmax(0,1fr)_0px] gap-x-0 bg-[#090b0b] text-[#efe4ca] [--player-rail-width:clamp(88px,12cqw,192px)] [font-family:'6B_Heebo',Arial,sans-serif] selection:bg-[#c8a66a] selection:text-[#17130c]`}
        data-testid="board-frame"
        data-board-theme={theme}
        style={{ "--board-leather-image": `url("${charcoalLeather}")`,
          "--board-number-color": boardMaterialThemes[theme].numberText,
          "--board-cube-material-text": boardMaterialThemes[theme].cubeText,
        } as CSSProperties}
      >
        {settings ? (
          <GameSettingsDrawer settings={settings}>
            {(toggle) => typeof children === "function" ? children(toggle) : children}
          </GameSettingsDrawer>
        ) : typeof children === "function" ? children(null) : children}
      </div>
    </div>
    </BoardMaterialProvider>
  );
}
