import styles from "../GameScreen/GameScreen.module.css";
import type { BoardTheme } from "./boardThemes";

const classicClasses = "[--lux-material-texture:none] [--lux-photo-texture-opacity:0] [--lux-frame-texture-opacity:0] [--lux-point-texture-opacity:0] [--lux-field-sheen:none] [--lux-row-bg:none] [--lux-point-light-sheen:transparent] [--lux-point-dark-sheen:transparent] [--lux-point-edge:transparent] [--lux-point-edge-soft:transparent] [--lux-point-fiber:transparent] [--lux-checker-light-hi:#ffffff] [--lux-checker-light-mid:#fffdf5] [--lux-checker-light-low:#e6e0cf] [--lux-checker-light-deep:#aaa390] [--lux-checker-light-border:#d1cbbd] [--lux-checker-dark-hi:#343434] [--lux-checker-dark-mid:#111111] [--lux-checker-dark-low:#080808] [--lux-checker-dark-deep:#000000] [--lux-checker-dark-border:#050505] [--lux-die-dark-hi:#303030] [--lux-die-dark-low:#101010] [--lux-die-pip-light:#ffffff] [--lux-die-pip-dark:#111111] [--lux-panel-bg:#101314] [--ui-accent:#d6ae63] [--ui-accent-hover:#e8c680] [--ui-accent-soft:#d6ae633d] [--ui-accent-faint:#d6ae6324] [--ui-accent-border:#d6ae6380] [--ui-accent-glow:#d6ae6340] [--ui-on-accent:#17130c] [--ui-secondary-bg:#242424] [--ui-secondary-border:#d6ae6366] [--ui-menu-bg:#101314] [--ui-bar-overlay:none] [--ui-cube-bg:#161616] [--ui-cube-text:#fff4cf] [--lux-case-glow-top:#ffffff1a] [--lux-case-glow-side:#ffffff0d] [--lux-case-shadow-bottom:#00000040] [--lux-inner-border:#00000033] [--lux-case-border:#8d6a41] [--lux-rail-border:#8d6a41] [--lux-rivet:#b58c4e] [--lux-rivet-soft:#b58c4e33]";

const boardLayoutClasses = [
  "[--board-bar-cube-size:clamp(28px,5.35cqw,60px)] [--board-cube-font:clamp(16px,2.6cqw,28px)]",
  "[--board-live-die-size:52px] [--board-live-dice-gap:14px] [--board-live-pip-size:7px]",
  "[--board-checker-size:5.7cqw] [--board-bar-width:6.2cqw] [--board-center-gap:clamp(24px,10cqw,112px)] [--board-frame-inset:clamp(4px,1.25cqw,14px)] [--board-frame-pad-block:clamp(20px,3.1cqw,35px)] [--board-frame-pad-start:clamp(4px,2.65cqw,30px)] [--board-frame-pad-end:clamp(4px,0.75cqw,9px)]",
  "[@container_game-layout_(height<500px)]:[--board-center-gap:clamp(6px,0.72cqw,11px)]",
].join(" ");

const charcoalGoldClasses = [
  "[--lux-case-bg:#0b0e0f] [--lux-case-border:#ad874d99] [--lux-rail-border:#b6924b80]",
  "[--lux-rail-bg:linear-gradient(125deg,#292c29,#1a1e1b_24%,#141815_62%,#0d100e)]",
  "[--lux-board-area-bg:#080b0c] [--lux-field-bg:linear-gradient(135deg,#161a1b,#101415)]",
  "[--lux-bar-bg:linear-gradient(120deg,#2b302d,#202622_48%,#171c19)] [--lux-bearoff-bg:#0d1112] [--lux-center-belt:#131718]",
  "[--lux-material-texture:var(--board-leather-image)] [--lux-board-texture:var(--board-leather-image)] [--lux-board-texture-opacity:0.52] [--lux-row-bg:none]",
  "[--lux-photo-texture-opacity:0] [--lux-frame-texture-opacity:0] [--lux-point-texture-opacity:0.23] [--lux-material-layer-blend:soft-light]",
  "[--lux-field-sheen:radial-gradient(ellipse_at_50%_45%,#ffffff04,transparent_72%)]",
  "[--lux-point-light-a:#f3e8cd] [--lux-point-light-b:#d4c094] [--lux-point-light-sheen:#ffffff24]",
  "[--lux-point-dark-a:#c6a264] [--lux-point-dark-b:#a38043] [--lux-point-dark-sheen:#f3d89b1a]",
  "[--lux-point-edge:#00000026] [--lux-point-edge-soft:#e2bd6e24] [--lux-point-fiber:#ffffff03]",
  "[--lux-checker-light-hi:#fffbed] [--lux-checker-light-mid:#f0e1bd] [--lux-checker-light-low:#c9b185] [--lux-checker-light-deep:#9d8151] [--lux-checker-light-border:#af9669]",
  "[--lux-checker-dark-hi:#262c2e] [--lux-checker-dark-mid:#101516] [--lux-checker-dark-low:#080b0c] [--lux-checker-dark-deep:#020405] [--lux-checker-dark-border:#444b4d]",
  "[--lux-die-dark-hi:#34393b] [--lux-die-dark-low:#101415] [--lux-die-pip-light:#f7edda] [--lux-die-pip-dark:#17130c]",
  "[--lux-panel-bg:#0c1011] [--ui-accent:#d6ae63] [--ui-accent-hover:#edcb85] [--ui-accent-soft:#d6ae6329] [--ui-accent-faint:#d6ae6314] [--ui-accent-border:#d6ae6399] [--ui-accent-glow:#d6ae6333] [--ui-on-accent:#1a1409]",
  "[--board-primary-surface:linear-gradient(180deg,#e9c77e,#c49a49)] [--ui-secondary-bg:#171b1c] [--ui-secondary-border:#bfa16b80] [--ui-menu-bg:#111516] [--ui-bar-overlay:none]",
  "[--ui-cube-bg:linear-gradient(145deg,#323737,#111516)] [--ui-cube-text:#f3dfab]",
  "[--board-bearoff-count-bg:#101415] [--board-bearoff-count-text:#f0dfb7]",
  "[--lux-case-glow-top:#fff7dc08] [--lux-case-glow-side:#fff7dc04] [--lux-case-shadow-bottom:#00000030] [--lux-inner-border:#00000066] [--lux-rivet:transparent] [--lux-rivet-soft:transparent]",
].join(" ");

export const boardThemeClasses: Record<BoardTheme, string> = {
  charcoalGold: `${charcoalGoldClasses} ${boardLayoutClasses}`,
  redGreen: `${styles.defaultTheme} ${styles.themeRedGreen} ${boardLayoutClasses}`,
  blueIvory: `${styles.defaultTheme} ${styles.themeBlueIvory} ${boardLayoutClasses}`,
  ivoryGold: `${styles.defaultTheme} ${styles.themeIvoryGold} ${boardLayoutClasses}`,
  classicBrown: `${classicClasses} [&_[data-testid=board-inner-frame]]:[background:var(--lux-rail-bg)] [--lux-case-bg:#382016] [--lux-rail-bg:#382016] [--lux-board-area-bg:#382016] [--lux-field-bg:#76513a] [--lux-bar-bg:#382016] [--lux-bearoff-bg:#382016] [--lux-center-belt:#76513a] [--lux-point-light-a:#bc844b] [--lux-point-light-b:#bc844b] [--lux-point-dark-a:#4b3023] [--lux-point-dark-b:#4b3023] ${boardLayoutClasses}`,
  classicLight: `${classicClasses} [&_[data-testid=board-inner-frame]]:[background:var(--lux-rail-bg)] [--lux-case-bg:#d8c9a9] [--lux-rail-bg:#d8c9a9] [--lux-board-area-bg:#d8c9a9] [--lux-field-bg:#ede8d7] [--lux-bar-bg:#d8c9a9] [--lux-bearoff-bg:#d8c9a9] [--lux-center-belt:#ede8d7] [--lux-point-light-a:#b82e38] [--lux-point-light-b:#b82e38] [--lux-point-dark-a:#191c20] [--lux-point-dark-b:#191c20] ${boardLayoutClasses}`,
};
