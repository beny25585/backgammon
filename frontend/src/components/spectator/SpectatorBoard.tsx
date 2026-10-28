import { memo } from "react";
import { Board } from "../Board/Board";
import GameFrame from "../GameScreen/GameFrame";
import DiceOverlay from "../GameScreen/DiceOverlay";
import Clock from "../Clock/Clock";
import GameInfoCard from "../SidePanel/GameInfoCard";
import PlayerScore from "../PlayerRow/PlayerScore";
import styles from "../GameScreen/GameScreen.module.css";
import { activePlayerOf, parseTimeControl } from "../../lib/clock";
import type { SpectatorSnapshot } from "../../types/spectator";
import { useI18n } from "../../i18n/I18nProvider";

const noAction = () => {};
const noPoints: never[] = [];

/** Uses the existing renderer, with no player provider or gameplay callbacks. */
function SpectatorBoard({ snapshot }: { snapshot: SpectatorSnapshot }) {
  const { t, direction } = useI18n();
  const { state, meta } = snapshot;
  const active = activePlayerOf(state);
  const names = {
    white: meta.whiteName || t("common.whitePlayer"),
    black: meta.blackName || t("common.blackPlayer"),
  };
  const timeControl = parseTimeControl(meta.timeControl, meta.targetPoints);
  const opening = state.phase === "opening_roll" || state.phase === "opening_result";
  const rollDetails = opening ? {
    left: state.openingRoll.black != null ? <DiceOverlay dice={[state.openingRoll.black]} remaining={[state.openingRoll.black]} color="black" playerColor="white" /> : undefined,
    right: state.openingRoll.white != null ? <DiceOverlay dice={[state.openingRoll.white]} remaining={[state.openingRoll.white]} color="white" playerColor="white" /> : undefined,
  } : state.phase === "moving" && state.dice.length ? {
    [state.turn === "white" ? "right" : "left"]: <DiceOverlay dice={state.dice} remaining={state.remaining} color={state.turn} playerColor="white" />,
  } : undefined;

  return (
    <GameFrame>
      <aside dir={direction} aria-label={t("spectator.players")}
        className="col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col justify-between gap-2 overflow-y-auto border-r border-[#c8a66a]/30 bg-[#0c1011] px-2 py-3 [container-type:inline-size] [@container_game-layout_(height<500px)]:gap-1 [@container_game-layout_(height<500px)]:py-1">
        {(["black", "white"] as const).map(color => (
          <section key={color} data-testid={`spectator-player-${color}`} data-active={active === color}
            className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/3 px-1 py-2 text-center data-[active=true]:border-[#dfbc7c] [@container_game-layout_(height<500px)]:py-1">
            <span className="text-[clamp(10px,8cqw,13px)] text-[#b7aa92]">{t(`common.${color}`)}</span>
            <bdi className="w-full truncate text-[clamp(11px,12cqw,20px)] font-semibold" title={names[color]}>{names[color]}</bdi>
            <PlayerScore color={color} label={names[color]} score={meta.matchScore[color]} />
          </section>
        ))}
        <GameInfoCard state={state} targetPoints={meta.targetPoints} leadingScore={Math.max(meta.matchScore.white, meta.matchScore.black)} />
        {timeControl && <Clock clock={state.clock} activeColor={active} myColor="white" myLabel={names.white}
          oppLabel={names.black} delayMs={timeControl.delay} turnStartedAt={state.turnStartedAt} layout="stacked" />}
      </aside>
      <div className={`${styles.boardArea} col-start-2 row-start-2`} data-testid="spectator-board">
        <Board state={state} myColor={null} inputDisabled selected={null} legalTargets={noPoints}
          legalFromPoints={noPoints} onSelect={noAction} onMove={noAction} rollDetails={rollDetails}
          overlay={state.phase === "doubling_offered" && state.doubleOfferedBy ? (
            <div className="pointer-events-none col-span-full self-center justify-self-center rounded-lg border border-[#dfbc7c]/40 bg-black/90 px-3 py-2 text-center text-sm text-[#f0ce85]" role="status">
              {t("spectator.doubleOffered", { player: names[state.doubleOfferedBy] })}
            </div>
          ) : undefined} />
      </div>
    </GameFrame>
  );
}

export default memo(SpectatorBoard);
