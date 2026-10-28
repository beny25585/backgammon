import { useI18n } from "../../i18n/I18nProvider";
import { BOARD_THEMES, type BoardTheme } from "./boardThemes";

const themeSwatches: Record<BoardTheme, string> = {
  charcoalGold: "[&>span:nth-child(1)]:bg-[#bf984e] [&>span:nth-child(2)]:bg-[#151919] [&>span:nth-child(3)]:bg-[#f0e2bd]",
  redGreen: "[&>span:nth-child(1)]:bg-[#6f1722] [&>span:nth-child(2)]:bg-[#0f584b] [&>span:nth-child(3)]:bg-[#e2c27e]",
  blueIvory: "[&>span:nth-child(1)]:bg-[#0b406e] [&>span:nth-child(2)]:bg-[#f5ead0] [&>span:nth-child(3)]:bg-[#c9a65b]",
  ivoryGold: "[&>span:nth-child(1)]:bg-[#e9d39d] [&>span:nth-child(2)]:bg-[#c6c2b4] [&>span:nth-child(3)]:bg-[#d6a846]",
  classicBrown: "[&>span:nth-child(1)]:bg-[#76513a] [&>span:nth-child(2)]:bg-[#bc844b] [&>span:nth-child(3)]:bg-[#111111]",
  classicLight: "[&>span:nth-child(1)]:bg-[#ede8d7] [&>span:nth-child(2)]:bg-[#b82e38] [&>span:nth-child(3)]:bg-[#191c20]",
};

const themeLabelKeys: Record<BoardTheme, string> = {
  charcoalGold: "game.boardThemeCharcoalGold",
  redGreen: "game.boardThemeRedGreen",
  blueIvory: "game.boardThemeBlueIvory",
  ivoryGold: "game.boardThemeIvoryGold",
  classicBrown: "game.boardThemeClassicBrown",
  classicLight: "game.boardThemeClassicLight",
};

const themeDescriptionKeys: Record<BoardTheme, string> = {
  charcoalGold: "game.boardThemeCharcoalGoldText",
  redGreen: "game.boardThemeRedGreenText",
  blueIvory: "game.boardThemeBlueIvoryText",
  ivoryGold: "game.boardThemeIvoryGoldText",
  classicBrown: "game.boardThemeClassicBrownText",
  classicLight: "game.boardThemeClassicLightText",
};

interface BoardThemeSelectorProps {
  value: BoardTheme;
  onChange: (theme: BoardTheme) => void;
  compact?: boolean;
}

export default function BoardThemeSelector({
  value,
  onChange,
  compact = false,
}: BoardThemeSelectorProps) {
  const { t, direction } = useI18n();

  if (compact) {
    return (
      <label className="relative grid min-h-[clamp(64px,9.6cqh,95px)] min-w-0 gap-[clamp(4px,0.8cqh,8px)] rounded-[10px] border border-white/15 bg-[#101515] px-3 py-[clamp(6px,1.2cqh,12px)] text-left text-[clamp(13px,1.05cqw,16px)] font-normal leading-tight text-white/90 hover:border-amber-200/35 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-amber-300" dir="ltr">
        <span dir={direction}>{t("game.boardTheme")}</span>
        <span aria-hidden="true" className={`grid h-[clamp(24px,4cqh,40px)] w-[clamp(48px,5cqw,80px)] grid-cols-3 overflow-hidden rounded border border-amber-200/65 bg-[#151919] ${themeSwatches[value]}`}>
          <span className="[clip-path:polygon(0_0,100%_0,50%_100%)]" />
          <span className="rotate-180 [clip-path:polygon(0_0,100%_0,50%_100%)]" />
          <span className="[clip-path:polygon(0_0,100%_0,50%_100%)]" />
        </span>
        <select
          className="absolute inset-0 size-full cursor-pointer appearance-none rounded-[10px] bg-transparent text-transparent focus:outline-none [&>option]:bg-[#101515] [&>option]:text-white"
          value={value}
          dir={direction}
          title={t(themeLabelKeys[value])}
          onChange={(event) => onChange(event.target.value as BoardTheme)}
        >
          {BOARD_THEMES.map((theme) => (
            <option key={theme} value={theme}>{t(themeLabelKeys[theme])}</option>
          ))}
        </select>
        <svg className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-[#ebc879]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </label>
    );
  }

  return (
    <section className="grid gap-2" aria-label={t("game.boardTheme")}>
      <div className="px-1 text-xs font-semibold text-white/55">
        <span>{t("game.boardTheme")}</span>
      </div>
      <div className="grid gap-1 rounded-xl bg-white/[0.025] p-1">
        {BOARD_THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            className="grid min-h-12 grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-start text-white/80 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 aria-pressed:border-amber-300/40 aria-pressed:bg-amber-300/10 aria-pressed:text-amber-100"
            aria-pressed={value === theme}
            onClick={() => onChange(theme)}
          >
            <span aria-hidden="true" className={`grid h-7 grid-cols-3 overflow-hidden rounded-md border border-white/15 ${themeSwatches[theme]}`}>
              <span />
              <span />
              <span />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <strong className="text-sm leading-snug font-semibold">{t(themeLabelKeys[theme])}</strong>
              <small className="text-xs leading-snug text-white/45 [@media(max-height:500px)]:hidden">{t(themeDescriptionKeys[theme])}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
