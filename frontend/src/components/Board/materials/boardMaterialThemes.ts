import type { BoardTheme } from "../../BoardThemeSelector/boardThemes";

export interface MaterialColorRamp {
  dark: string;
  light: string;
  gain?: number;
}

export interface BoardMaterialTheme {
  id: BoardTheme;
  rim: string;
  field: string;
  bar: string;
  tray: string;
  trim: string;
  pointLight: readonly [string, string];
  pointDark: readonly [string, string];
  checkerLight?: MaterialColorRamp;
  checkerDark?: MaterialColorRamp;
  diceLight?: MaterialColorRamp;
  diceDark?: MaterialColorRamp;
  cube?: MaterialColorRamp;
  pipDark: string;
  pipLight: string;
  cubeText: string;
  numberText: string;
  lightSurface: boolean;
}

const classicMaterials = {
  checkerLight: { dark: "#e6e0cf", light: "#ffffff" },
  checkerDark: { dark: "#000000", light: "#343434", gain: 3 },
  diceLight: { dark: "#e6e0cf", light: "#ffffff" },
  diceDark: { dark: "#101010", light: "#303030", gain: 3 },
  cube: { dark: "#080808", light: "#303030" },
  pipDark: "#111111",
  pipLight: "#ffffff",
  cubeText: "#fff4cf",
};

// Palette values mirror GameScreen.module.css and BoardThemeSelector/boardThemeClasses.ts.
// The charcoal atlas is already finished artwork; its optional recolor ramps stay absent.
export const boardMaterialThemes: Record<BoardTheme, BoardMaterialTheme> = {
  charcoalGold: {
    id: "charcoalGold",
    rim: "#1a1e1b", field: "#101415", bar: "#202622", tray: "#0d1112", trim: "#d6ae63",
    pointLight: ["#f3e8cd", "#d4c094"], pointDark: ["#c6a264", "#a38043"],
    pipDark: "#17130c", pipLight: "#f7edda", cubeText: "#694c25", numberText: "#ead3a2",
    lightSurface: false,
  },
  redGreen: {
    id: "redGreen",
    rim: "#66391c", field: "#7b4a27", bar: "#482712", tray: "#4b2813", trim: "#e5b44d",
    pointLight: ["#f4e4bd", "#d0a960"], pointDark: ["#23675b", "#082f2c"],
    checkerLight: { dark: "#d9bf82", light: "#fffdf4" },
    checkerDark: { dark: "#6f1722", light: "#c85a58", gain: 3 },
    diceLight: { dark: "#d9bf82", light: "#fffdf4" },
    diceDark: { dark: "#3d090f", light: "#c85a58", gain: 3 },
    cube: { dark: "#6f1722", light: "#a93643" },
    pipDark: "#22150c", pipLight: "#f8f0d8", cubeText: "#fff6ec", numberText: "#ead3a2",
    lightSurface: false,
  },
  blueIvory: {
    id: "blueIvory",
    rim: "#2f4b6a", field: "#3b5b7a", bar: "#27425e", tray: "#27425e", trim: "#d6c28f",
    pointLight: ["#f7eed7", "#cdbb8f"], pointDark: ["#2a79a9", "#0a3158"],
    checkerLight: { dark: "#cbb582", light: "#fffdfa" },
    checkerDark: { dark: "#0d4c78", light: "#2f85b9", gain: 3 },
    diceLight: { dark: "#cbb582", light: "#fffdfa" },
    diceDark: { dark: "#092540", light: "#4b9fcb", gain: 3 },
    cube: { dark: "#2439d6", light: "#3d6cff" },
    pipDark: "#071d33", pipLight: "#edf8ff", cubeText: "#f5f8ff", numberText: "#ecdeb4",
    lightSurface: false,
  },
  ivoryGold: {
    id: "ivoryGold",
    rim: "#efe5cd", field: "#f7eed7", bar: "#babbb5", tray: "#babbb5", trim: "#d1a948",
    pointLight: ["#f2dfae", "#bc9650"], pointDark: ["#d2a84b", "#9a7029"],
    checkerLight: { dark: "#cbbd98", light: "#fffefa" },
    checkerDark: { dark: "#9d711e", light: "#d7a843", gain: 3 },
    diceLight: { dark: "#cbbd98", light: "#fffefa" },
    diceDark: { dark: "#4c3108", light: "#d7a843", gain: 3 },
    cube: { dark: "#a87927", light: "#e0bb68" },
    pipDark: "#3f2a08", pipLight: "#fff9de", cubeText: "#201607", numberText: "#3f2a08",
    lightSurface: true,
  },
  classicBrown: {
    ...classicMaterials,
    id: "classicBrown",
    rim: "#382016", field: "#76513a", bar: "#382016", tray: "#382016", trim: "#8d6a41",
    pointLight: ["#bc844b", "#bc844b"], pointDark: ["#4b3023", "#4b3023"],
    numberText: "#fff4cf", lightSurface: false,
  },
  classicLight: {
    ...classicMaterials,
    id: "classicLight",
    rim: "#d8c9a9", field: "#ede8d7", bar: "#d8c9a9", tray: "#d8c9a9", trim: "#8d6a41",
    pointLight: ["#b82e38", "#b82e38"], pointDark: ["#191c20", "#191c20"],
    numberText: "#191c20", lightSurface: true,
  },
};
