import { memo, type ReactNode } from "react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import Clock from "../Clock";
import { useGame } from "../../services/gameContext";
import { activePlayerOf, type TimeControl } from "../../lib/clock";
import { useI18n } from "../../i18n/I18nProvider";
import GameInfoCard from "./GameInfoCard";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: TimeControl | null;
  settingsToggle?: ReactNode;
  reactionPicker?: ReactNode;
}

function SidePanel({ state, playerColor, clock, turnStartedAt, timeControl, settingsToggle, reactionPicker }: SidePanelProps) {
  const { t } = useI18n();
  const { whiteName, blackName, matchScore, targetPoints } = useGame();
  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel = opponentName || t(playerColor === "white" ? "common.blackPlayer" : "common.whitePlayer");
  const selfLabel = selfName || `${t("common.you")} (${t(playerColor === "white" ? "common.white" : "common.black")})`;
  const activeColor = activePlayerOf(state);

  return (
    <div className="col-start-1 row-start-2 grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(min-content,1fr)_auto_auto] gap-1.5 overflow-y-auto overscroll-contain border-r border-[#c8a66a]/30 bg-linear-to-br from-[#111516] to-[#080c0d] px-[clamp(5px,1.7cqw,27px)] pt-[clamp(8px,2.5cqh,24px)] pb-[clamp(6px,4cqh,40px)] [container-type:inline-size] [scrollbar-color:#8d754a_#0c1011] [scrollbar-width:thin] [@container_game-frame_(height<700px)]:gap-px [@container_game-frame_(height<700px)]:px-1 [@container_game-frame_(height<700px)]:pt-1 [@container_game-frame_(height<700px)]:pb-1" data-testid="side-panel">
      <div className="col-start-1 row-start-1 min-w-0" data-testid="player-details-column">
        <PlayerRow color={opponentColor} state={state} label={opponentLabel}
          active={activeColor === opponentColor} self={false}
          score={matchScore?.[opponentColor] ?? 0} />
      </div>
        <div className={`col-start-1 row-start-3 min-w-0 self-center py-2 [@container_game-frame_(height<700px)]:py-0 ${timeControl?.delay ? "mb-10 [@container_game-frame_(height<700px)]:mb-6" : ""}`}>
          {settingsToggle && <div className="mb-2 [@container_game-frame_(height<700px)]:mb-1">{settingsToggle}</div>}
          <GameInfoCard state={state} targetPoints={targetPoints} mode="summary" />
        </div>
      <div className="col-start-1 row-start-4 min-w-0">
        <PlayerRow color={playerColor} state={state} label={selfLabel}
          active={activeColor === playerColor} self
          score={matchScore?.[playerColor] ?? 0} />
        {reactionPicker}
      </div>
      <Clock clock={clock} activeColor={activeColor} myColor={playerColor}
        myLabel={selfName || t("common.you")} oppLabel={opponentName || t("common.opponent")}
        delayMs={timeControl?.delay ?? 0} turnStartedAt={turnStartedAt} layout="rail" />
    </div>
  );
}

export default memo(SidePanel);
