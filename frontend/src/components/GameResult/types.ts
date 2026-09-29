import type { Color } from "../../lib/backgammon/engine";

export interface CommonGameResultProps {
  roomId?: string;

  winner: Color;
  whiteScore: number;
  blackScore: number;

  whiteName?: string | null;
  blackName?: string | null;
  playerColor?: Color;

  winType?: string | null;
  reason?: string;

  ratingBefore?: number | null;
  ratingAfter?: number | null;
  opponentRatingBefore?: number | null;
  opponentRatingAfter?: number | null;
  ratingChange?: number | null;
  opponentRatingChange?: number | null;

  hits?: number | null;
  durationSeconds?: number | null;

  coinsDelta?: number | null;
  opponentCoinsDelta?: number | null;

  onClose: () => void;
}

export interface RematchGameResultProps extends CommonGameResultProps {
  onRematch: () => void;
  rematchPending?: boolean;
  onCancelRematch?: () => void;
}
