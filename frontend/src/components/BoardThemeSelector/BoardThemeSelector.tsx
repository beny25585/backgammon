import { useI18n } from "../../i18n/I18nProvider";
import { BOARD_THEMES, type BoardTheme } from "./boardThemes";

const themeSwatches: Record<BoardTheme, string> = {
  redGreen: "[&>span:nth-child(1)]:bg-[#6f1722] [&>span:nth-child(2)]:bg-[#0f584b] [&>span:nth-child(3)]:bg-[#e2c27e]",
  blueIvory: "[&>span:nth-child(1)]:bg-[#0b406e] [&>span:nth-child(2)]:bg-[#f5ead0] [&>span:nth-child(3)]:bg-[#c9a65b]",
  ivoryGold: "[&>span:nth-child(1)]:bg-[#e9d39d] [&>span:nth-child(2)]:bg-[#c6c2b4] [&>span:nth-child(3)]:bg-[#d6a846]",
  classicBrown: "[&>span:nth-child(1)]:bg-[#76513a] [&>span:nth-child(2)]:bg-[#bc844b] [&>span:nth-child(3)]:bg-[#111111]",
  classicLight: "[&>span:nth-child(1)]:bg-[#ede8d7] [&>span:nth-child(2)]:bg-[#b82e38] [&>span:nth-child(3)]:bg-[#191c20]",
};

const themeLabelKeys: Record<BoardTheme, string> = {
  redGreen: "game.boardThemeRedGreen",
  blueIvory: "game.boardThemeBlueIvory",
  ivoryGold: "game.boardThemeIvoryGold",
  classicBrown: "game.boardThemeClassicBrown",
  classicLight: "game.boardThemeClassicLight",
};

const themeDescriptionKeys: Record<BoardTheme, string> = {
  redGreen: "game.boardThemeRedGreenText",
  blueIvory: "game.boardThemeBlueIvoryText",
  ivoryGold: "game.boardThemeIvoryGoldText",
  classicBrown: "game.boardThemeClassicBrownText",
  classicLight: "game.boardThemeClassicLightText",
};

interface BoardThemeSelectorProps {
  value: BoardTheme;
  onChange: (theme: BoardTheme) => void;
}

export default function BoardThemeSelector({
  value,
  onChange,
}: BoardThemeSelectorProps) {
  const { t } = useI18n();

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
