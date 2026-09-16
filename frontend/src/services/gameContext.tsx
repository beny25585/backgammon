/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  GameContextType,
  GameResult,
  GameType,
  NoMovesMessage,
  OpeningRollResult,
  RematchState,
  MakeMoveOptions,
} from "../types/context";
import type { GameState, Color, Move } from "../types/game";
import {
  allLegalMoves,
  applyMove,
  isTurnChoiceFreeSoFar,
  reorderDice as reorderGameDice,
  type Source,
  type Target,
} from "../lib/backgammon/engine";
import { getSocketService } from "./socket";
import { getAccessToken } from "./auth";
import { clientLogger } from "./logger";
import { clearRoom } from "./roomStorage";
import { parseTimeControl, type TimeControl } from "../lib/clock";

export const GameContext = createContext<GameContextType | undefined>(
  undefined,
);

interface GameProviderProps {
  children: ReactNode;
  roomId: string;
  playerColor: Color;
  gameType?: GameType;
  serverUrl?: string;
}

interface PendingMove {
  id: number;
  from: Source;
  to: Target;
  sentAt: number;
  origin: "manual" | "forced";
}

interface AutoConfirmRequest {
  gen: number;
  pendingId: number;
  stage: "awaiting_move_ack" | "awaiting_end_turn_ack";
}

function applyOptimisticMove(
  state: GameState,
  pending: Pick<PendingMove, "from" | "to">,
  color: Color,
): GameState | null {
  if (state.phase !== "moving" || state.turn !== color) return null;

  const matchingMoves = allLegalMoves(state, color).filter(
    (move) => move.from === pending.from && move.to === pending.to,
  );
  const move =
    state.remaining
      .map((die) => matchingMoves.find((candidate) => candidate.die === die))
      .find((candidate): candidate is Move => Boolean(candidate)) ??
    matchingMoves[0];

  return move ? applyMove(state, move, color) : null;
}

export function GameProvider({
  children,
  roomId,
  playerColor: initialColor,
  gameType: initialGameType = "1v1",
  serverUrl,
}: GameProviderProps) {
  const [state, setState] = useState<GameState | null>(null);
  const [playerColor, setPlayerColor] = useState<Color>(initialColor);
  const [whiteName, setWhiteName] = useState<string | null>(null);
  const [blackName, setBlackName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingRollResult, setOpeningRollResult] =
    useState<OpeningRollResult | null>(null);
  const [noMovesMessage, setNoMovesMessage] = useState<NoMovesMessage | null>(
    null,
  );
  const noMovesNoticeIdRef = useRef(0);
  const [reconnected, setReconnected] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [timeControl, setTimeControl] = useState<TimeControl | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [nextGameCountdown, setNextGameCountdown] = useState<number | null>(
    null,
  );
  const [rematchState, setRematchState] = useState<RematchState>({
    status: "idle",
  });
  const [matchScore, setMatchScore] = useState<Record<Color, number>>({
    white: 0,
    black: 0,
  });
  const [gameType, setGameType] = useState<GameType>(initialGameType);
  const gameTypeRef = useRef(gameType);
  const autoNextGameRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoConfirmPending, setAutoConfirmPending] = useState(false);
  const nextLocalIdRef = useRef(1);
  const lifecycleGenRef = useRef(0);
  const autoConfirmRequestRef = useRef<AutoConfirmRequest | null>(null);
  const endTurnInFlightRef = useRef(false);
  useEffect(() => {
    gameTypeRef.current = gameType;
  }, [gameType]);
  useEffect(() => {
    return () => {
      if (autoNextGameRef.current) clearTimeout(autoNextGameRef.current);
    };
  }, [roomId]);

  // Auto-confirm: clear on game end or turn change
  useEffect(() => {
    if (!state) return;
    if (state.phase === "game_over" || state.winner) {
      autoConfirmRequestRef.current = null;
      setAutoConfirmPending(false);
      endTurnInFlightRef.current = false;
      return;
    }
    if (autoConfirmRequestRef.current && state.turn !== playerColorRef.current) {
      // Turn changed (auto-pass or opponent turn) - clear without sending
      autoConfirmRequestRef.current = null;
      setAutoConfirmPending(false);
      endTurnInFlightRef.current = false;
    }
  }, [state]);

  // Backend is source of truth for quick vs 1v1 via state.gameFormat.
  // Tournament stays tournament only when URL had a real id; otherwise correct
  // a stale ?tournament=0 that was mis-classified.
  useEffect(() => {
    const fmt = (state as unknown as { gameFormat?: string } | null)
      ?.gameFormat;
    if (fmt === "money" && gameType !== "quick") setGameType("quick");
    else if (fmt === "match" && gameType === "quick") setGameType("1v1");
  }, [state, gameType]);

  const socket = getSocketService(serverUrl);
  const lastVersionRef = useRef(0);
  const stateRef = useRef(state);
  const authoritativeStateRef = useRef<GameState | null>(null);
  const pendingMovesRef = useRef<PendingMove[]>([]);
  const playerColorRef = useRef(playerColor);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  const clearAutoConfirm = useCallback(() => {
    autoConfirmRequestRef.current = null;
    setAutoConfirmPending(false);
  }, []);

  const bumpLifecycleAndClear = useCallback(() => {
    lifecycleGenRef.current += 1;
    autoConfirmRequestRef.current = null;
    setAutoConfirmPending(false);
    endTurnInFlightRef.current = false;
  }, []);

  // Lifecycle: room change / unmount clears pending auto-confirm
  useEffect(() => {
    bumpLifecycleAndClear();
    return () => {
      bumpLifecycleAndClear();
    };
  }, [roomId, bumpLifecycleAndClear]);

  const sendIntent = useCallback(
    (payload: Record<string, unknown>) => {
      const sent = socket.send("state_update", payload);
      if (!sent) setError("Connection lost. Please wait for reconnection.");
      return sent;
    },
    [socket],
  );

  const fetchFinalizedResult = useCallback(
    async function fetchFinalizedResultImpl(
      attempt = 0,
    ): Promise<void> {
      if (!roomId) {
        console.warn("[FINAL RESULT] missing roomId");
        return;
      }

      const token = getAccessToken();

      if (!token) {
        console.warn("[FINAL RESULT] missing access token");
        return;
      }

      const url = `/backgammon/api/rooms/${roomId}/result/`;

      console.log("[FINAL RESULT] request", {
        attempt,
        roomId,
        url,
      });

      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const rawBody = await res.text();

        console.log("[FINAL RESULT] response", {
          attempt,
          status: res.status,
          statusText: res.statusText,
          body: rawBody,
        });

        if (res.status === 202) {
          if (attempt < 8) {
            const delay = Math.min(500 * 2 ** attempt, 4000);

            console.log(
              `[FINAL RESULT] still processing, retrying in ${delay}ms`,
            );

            setTimeout(
              () => void fetchFinalizedResultImpl(attempt + 1),
              delay,
            );
          } else {
            console.warn("[FINAL RESULT] processing timeout");
          }

          return;
        }

        if (!res.ok) {
          console.error("[FINAL RESULT] request failed", {
            status: res.status,
            body: rawBody,
          });

          return;
        }

        let data: Record<string, unknown>;

        try {
          data = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          console.error("[FINAL RESULT] invalid JSON", rawBody);

          return;
        }

        console.log("[FINAL RESULT] parsed data", data);

        const rating = data.rating as
          | {
              self: {
                before: number;
                after: number;
                change: number;
              };
              opponent: {
                before: number;
                after: number;
                change: number;
              };
            }
          | null
          | undefined;

        const money = data.money as
          | {
              stake?: string;
              selfChange?: number;
              opponentChange?: number;
            }
          | null
          | undefined;

        const stats = data.stats as
          | {
              hits?: number | null;
              doublesOffered?: number | null;
              doublesAccepted?: number | null;
              openingRoll?: Partial<Record<Color, number>> | null;
              firstPlayer?: Color | null;
              durationSeconds?: number | null;
              clockRemaining?: Partial<Record<Color, number>> | null;
            }
          | null
          | undefined;

        const result = data.result as
          | {
              endReason?: string | null;
            }
          | null
          | undefined;

        const finalizedGameType =
          data.gameType === "quick" ||
          data.gameType === "1v1" ||
          data.gameType === "tournament"
            ? (data.gameType as GameType)
            : undefined;

        console.log("[FINAL RESULT] extracted", {
          rating,
          money,
          stats,
          result,
          finalizedGameType,
        });

        if (
          finalizedGameType ||
          rating ||
          money ||
          stats ||
          result?.endReason
        ) {
          setGameResult((prev) => {
            if (!prev) {
              console.warn(
                "[FINAL RESULT] gameResult disappeared before merge",
              );

              return prev;
            }

            const next = {
              ...prev,

              gameType: finalizedGameType ?? prev.gameType,

              reason: result?.endReason ?? prev.reason,

              /*
               * rating.self already means the current player.
               * Do not swap it according to white/black.
               */
              ratingBefore: rating?.self.before ?? prev.ratingBefore,

              ratingAfter: rating?.self.after ?? prev.ratingAfter,

              opponentRatingBefore:
                rating?.opponent.before ?? prev.opponentRatingBefore,

              opponentRatingAfter:
                rating?.opponent.after ?? prev.opponentRatingAfter,

              ratingChange: rating?.self.change ?? prev.ratingChange,

              opponentRatingChange:
                rating?.opponent.change ?? prev.opponentRatingChange,

              coinsChange: money?.selfChange ?? prev.coinsChange,

              opponentCoinsChange:
                money?.opponentChange ?? prev.opponentCoinsChange,

              stakeAmount:
                money?.stake != null ? Number(money.stake) : prev.stakeAmount,

              hits: stats?.hits ?? prev.hits,

              doublesOffered: stats?.doublesOffered ?? prev.doublesOffered,

              doublesAccepted: stats?.doublesAccepted ?? prev.doublesAccepted,

              openingRoll: stats?.openingRoll ?? prev.openingRoll,

              firstPlayer: stats?.firstPlayer ?? prev.firstPlayer,

              durationSeconds: stats?.durationSeconds ?? prev.durationSeconds,

              clockRemaining: stats?.clockRemaining ?? prev.clockRemaining,
            };

            console.log("[FINAL RESULT] merged GameResult", next);

            return next;
          });
        } else {
          console.warn(
            "[FINAL RESULT] 200 response but no enrichment data",
            data,
          );
        }
      } catch (error) {
        console.error("[FINAL RESULT] exception", error);
      }
    },
    [roomId],
  );

  useEffect(() => {
    const token = getAccessToken();

    let hasReceivedState = false;

    const connectAndSetup = async () => {
      try {
        if (!token) {
          setError("Not authenticated");
          setIsLoading(false);
          return;
        }
        // Register every handler before opening the socket. The server sends
        // the initial snapshot and may immediately replay `game_ended` for a
        // completed room, so subscribing after `connect()` can lose the final
        // score and leave this client on the previous board.
        const revealNoMoves = (
          message: Omit<NoMovesMessage, "noticeVisible">,
          revealAfterMs = 350,
        ) => {
          const noticeId = ++noMovesNoticeIdRef.current;
          setNoMovesMessage({ ...message, noticeVisible: false });
          setTimeout(() => {
            if (noMovesNoticeIdRef.current !== noticeId) return;
            setNoMovesMessage({ ...message, noticeVisible: true });
          }, revealAfterMs);
          setTimeout(() => {
            if (noMovesNoticeIdRef.current !== noticeId) return;
            setNoMovesMessage(null);
          }, revealAfterMs + 350);
        };

        socket.on("state_update", (message) => {
          const msg = message as Record<string, unknown>;
          const raw = msg.payload as Record<string, unknown>;
          const isInitial = msg.initial === true;

          const buildOpeningResult = (s: Record<string, unknown>) => {
            const openingRoll = s.openingRoll as
              | { white?: number; black?: number }
              | undefined;
            if (
              (s.phase === "opening_roll" || s.phase === "opening_result") &&
              (openingRoll?.white != null || openingRoll?.black != null)
            ) {
              setOpeningRollResult((prev) => ({
                myDie:
                  openingRoll?.[playerColorRef.current] ?? prev?.myDie ?? null,
                opponentDie:
                  openingRoll?.[
                    playerColorRef.current === "white" ? "black" : "white"
                  ] ??
                  prev?.opponentDie ??
                  null,
                winner: s.phase === "opening_result" ? (s.turn as Color) : null,
              }));
            }
          };

          // Initial message from server on connect (contains our own color).
          if (isInitial) {
            setError(null);
            clientLogger.debug("Initial state update received", {
              phase: raw.phase,
              turn: raw.turn,
              version: raw.version,
              playerColorInMsg: msg.playerColor,
            });
            if (msg.playerColor) {
              playerColorRef.current = msg.playerColor as Color;
              setPlayerColor(playerColorRef.current);
            }
            const v = typeof raw.version === "number" ? raw.version : 0;
            lastVersionRef.current = v;
            if (hasReceivedState) {
              setReconnected(true);
              setTimeout(() => setReconnected(false), 6000);
            }
            hasReceivedState = true;
            const initialState = raw as unknown as GameState;
            pendingMovesRef.current = [];
            authoritativeStateRef.current = initialState;
            stateRef.current = initialState;
            // Lifecycle: initial snapshot clears auto-confirm
            lifecycleGenRef.current += 1;
            autoConfirmRequestRef.current = null;
            setAutoConfirmPending(false);
            endTurnInFlightRef.current = false;
            setState(initialState);

            const players = (msg as Record<string, unknown>).players as
              | { white?: string | null; black?: string | null }
              | undefined;
            if (players) {
              setWhiteName(players.white ?? null);
              setBlackName(players.black ?? null);
            }

            const tc = (msg as Record<string, unknown>).timeControl;
            const targetPoints = (msg as Record<string, unknown>).targetPoints;
            if (typeof tc === "string") {
              setTimeControl(
                parseTimeControl(
                  tc,
                  typeof targetPoints === "number" ? targetPoints : 1,
                ),
              );
            }

            const score = (msg as Record<string, unknown>).matchScore as
              | { white?: unknown; black?: unknown }
              | undefined;
            if (
              typeof score?.white === "number" &&
              Number.isFinite(score.white) &&
              typeof score.black === "number" &&
              Number.isFinite(score.black)
            ) {
              setMatchScore({ white: score.white, black: score.black });
            }

            buildOpeningResult(raw);
            return;
          }

          // Authoritative broadcast: ignore stale versions, apply everything.
          const version = typeof raw.version === "number" ? raw.version : 0;
          if (version > 0 && version <= lastVersionRef.current) {
            clientLogger.warn("Stale state_update ignored", {
              version,
              last: lastVersionRef.current,
            });
            return;
          }
          if (version > 0) lastVersionRef.current = version;

          const prev = stateRef.current;
          const next = raw as unknown as GameState;
          const sourceColor = msg.playerColor as Color | undefined;
          const acknowledgedAction =
            typeof msg.action === "string" ? msg.action : undefined;

          const prevAuthoritative = authoritativeStateRef.current;
          const pendingSnapshotIds = pendingMovesRef.current.map((p) => p.id);
          const autoReqBefore = autoConfirmRequestRef.current ? { ...autoConfirmRequestRef.current } : null;

          const isRealProgression = (
            prevAuth: GameState | null,
            nxt: GameState,
            pend: PendingMove,
            color: Color,
          ): boolean => {
            if (!prevAuth) return false;
            const expected = applyOptimisticMove(prevAuth, pend, color);
            if (!expected) return false;
            if (expected.phase !== nxt.phase) return false;
            if (expected.turn !== nxt.turn) return false;
            if (expected.winner !== nxt.winner) return false;
            if (expected.winType !== nxt.winType) return false;
            if (expected.points.length !== nxt.points.length) return false;
            for (let i = 0; i < expected.points.length; i++) {
              if (expected.points[i] !== nxt.points[i]) return false;
            }
            if (expected.bar.white !== nxt.bar.white) return false;
            if (expected.bar.black !== nxt.bar.black) return false;
            if (expected.home.white !== nxt.home.white) return false;
            if (expected.home.black !== nxt.home.black) return false;
            const expDice = [...expected.dice].sort((a, b) => a - b);
            const nxtDice = [...nxt.dice].sort((a, b) => a - b);
            if (expDice.length !== nxtDice.length) return false;
            for (let i = 0; i < expDice.length; i++) {
              if (expDice[i] !== nxtDice[i]) return false;
            }
            const expRem = [...expected.remaining].sort((a, b) => a - b);
            const nxtRem = [...nxt.remaining].sort((a, b) => a - b);
            if (expRem.length !== nxtRem.length) return false;
            for (let i = 0; i < expRem.length; i++) {
              if (expRem[i] !== nxtRem[i]) return false;
            }
            const expLast = expected.lastMove;
            const nxtLast = nxt.lastMove;
            if (expLast === null && nxtLast === null) {
              // no lastMove on either, continue
            } else {
              if (!expLast || !nxtLast) return false;
              if (expLast.length !== nxtLast.length) return false;
              for (let i = 0; i < expLast.length; i++) {
                if (expLast[i].from !== nxtLast[i].from || expLast[i].to !== nxtLast[i].to) return false;
              }
            }
            if (expected.moveHistory && nxt.moveHistory) {
              if (expected.moveHistory.length !== nxt.moveHistory.length) return false;
            } else if ((expected.moveHistory === null) !== (nxt.moveHistory === null)) {
              // allow null vs null, but mismatch in presence without length check handled above
            }
            return true;
          };

          if (
            sourceColor === playerColorRef.current &&
            pendingMovesRef.current.length > 0
          ) {
            const pending = pendingMovesRef.current[0];
            const acknowledgesMove =
              acknowledgedAction === "move" ||
              (acknowledgedAction === undefined &&
                isRealProgression(prevAuthoritative, next, pending, playerColorRef.current));
            if (acknowledgesMove) {
              pendingMovesRef.current.shift();
              clientLogger.debug("[move] server acknowledgement", {
                latencyMs: Math.round(performance.now() - pending.sentAt),
                version,
              });
            }
          }

          const pendingAfterAckIds = pendingMovesRef.current.map((p) => p.id);

          authoritativeStateRef.current = next;
          let displayedState = next;
          const replayedMoves: PendingMove[] = [];
          for (const pending of pendingMovesRef.current) {
            const replayed = applyOptimisticMove(
              displayedState,
              pending,
              playerColorRef.current,
            );
            if (!replayed) break;
            replayedMoves.push(pending);
            displayedState = replayed;
          }
          const hadDiscard = pendingMovesRef.current.length !== replayedMoves.length;
          pendingMovesRef.current = replayedMoves;
          const pendingAfterReplayIds = replayedMoves.map((p) => p.id);

          // Auto-confirm: two stages
          const req = autoReqBefore;
          if (req) {
            if (req.gen !== lifecycleGenRef.current) {
              autoConfirmRequestRef.current = null;
              setAutoConfirmPending(false);
            } else if (req.stage === "awaiting_move_ack") {
              const wasAcknowledged =
                pendingSnapshotIds.includes(req.pendingId) &&
                !pendingAfterAckIds.includes(req.pendingId);
              const wasDiscarded =
                pendingAfterAckIds.includes(req.pendingId) &&
                !pendingAfterReplayIds.includes(req.pendingId);
              const isCurrentRequest =
                autoConfirmRequestRef.current?.gen === req.gen &&
                autoConfirmRequestRef.current?.pendingId === req.pendingId &&
                autoConfirmRequestRef.current?.stage === "awaiting_move_ack";
              if (!isCurrentRequest) {
                // newer request superseded this one, do not touch
              } else if (hadDiscard || wasDiscarded) {
                autoConfirmRequestRef.current = null;
                setAutoConfirmPending(false);
                endTurnInFlightRef.current = false;
              } else if (wasAcknowledged) {
                if (pendingMovesRef.current.length === 0) {
                  const isMoving = next.phase === "moving";
                  const isOurTurn = next.turn === playerColorRef.current;
                  const noWinner = !next.winner;
                  const noLegal = allLegalMoves(next, playerColorRef.current).length === 0;
                  if (isMoving && isOurTurn && noWinner && noLegal && !endTurnInFlightRef.current) {
                    autoConfirmRequestRef.current = {
                      gen: req.gen,
                      pendingId: req.pendingId,
                      stage: "awaiting_end_turn_ack",
                    };
                    endTurnInFlightRef.current = true;
                    const sent = socket.send("state_update", { action: "end_turn" });
                    if (!sent) {
                      endTurnInFlightRef.current = false;
                      if (
                        autoConfirmRequestRef.current?.gen === req.gen &&
                        autoConfirmRequestRef.current?.pendingId === req.pendingId
                      ) {
                        autoConfirmRequestRef.current = null;
                        setAutoConfirmPending(false);
                      }
                      setError("Connection lost. Please wait for reconnection.");
                    }
                  } else {
                    // Not eligible for automatic completion (legal moves remain, turn passed, game over, not moving) – retire matching request
                    autoConfirmRequestRef.current = null;
                    setAutoConfirmPending(false);
                    endTurnInFlightRef.current = false;
                  }
                } else {
                  // Doubles: still pending, keep awaiting_move_ack
                }
              } else {
                const stillPending = pendingAfterReplayIds.includes(req.pendingId);
                if (!wasAcknowledged && !stillPending && !pendingSnapshotIds.includes(req.pendingId)) {
                  autoConfirmRequestRef.current = null;
                  setAutoConfirmPending(false);
                }
              }
            } else if (req.stage === "awaiting_end_turn_ack") {
              // Keep pending UI locked, do not send again, do not clear on pendingId absence
              // Will be cleared on end_turn ack, turn change, game over, or lifecycle bump
            }
          }
          // Clear in-flight on authoritative turn transition even without request (manual end_turn)
          if (endTurnInFlightRef.current) {
            if (
              next.phase === "game_over" ||
              next.winner ||
              next.turn !== playerColorRef.current
            ) {
              endTurnInFlightRef.current = false;
              if (autoConfirmRequestRef.current?.stage === "awaiting_end_turn_ack") {
                autoConfirmRequestRef.current = null;
                setAutoConfirmPending(false);
              }
            }
          }
          if (acknowledgedAction === "end_turn" && endTurnInFlightRef.current) {
            endTurnInFlightRef.current = false;
            autoConfirmRequestRef.current = null;
            setAutoConfirmPending(false);
          }
          // Also handle action-less end_turn response (no action field but turn switched)
          if (
            endTurnInFlightRef.current &&
            autoConfirmRequestRef.current?.stage === "awaiting_end_turn_ack" &&
            next.turn !== playerColorRef.current &&
            next.phase === "rolling"
          ) {
            endTurnInFlightRef.current = false;
            autoConfirmRequestRef.current = null;
            setAutoConfirmPending(false);
          }

          // Server auto-pass: we rolled, but no legal moves existed. Show the
          // "No moves available" overlay briefly with the rolled dice.
          if (
            prev &&
            prev.phase === "rolling" &&
            prev.turn !== next.turn &&
            next.phase === "rolling" &&
            (next.dice?.length ?? 0) > 0 &&
            (next.remaining?.length ?? 0) === 0 &&
            next.message === "No legal moves"
          ) {
            const rolledBy = prev.turn;
            const rolledRemaining =
              next.dice[0] === next.dice[1]
                ? [next.dice[0], next.dice[0], next.dice[0], next.dice[0]]
                : [...next.dice];
            revealNoMoves({
              dice: next.dice,
              remaining: rolledRemaining,
              color: rolledBy,
            });
          }

          stateRef.current = displayedState;
          setState(displayedState);
          buildOpeningResult(raw);
          clientLogger.debug("[state_update] received", {
            phase: next.phase,
            turn: next.turn,
            dice: next.dice,
            remaining: next.remaining,
            myColor: playerColorRef.current,
          });
          // Server auto-started the next game of the match: a fresh opening
          // arrives after the countdown, so dismiss the previous result.
          if (next.phase !== "game_over") {
            setGameResult(null);
            setNextGameCountdown(null);
          }
        });

        socket.on("player_joined", (_message) => {
          const payload = (_message as Record<string, unknown>).payload as
            | { playerColor?: Color }
            | undefined;
          setIsLoading(false);
          if (payload?.playerColor !== playerColorRef.current) {
            setOpponentConnected(true);
          }
        });

        socket.on("player_disconnected", (_message) => {
          const payload = (_message as Record<string, unknown>).payload as
            | { playerColor?: Color }
            | undefined;
          if (payload?.playerColor !== playerColorRef.current) {
            setOpponentConnected(false);
          }
        });

        socket.on("room_status", (_message) => {
          const data = (_message as Record<string, unknown>).payload as {
            connected: number;
            connectedColors?: Color[];
          };
          const opponent =
            playerColorRef.current === "white" ? "black" : "white";
          if (Array.isArray(data.connectedColors)) {
            setOpponentConnected(data.connectedColors.includes(opponent));
            return;
          }
          setOpponentConnected(data.connected >= 2);
        });

        socket.on("error", (message) => {
          const m = message as Record<string, unknown>;
          const payload = m.payload as
            | string
            | Record<string, unknown>
            | undefined;
          const rawMsg =
            typeof payload === "string"
              ? payload
              : typeof m.message === "string"
                ? m.message
                : (payload as Record<string, unknown> | undefined)?.message;
          const msg = typeof rawMsg === "string" ? rawMsg : undefined;
          if (!msg) return;
          const failedAction =
            typeof m.action === "string"
              ? m.action
              : typeof payload === "object" &&
                  payload !== null &&
                  typeof payload.action === "string"
                ? payload.action
                : undefined;
          if (failedAction === "move" && pendingMovesRef.current.length > 0) {
            pendingMovesRef.current = [];
            autoConfirmRequestRef.current = null;
            setAutoConfirmPending(false);
            endTurnInFlightRef.current = false;
            const authoritative = authoritativeStateRef.current;
            if (authoritative) {
              stateRef.current = authoritative;
              setState(authoritative);
            }
          }
          if (failedAction === "end_turn") {
            endTurnInFlightRef.current = false;
            autoConfirmRequestRef.current = null;
            setAutoConfirmPending(false);
          }
          // The server auto-resolves the opening once both sockets connect, so
          // a roll intent still in flight can hit a resolved opening. That
          // "Cannot roll now" is benign — the UI only offers roll when it is
          // the player's turn to roll.
          if (msg === "Cannot roll now") return;
          if (msg === "Unknown action: reorder_dice") return;
          setError(msg);
        });

        socket.on("game_ended", (message) => {
          const payload = (message as Record<string, unknown>).payload as {
            winner?: Color;
            loser?: Color;
            winType?: string;
            reason?: string;
            points?: number;
            cube?: number;
            whiteScore?: number;
            blackScore?: number;
            targetPoints?: number;
            nextGameIn?: number;
            matchOver?: boolean;
            adminReason?: string;
            gameFormat?: string;
            format?: string;
          };
          const winner = payload?.winner;
          const match = {
            white: payload.whiteScore ?? 0,
            black: payload.blackScore ?? 0,
          };
          setMatchScore(match);
          if (!winner) return;
          clientLogger.info("Game ended", { winner, reason: payload.reason });
          const targetPoints = payload.targetPoints ?? 0;
          const matchOver =
            payload.matchOver === true ||
            (targetPoints > 0 && match[winner] >= targetPoints);
          const payloadFormat = payload.gameFormat ?? payload.format;
          const derivedGameType: GameType =
            payloadFormat === "money"
              ? "quick"
              : payloadFormat === "match"
                ? gameTypeRef.current === "tournament"
                  ? "tournament"
                  : "1v1"
                : gameTypeRef.current;
          // Continuous match: keep board live when match not over
          if (!matchOver) {
            setNextGameCountdown(null);
            setState((prev) =>
              prev ? { ...prev, phase: "game_over", winner } : prev,
            );
            if (!autoNextGameRef.current) {
              autoNextGameRef.current = setTimeout(() => {
                autoNextGameRef.current = null;
                sendIntent({ action: "next_game" });
              }, 900);
            }
            setTimeout(() => void fetchFinalizedResult(0), 400);
            return;
          }

          setGameResult({
            winner,
            winType:
              (payload.winType as "single" | "gammon" | "backgammon") ||
              "single",
            points: payload.points ?? 1,
            cube: payload.cube ?? 1,
            matchScore: match,
            targetPoints,
            matchOver: true,
            reason: payload.reason,
            adminReason:
              typeof payload.adminReason === "string"
                ? payload.adminReason
                : undefined,
            gameType: derivedGameType,
          });
          // Fetch authoritative finalized result (rating/money/stats) after settlement
          setTimeout(() => void fetchFinalizedResult(0), 400);
          setNextGameCountdown(null);
          clearRoom();
          setState((prev) =>
            prev ? { ...prev, phase: "game_over", winner } : prev,
          );
        });

        socket.on("rematch_status", (message) => {
          const payload = (message as Record<string, unknown>).payload as Record<string, unknown> | undefined;
          const status = (payload?.status as string) ?? "idle";
          const reason = payload?.reason as string | undefined;
          setRematchState({ status: status as RematchState["status"], reason: reason ?? null });
        });

        socket.on("rematch_ready", (message) => {
          const payload = (message as Record<string, unknown>).payload as Record<string, unknown> | undefined;
          if (!payload) return;
          if (typeof payload.ticket === "string" && payload.ticket) {
            const finalUrl = serverUrl ? `${serverUrl.replace(/\/$/, "")}/api/link/enter/?ticket=${encodeURIComponent(payload.ticket as string)}` : `${window.location.origin}/backgammon/api/link/enter/?ticket=${encodeURIComponent(payload.ticket as string)}`;
            window.location.href = finalUrl;
            return;
          }
          if (typeof payload.roomId === "string" && typeof payload.color === "string") {
            const roomId = payload.roomId as string;
            const color = payload.color as string;
            const url = `${window.location.origin}/backgammon/game/${roomId}?color=${color}&mode=1v1`;
            window.location.href = url;
          }
        });

        socket.on("admin_review_required", (message) => {
          const payload = (message as Record<string, unknown>).payload as
            | Record<string, unknown>
            | undefined;
          setError(
            typeof payload?.message === "string"
              ? payload.message
              : "Match paused pending organizer decision",
          );
        });

        socket.on("turn_notice", (message) => {
          const payload = (message as Record<string, unknown>).payload as
            | Record<string, unknown>
            | undefined;
          if (payload?.kind !== "no_moves") return;
          const dice = Array.isArray(payload.dice)
            ? payload.dice.filter(
                (die): die is number => typeof die === "number",
              )
            : [];
          const remaining = Array.isArray(payload.remaining)
            ? payload.remaining.filter(
                (die): die is number => typeof die === "number",
              )
            : [];
          const color = payload.color;
          if (dice.length === 0 || (color !== "white" && color !== "black")) {
            return;
          }
          const revealAfterMs =
            typeof payload.revealAfterMs === "number"
              ? Math.max(0, payload.revealAfterMs)
              : 350;
          revealNoMoves({ dice, remaining, color }, revealAfterMs);
        });

        socket.on("admin_score_updated", (message) => {
          const payload = (message as Record<string, unknown>).payload as
            | Record<string, unknown>
            | undefined;
          if (
            typeof payload?.whiteScore === "number" &&
            typeof payload?.blackScore === "number"
          ) {
            setMatchScore({
              white: payload.whiteScore,
              black: payload.blackScore,
            });
          }
        });

        await socket.connect(roomId, token);
        setIsLoading(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to connect";
        clientLogger.error("Game connect failed", {
          roomId,
          playerColor: playerColorRef.current,
          error: msg,
        });
        setError(msg);
        setIsLoading(false);
      }
    };

    connectAndSetup();

    return () => {
      socket.removeAllListeners();
    };
  }, [roomId, socket]);

  // Tick down the server-authoritative next-game countdown shown in the result
  // overlay. The server owns the actual timer; this is display-only.
  useEffect(() => {
    if (nextGameCountdown === null || nextGameCountdown <= 0) return;
    const timer = setTimeout(() => {
      setNextGameCountdown((prev) => (prev === null ? null : prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [nextGameCountdown]);

  const rollDice = useCallback(() => {
    const current = stateRef.current;
    clientLogger.debug("[rollDice] called", {
      phase: current?.phase,
      turn: current?.turn,
    });
    if (!current) return;
    if (current.phase !== "opening_roll" && current.phase !== "rolling") {
      return;
    }
    sendIntent({ action: "roll" });
  }, [sendIntent]);

  const makeMove = useCallback(
    (from: Source, to: Target, options?: MakeMoveOptions) => {
      if (
        autoConfirmRequestRef.current !== null ||
        endTurnInFlightRef.current
      )
        return;
      const current = stateRef.current;
      if (!current || current.phase !== "moving") return;
      if (current.turn !== playerColorRef.current) return;
      const wasChoiceFreeSoFar = isTurnChoiceFreeSoFar(current, playerColorRef.current);
      const origin: "manual" | "forced" = options?.origin === "forced" ? "forced" : "manual";
      const id = nextLocalIdRef.current++;
      const pending: PendingMove = { id, from, to, sentAt: performance.now(), origin };
      const optimistic = applyOptimisticMove(
        current,
        pending,
        playerColorRef.current,
      );
      if (!optimistic) return;
      if (!sendIntent({ action: "move", from, to })) return;
      // Only clear prior auto request after manual move is validated and sent
      if (origin === "manual" && autoConfirmRequestRef.current) {
        clearAutoConfirm();
      }
      pendingMovesRef.current.push(pending);
      const isTerminal =
        optimistic.phase === "moving" &&
        optimistic.turn === playerColorRef.current &&
        !optimistic.winner &&
        allLegalMoves(optimistic, playerColorRef.current).length === 0;
      if (wasChoiceFreeSoFar && isTerminal) {
        autoConfirmRequestRef.current = { gen: lifecycleGenRef.current, pendingId: id, stage: "awaiting_move_ack" };
        setAutoConfirmPending(true);
      } else {
        autoConfirmRequestRef.current = null;
        setAutoConfirmPending(false);
      }
      stateRef.current = optimistic;
      setState(optimistic);
    },
    [sendIntent, clearAutoConfirm],
  );

  const reorderDice = useCallback(() => {
    if (
      autoConfirmRequestRef.current !== null ||
      endTurnInFlightRef.current
    )
      return;
    const current = stateRef.current;
    if (!current || current.phase !== "moving") return;
    if (current.turn !== playerColorRef.current) return;
    if ((current.remaining?.length ?? 0) < 2) return;
    setState(reorderGameDice(current));
    sendIntent({ action: "reorder_dice" });
  }, [sendIntent]);

  const offerDoubleAction = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.phase !== "rolling") return;
    sendIntent({ action: "double" });
  }, [sendIntent]);

  const respondToDouble = useCallback(
    (accept: boolean) => {
      const current = stateRef.current;
      if (!current || current.phase !== "doubling_offered") return;
      sendIntent({ action: "double_response", accept });
    },
    [sendIntent],
  );

  const endTurn = useCallback(() => {
    if (
      autoConfirmRequestRef.current !== null ||
      endTurnInFlightRef.current
    )
      return;
    const current = stateRef.current;
    if (!current || current.phase !== "moving") return;
    if (current.turn !== playerColorRef.current) return;
    if (allLegalMoves(current, current.turn).length > 0) return;
    endTurnInFlightRef.current = true;
    const sent = sendIntent({ action: "end_turn" });
    if (!sent) {
      endTurnInFlightRef.current = false;
      setError("Connection lost. Please wait for reconnection.");
    }
  }, [sendIntent]);

  const undoMove = useCallback(() => {
    if (
      autoConfirmRequestRef.current !== null ||
      endTurnInFlightRef.current
    )
      return;
    const current = stateRef.current;
    if (!current || current.phase !== "moving") return;
    if (current.turn !== playerColorRef.current) return;
    if (current.phase !== "moving") return;
    clearAutoConfirm();
    endTurnInFlightRef.current = false;
    sendIntent({ action: "undo" });
  }, [sendIntent, clearAutoConfirm]);

  const giveUp = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    socket.send("give_up", {});
  }, [socket]);

  const leaveGame = useCallback(() => {
    if (!socket.send("leave", {})) {
      setError("Connection lost. Reconnect and try leaving again.");
    }
  }, [socket]);

  const updateState = useCallback((s: GameState) => setState(s), []);

  const clearError = useCallback(() => setError(null), []);

  const handleNextGame = useCallback(() => {
    // next_game is ONLY for non-final games of same match; final rematch uses separate flow
    if (gameResult?.matchOver) return;
    setGameResult(null);
    sendIntent({ action: "next_game" });
  }, [sendIntent, gameResult]);

  const handleHome = useCallback(() => {
    setGameResult(null);
    setRematchState({ status: "idle" });
  }, []);

  const requestRematch = useCallback(() => {
    setRematchState({ status: "requested" });
    socket.send("rematch_request", {});
  }, [socket]);

  const acceptRematch = useCallback(() => {
    setRematchState({ status: "creating" });
    socket.send("rematch_accept", {});
  }, [socket]);

  const declineRematch = useCallback(() => {
    socket.send("rematch_decline", {});
    setRematchState({ status: "available" });
  }, [socket]);

  const cancelRematch = useCallback(() => {
    socket.send("rematch_cancel", {});
    setRematchState({ status: "available" });
  }, [socket]);

  // When final result arrives, make rematch available for non-tournament
  useEffect(() => {
    if (gameResult?.matchOver) {
      const isTournament = gameResult.gameType === "tournament" || gameType === "tournament";
      if (isTournament) {
        setRematchState({ status: "unavailable", reason: "tournament" });
      } else {
        setRematchState((prev) => (prev.status === "idle" ? { status: "available" } : prev));
      }
    } else if (!gameResult) {
      setRematchState({ status: "idle" });
    }
  }, [gameResult, gameType]);

  return (
    <GameContext.Provider
      value={{
        state,
        playerColor,
        whiteName,
        blackName,
        isLoading,
        error,
        clearError,
        openingRollResult,
        setOpeningRollResult,
        noMovesMessage,
        autoConfirmPending,
        reconnected,
        opponentConnected,
        timeControl,
        clock: state?.clock ?? null,
        turnStartedAt: state?.turnStartedAt ?? null,
        gameResult,
        nextGameCountdown,
        matchScore,
        gameType,
        handleNextGame,
        handleHome,
        updateState,
        makeMove,
        rollDice,
        reorderDice,
        offerDouble: offerDoubleAction,
        respondToDouble,
        endTurn,
        undoMove,
        giveUp,
        leaveGame,
        rematchState,
        requestRematch,
        acceptRematch,
        declineRematch,
        cancelRematch,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextType {
  const context = useContext(GameContext);
  if (!context) throw new Error("useGame must be used within GameProvider");
  return context;
}

export function useOptionalGame(): GameContextType | undefined {
  return useContext(GameContext);
}
