import { memo } from "react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import PlayerScore from "../PlayerRow/PlayerScore";
import Clock from "../Clock";
import { useGame } from "../../services/gameContext";
import { activePlayerOf, type TimeControl } from "../../lib/clock";
import { useI18n } from "../../i18n/I18nProvider";
import { useRoomPlayerDetails } from "../../hooks/useRoomPlayerDetails";
import GameInfoCard from "./GameInfoCard";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: TimeControl | null;
}

function SidePanel({ state, playerColor, clock, turnStartedAt, timeControl }: SidePanelProps) {
  const { t } = useI18n();
  const { whiteName, blackName, matchScore, targetPoints, roomId } = useGame();
  const details = useRoomPlayerDetails(roomId);
  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel = opponentName || t(playerColor === "white" ? "common.blackPlayer" : "common.whitePlayer");
  const selfLabel = selfName || `${t("common.you")} (${t(playerColor === "white" ? "common.white" : "common.black")})`;
  const activeColor = activePlayerOf(state);

  return (
    <div className="col-span-2 col-start-1 row-start-1 grid min-h-0 min-w-0 grid-cols-subgrid bg-[#090d0e]" data-testid="side-panel">
      <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] items-center gap-1 overflow-y-auto px-1 py-2 [container-type:inline-size] [scrollbar-width:thin]" data-testid="player-details-column">
        <PlayerRow color={opponentColor} state={state} label={opponentLabel}
          active={activeColor === opponentColor} self={false} showScore={false}
          details={details.players?.[opponentColor]} />
        <div className="min-w-0 py-1">
          <GameInfoCard state={state} targetPoints={targetPoints} />
          {details.loading && <span role="status" className="sr-only">{t("game.loadingPlayerDetails")}</span>}
          {details.unavailable && (
            <button type="button" onClick={details.retry} className="min-h-11 w-full rounded px-1 text-[clamp(10px,5cqw,13px)] text-amber-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-300">
              {t("game.retryPlayerDetails")}
            </button>
          )}
        </div>
        <PlayerRow color={playerColor} state={state} label={selfLabel}
          active={activeColor === playerColor} self showScore={false}
          details={details.players?.[playerColor]} />
      </div>
      <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] items-center gap-1 overflow-y-auto border-l border-white/10 px-0.5 py-3 [container-type:inline-size] [scrollbar-width:thin]" data-testid="score-clock-column">
        <PlayerScore color={opponentColor} label={opponentLabel} score={matchScore?.[opponentColor] ?? 0} />
        <div className="min-w-0 [&>div:first-child]:flex-col">
          <Clock clock={clock} activeColor={activeColor} myColor={playerColor}
            myLabel={selfName || t("common.you")} oppLabel={opponentName || t("common.opponent")}
            delayMs={timeControl?.delay ?? 0} turnStartedAt={turnStartedAt} />
        </div>
        <PlayerScore color={playerColor} label={selfLabel} score={matchScore?.[playerColor] ?? 0} />
      </div>
    </div>
  );
}

export default memo(SidePanel);
