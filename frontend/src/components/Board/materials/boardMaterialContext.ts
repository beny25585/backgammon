import { createContext, useContext } from "react";
import type { DiceMaterialImages } from "./diceMaterialRenderer";
import type { BoardTheme } from "../../BoardThemeSelector/boardThemes";

export type CheckerMaterialImages = Record<"white" | "black", string>;

export interface BoardMaterialImages {
  theme?: BoardTheme;
  checkerImages: CheckerMaterialImages;
  diceImages: DiceMaterialImages | null;
}

interface BoardMaterialContextValue {
  theme: BoardTheme;
  enabled: boolean;
  ready: boolean;
  checkerImages: CheckerMaterialImages | null;
  diceImages: DiceMaterialImages | null;
  publish: (images: BoardMaterialImages | null) => void;
}

export const BoardMaterialContext = createContext<BoardMaterialContextValue>({
  theme: "charcoalGold",
  enabled: false,
  ready: false,
  checkerImages: null,
  diceImages: null,
  publish: () => {},
});

export function useBoardMaterials() {
  return useContext(BoardMaterialContext);
}
