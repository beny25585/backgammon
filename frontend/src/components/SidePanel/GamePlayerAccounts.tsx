import { useI18n } from "../../i18n/I18nProvider";
import { useRoomPlayerDetails } from "../../hooks/useRoomPlayerDetails";
import { useGame } from "../../services/gameContext";
import PlayerMetrics from "../PlayerRow/PlayerMetrics";

/** Account data is loaded once in the settings panel, outside the playing rail. */
export default function GamePlayerAccounts() {
  const { t, direction } = useI18n();
  const { roomId, playerColor, whiteName, blackName } = useGame();
  const details = useRoomPlayerDetails(roomId);
  if (!roomId) return null;

  const opponentColor = playerColor === "white" ? "black" : "white";
  const names = { white: whiteName, black: blackName };

  return (
    <div className="grid gap-2 [container-type:inline-size]" dir={direction} data-testid="game-player-accounts">
      {details.loading && <p role="status" className="py-2 text-center text-xs text-white/65">{t("game.loadingPlayerDetails")}</p>}
      {([opponentColor, playerColor] as const).map(color => {
        const account = details.players?.[color];
        if (!account) return null;
        const label = names[color] || t(color === playerColor ? "common.you" : "common.opponent");
        return (
          <div key={color} className="grid min-w-0 gap-1.5 rounded-xl border border-white/15 bg-white/[0.025] px-2 py-2" data-player={color === playerColor ? "self" : "opponent"}>
            <bdi className="block truncate text-center text-xs font-semibold text-white/80" title={label}>{label}</bdi>
            <PlayerMetrics details={account} color={color} />
          </div>
        );
      })}
      {details.unavailable && (
        <button type="button" onClick={details.retry} className="min-h-11 rounded-lg border border-amber-200/25 px-2 py-2 text-xs text-amber-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
          {t("game.retryPlayerDetails")}
        </button>
      )}
    </div>
  );
}
