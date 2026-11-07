import styles from "../GameScreen/GameScreen.module.css";
import type { BoardTheme } from "./boardThemes";

const classicClasses = "[--lux-material-texture:none] [--lux-photo-texture-opacity:0] [--lux-frame-texture-opacity:0] [--lux-point-texture-opacity:0] [--lux-field-sheen:none] [--lux-row-bg:none] [--lux-point-light-sheen:transparent] [--lux-point-dark-sheen:transparent] [--lux-point-edge:transparent] [--lux-point-edge-soft:transparent] [--lux-point-fiber:transparent] [--lux-checker-light-hi:#ffffff] [--lux-checker-light-mid:#fffdf5] [--lux-checker-light-low:#e6e0cf] [--lux-checker-light-deep:#aaa390] [--lux-checker-light-border:#d1cbbd] [--lux-checker-dark-hi:#343434] [--lux-checker-dark-mid:#111111] [--lux-checker-dark-low:#080808] [--lux-checker-dark-deep:#000000] [--lux-checker-dark-border:#050505] [--lux-die-dark-hi:#303030] [--lux-die-dark-low:#101010] [--lux-die-pip-light:#ffffff] [--lux-die-pip-dark:#111111] [--lux-panel-bg:#101314] [--ui-accent:#d6ae63] [--ui-accent-hover:#e8c680] [--ui-accent-soft:#d6ae633d] [--ui-accent-faint:#d6ae6324] [--ui-accent-border:#d6ae6380] [--ui-accent-glow:#d6ae6340] [--ui-on-accent:#17130c] [--ui-secondary-bg:#242424] [--ui-secondary-border:#d6ae6366] [--ui-menu-bg:#101314] [--ui-bar-overlay:none] [--ui-cube-bg:#161616] [--ui-cube-text:#fff4cf] [--lux-case-glow-top:#ffffff1a] [--lux-case-glow-side:#ffffff0d] [--lux-case-shadow-bottom:#00000040] [--lux-inner-border:#00000033] [--lux-case-border:#8d6a41] [--lux-rail-border:#8d6a41] [--lux-rivet:#b58c4e] [--lux-rivet-soft:#b58c4e33]";

const boardLayoutClasses = [
  "[--board-bar-cube-size:clamp(28px,5.35cqw,60px)] [--board-cube-font:clamp(16px,2.6cqw,28px)]",
  "[--board-live-die-size:52px] [--board-live-dice-gap:14px] [--board-live-pip-size:7px]",
  "[--board-checker-size:5.7cqw] [--board-bar-width:6.2cqw] [--board-center-gap:clamp(24px,10cqw,112px)] [--board-frame-inset:clamp(4px,1.25cqw,14px)] [--board-frame-pad-block:clamp(20px,3.1cqw,35px)] [--board-frame-pad-start:clamp(4px,2.65cqw,30px)] [--board-frame-pad-end:clamp(4px,0.75cqw,9px)]",
  "[@container_game-layout_(height<500px)]:[--board-center-gap:clamp(6px,0.72cqw,11px)]",
].join(" ");

const boardLeatherClasses = "[--lux-board-texture-layer:var(--board-leather-image)_0_0/432px_432px_repeat] [--lux-board-texture-opacity:0.68]";

const charcoalGoldClasses = [
  "[--lux-case-bg:#0b0e0f] [--lux-case-border:#ad874d99] [--lux-rail-border:#b6924b80]",
  "[--lux-rail-bg:linear-gradient(125deg,#292c29,#1a1e1b_24%,#141815_62%,#0d100e)]",
  "[--lux-board-area-bg:#080b0c] [--lux-field-bg:linear-gradient(135deg,#161a1b,#101415)]",
  "[--lux-bar-bg:linear-gradient(120deg,#2b302d,#202622_48%,#171c19)] [--lux-bearoff-bg:#0d1112] [--lux-center-belt:#131718]",
  "[--lux-material-texture:var(--board-leather-image)] [--lux-row-bg:none]",
  "[--lux-photo-texture-opacity:0] [--lux-frame-texture-opacity:0] [--lux-point-texture-opacity:0.23] [--lux-material-layer-blend:soft-light]",
  "[--lux-field-sheen:radial-gradient(ellipse_at_50%_45%,#ffffff04,transparent_72%)]",
  "[--lux-point-light-a:#f3e8cd] [--lux-point-light-b:#d4c094] [--lux-point-light-sheen:#ffffff24]",
  "[--lux-point-dark-a:#c6a264] [--lux-point-dark-b:#a38043] [--lux-point-dark-sheen:#f3d89b1a]",
  "[--lux-point-edge:#00000026] [--lux-point-edge-soft:#e2bd6e24] [--lux-point-fiber:#ffffff03]",
  "[--lux-checker-light-hi:#fffbed] [--lux-checker-light-mid:#f0e1bd] [--lux-checker-light-low:#c9b185] [--lux-checker-light-deep:#9d8151] [--lux-checker-light-border:#af9669]",
  "[--lux-checker-dark-hi:#262c2e] [--lux-checker-dark-mid:#101516] [--lux-checker-dark-low:#080b0c] [--lux-checker-dark-deep:#020405] [--lux-checker-dark-border:#444b4d]",
  "[--lux-die-dark-hi:#34393b] [--lux-die-dark-low:#101415] [--lux-die-pip-light:#f7edda] [--lux-die-pip-dark:#17130c]",
  "[--lux-panel-bg:linear-gradient(145deg,#191d1e,#0b0e0f)] [--ui-accent:#d6ae63] [--ui-accent-hover:#edcb85] [--ui-accent-soft:#d6ae6329] [--ui-accent-faint:#d6ae6314] [--ui-accent-border:#d6ae6399] [--ui-accent-glow:#d6ae6333] [--ui-on-accent:#1a1409]",
  "[--board-primary-surface:linear-gradient(180deg,#e9c77e,#c49a49)] [--ui-secondary-bg:#171b1c] [--ui-secondary-border:#bfa16b80] [--ui-menu-bg:#111516] [--ui-bar-overlay:none]",
  "[--ui-cube-bg:linear-gradient(145deg,#323737,#111516)] [--ui-cube-text:#f3dfab]",
  "[--board-bearoff-count-bg:#101415] [--board-bearoff-count-text:#f0dfb7]",
  "[--lux-case-glow-top:#fff7dc08] [--lux-case-glow-side:#fff7dc04] [--lux-case-shadow-bottom:#00000030] [--lux-inner-border:#00000066] [--lux-rivet:transparent] [--lux-rivet-soft:transparent]",
].join(" ");

const brownGoldClasses = [
  "[--lux-case-bg:#20170f] [--lux-case-border:#d3a15b] [--lux-rail-border:#bb894da8]",
  "[--lux-rail-bg:linear-gradient(135deg,#2a1d1390,#140d0899),var(--board-wood-image,linear-gradient(135deg,#38261a,#21170e))_center/100%_100%_no-repeat] [--lux-board-area-bg:#211710]",
  "[--lux-field-bg:#181510] [--lux-bar-bg:linear-gradient(90deg,#30271c,#201c16_53%,#100e0a)] [--lux-bearoff-bg:#0e0b08] [--lux-center-belt:#181510]",
  "[--lux-row-bg:none]",
  "[--lux-point-texture-image:var(--board-club-material-image)] [--lux-point-texture-size:300%_100%]",
  "[--lux-photo-texture-opacity:0] [--lux-frame-texture-opacity:0] [--lux-point-texture-opacity:0.30] [--lux-material-layer-blend:soft-light]",
  "[--lux-field-sheen:radial-gradient(ellipse_at_34%_30%,#eee9d509,transparent_74%)]",
  "[--lux-point-light-a:#f6d9a8] [--lux-point-light-b:#c9955a] [--lux-point-light-sheen:#ffecd030]",
  "[--lux-point-dark-a:#edb96b] [--lux-point-dark-b:#a4622b] [--lux-point-dark-sheen:#ffdda030]",
  "[--lux-point-edge:#2114077a] [--lux-point-edge-soft:#f6ce803d] [--lux-point-fiber:#fce9bb06]",
  "[--lux-point-extension:max(0px,min(40px,calc((var(--board-center-gap,0px)_-_36px)/2)))]",
  "[--lux-point-contact-top:linear-gradient(to_bottom,#190d08a8,#190d0855_1.5%,transparent_8%)] [--lux-point-contact-bottom:linear-gradient(to_top,#190d0873,#190d0830_1.5%,transparent_8%)]",
  "[--lux-point-satin-top:radial-gradient(ellipse_63%_44%_at_28%_23%,#fff0bd54,#fff0bd23_42%,transparent)] [--lux-point-satin-bottom:radial-gradient(ellipse_63%_44%_at_28%_65%,#fff0bd54,#fff0bd23_42%,transparent)]",
  "[--lux-checker-light-hi:#fff0cb] [--lux-checker-light-mid:#f2d6a6] [--lux-checker-light-low:#d7ad76] [--lux-checker-light-deep:#a87a46] [--lux-checker-light-border:#d8ae7b]",
  "[--lux-checker-dark-hi:#684732] [--lux-checker-dark-mid:#4d3121] [--lux-checker-dark-low:#342217] [--lux-checker-dark-deep:#21150f] [--lux-checker-dark-border:#825b3b]",
  "[--lux-die-dark-hi:#67472f] [--lux-die-dark-low:#271a13] [--lux-die-pip-light:#fff4d9] [--lux-die-pip-dark:#2b1b10]",
  "[--lux-panel-bg:linear-gradient(145deg,#251d17,#100d0b)] [--ui-accent:#dfaf63] [--ui-accent-hover:#f0ca87] [--ui-accent-soft:#dfaf6329] [--ui-accent-faint:#dfaf6314] [--ui-accent-border:#d2a167a8] [--ui-accent-glow:#dfaf6333] [--ui-on-accent:#24180f]",
  "[--board-primary-surface:linear-gradient(155deg,#f4dba4,#d9aa64_64%,#bd8448)] [--ui-secondary-bg:#2b2118] [--ui-secondary-border:#906c49] [--ui-menu-bg:#241b14] [--ui-bar-overlay:none]",
  "[--ui-cube-bg:linear-gradient(145deg,#f4dfac,#c49052)] [--ui-cube-text:#472811] [--board-bearoff-count-bg:#23190f] [--board-bearoff-count-text:#f2d7a4]",
  "[--board-meter-bg:#211810] [--board-meter-border:#b6834a96] [--board-meter-text:#f5d8a5]",
  "[--lux-case-glow-top:#fff1d216] [--lux-case-glow-side:#f6d3a40c] [--lux-case-shadow-bottom:#00000055] [--lux-inner-border:#110a08a6] [--lux-rivet:transparent] [--lux-rivet-soft:transparent]",
].join(" ");

export const boardThemeClasses: Record<BoardTheme, string> = {
  brownGold: `${brownGoldClasses} ${boardLayoutClasses} ${boardLeatherClasses}`,
  charcoalGold: `${charcoalGoldClasses} ${boardLayoutClasses} ${boardLeatherClasses}`,
  redGreen: `${styles.defaultTheme} ${styles.themeRedGreen} ${boardLayoutClasses} ${boardLeatherClasses}`,
  blueIvory: `${styles.defaultTheme} ${styles.themeBlueIvory} ${boardLayoutClasses} ${boardLeatherClasses}`,
  ivoryGold: `${styles.defaultTheme} ${styles.themeIvoryGold} ${boardLayoutClasses} ${boardLeatherClasses}`,
  classicBrown: `${classicClasses} [&_[data-testid=board-inner-frame]]:[background:var(--lux-rail-bg)] [--lux-case-bg:#382016] [--lux-rail-bg:#382016] [--lux-board-area-bg:#382016] [--lux-field-bg:#76513a] [--lux-bar-bg:#382016] [--lux-bearoff-bg:#382016] [--lux-center-belt:#76513a] [--lux-point-light-a:#bc844b] [--lux-point-light-b:#bc844b] [--lux-point-dark-a:#4b3023] [--lux-point-dark-b:#4b3023] ${boardLayoutClasses} ${boardLeatherClasses}`,
  classicLight: `${classicClasses} [&_[data-testid=board-inner-frame]]:[background:var(--lux-rail-bg)] [--lux-case-bg:#d8c9a9] [--lux-rail-bg:#d8c9a9] [--lux-board-area-bg:#d8c9a9] [--lux-field-bg:#ede8d7] [--lux-bar-bg:#d8c9a9] [--lux-bearoff-bg:#d8c9a9] [--lux-center-belt:#ede8d7] [--lux-point-light-a:#b82e38] [--lux-point-light-b:#b82e38] [--lux-point-dark-a:#191c20] [--lux-point-dark-b:#191c20] ${boardLayoutClasses} ${boardLeatherClasses}`,
};
