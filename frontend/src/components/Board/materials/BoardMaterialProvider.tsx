import { useMemo, useState, type ReactNode } from "react";
import { BoardMaterialContext, type BoardMaterialImages } from "./boardMaterialContext";
import { DEFAULT_BOARD_THEME, type BoardTheme } from "../../BoardThemeSelector/boardThemes";

export default function BoardMaterialProvider({ enabled, theme = DEFAULT_BOARD_THEME, children }: {
  enabled: boolean; theme?: BoardTheme; children: ReactNode;
}) {
  const [materials, publish] = useState<BoardMaterialImages | null>(null);
  const value = useMemo(() => {
    const current = enabled && materials && (materials.theme ?? DEFAULT_BOARD_THEME) === theme ? materials : null;
    return { enabled, theme, ready: current !== null,
      checkerImages: current?.checkerImages ?? null, diceImages: current?.diceImages ?? null, publish };
  }, [enabled, theme, materials]);

  return <BoardMaterialContext.Provider value={value}>{children}</BoardMaterialContext.Provider>;
}
