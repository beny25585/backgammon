import { memo, useState, type ReactNode } from "react";
import type { GameState, Color } from "@/lib/backgammon/engine";
import PlayerRow from "../PlayerRow";
import Clock from "../Clock";
import { useGame } from "../../services/gameContext";
import { activePlayerOf, type TimeControl } from "../../lib/clock";
import { useI18n } from "../../i18n/I18nProvider";
import { useRoomPlayerDetails } from "../../hooks/useRoomPlayerDetails";
import GameInfoCard from "./GameInfoCard";
import PlayerReactionPicker from "../PlayerReactions/PlayerReactionPicker";

interface SidePanelProps {
  state: GameState;
  playerColor: Color;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: TimeControl | null;
  settingsToggle?: ReactNode;
}

function SidePanel({ state, playerColor, clock, turnStartedAt, timeControl, settingsToggle }: SidePanelProps) {
  const { t } = useI18n();
  const { whiteName, blackName, matchScore, targetPoints, roomId,
    supportsPlayerReactions = false, playerReactionsEnabled = false, playerReactions,
    sendReaction, reactionCooldownUntil = 0, reactionError = null } = useGame();
  const scope = `${roomId}:${playerColor}`;
  const [muteState, setMuteState] = useState<{ scope: string; muted: boolean; ignoredId?: string }>({ scope, muted: false });
  const muted = muteState.scope === scope && muteState.muted;
  const details = useRoomPlayerDetails(roomId);
  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentReaction = playerReactions?.[opponentColor];
  const visibleOpponentReaction = muted || (muteState.scope === scope && muteState.ignoredId === opponentReaction?.id)
    ? undefined : opponentReaction;
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel = opponentName || t(playerColor === "white" ? "common.blackPlayer" : "common.whitePlayer");
  const selfLabel = selfName || `${t("common.you")} (${t(playerColor === "white" ? "common.white" : "common.black")})`;
  const activeColor = activePlayerOf(state);

  return (
    <div className="col-start-1 row-span-2 row-start-2 grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(min-content,1fr)_auto_auto] gap-1.5 overflow-y-auto overscroll-contain border-r border-[#c8a66a]/30 bg-linear-to-br from-[#111516] to-[#080c0d] px-[clamp(5px,1.7cqw,27px)] pt-[clamp(8px,2.5cqh,24px)] pb-[clamp(6px,4cqh,40px)] [container-type:inline-size] [scrollbar-color:#8d754a_#0c1011] [scrollbar-width:thin] @max-[620px]/game-layout:row-span-1 [@container_game-layout_(height<500px)]:gap-0.5 [@container_game-layout_(height<500px)]:px-1 [@container_game-layout_(height<500px)]:pt-1 [@container_game-layout_(height<500px)]:pb-1" data-testid="side-panel">
      <div className="col-start-1 row-start-1 min-w-0" data-testid="player-details-column">
        <PlayerRow color={opponentColor} state={state} label={opponentLabel}
          active={activeColor === opponentColor} self={false}
          showReactionSlot={supportsPlayerReactions} reaction={visibleOpponentReaction}
          score={matchScore?.[opponentColor] ?? 0} details={details.players?.[opponentColor]} />
      </div>
        <div className={`col-start-1 row-start-3 min-w-0 self-center py-2 [@container_game-layout_(height<500px)]:py-0 ${timeControl?.delay ? "[@container_game-layout_(height<500px)]:mb-7" : ""}`}>
          {settingsToggle && <div className="mb-2 [@container_game-layout_(height<500px)]:mb-1">{settingsToggle}</div>}
          <GameInfoCard state={state} targetPoints={targetPoints}
            leadingScore={Math.max(matchScore?.white ?? 0, matchScore?.black ?? 0)} />
          {details.loading && <span role="status" className="sr-only">{t("game.loadingPlayerDetails")}</span>}
          {details.unavailable && (
            <button type="button" onClick={details.retry} className="min-h-11 w-full rounded px-1 text-[clamp(10px,5cqw,13px)] text-amber-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-300">
              {t("game.retryPlayerDetails")}
            </button>
          )}
        </div>
      <div className="col-start-1 row-start-4 min-w-0">
        <PlayerRow color={playerColor} state={state} label={selfLabel}
          active={activeColor === playerColor} self
          showReactionSlot={supportsPlayerReactions} reaction={playerReactions?.[playerColor]}
          score={matchScore?.[playerColor] ?? 0} details={details.players?.[playerColor]} />
        {supportsPlayerReactions && sendReaction && <PlayerReactionPicker
          key={scope}
          enabled={playerReactionsEnabled}
          cooldownUntil={reactionCooldownUntil}
          error={reactionError}
          muted={muted}
          onToggleMuted={() => setMuteState({ scope, muted: !muted, ignoredId: opponentReaction?.id })}
          onSend={sendReaction}
        />}
      </div>
      <Clock clock={clock} activeColor={activeColor} myColor={playerColor}
        myLabel={selfName || t("common.you")} oppLabel={opponentName || t("common.opponent")}
        delayMs={timeControl?.delay ?? 0} turnStartedAt={turnStartedAt} layout="rail" />
    </div>
  );
}

export default memo(SidePanel);
