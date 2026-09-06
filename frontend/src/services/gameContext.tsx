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
  OpeningRollResult,
} from "../types/context";
import type { GameState, Color } from "../types/game";
import type { Source, Target } from "../lib/backgammon/engine";
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
  serverUrl?: string;
}

export function GameProvider({
  children,
  roomId,
  playerColor: initialColor,
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
  const [noMovesMessage, setNoMovesMessage] = useState<{
    dice: number[];
  } | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [timeControl, setTimeControl] = useState<TimeControl | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [nextGameCountdown, setNextGameCountdown] = useState<number | null>(
    null,
  );
  const [matchScore, setMatchScore] = useState<Record<Color, number>>({
    white: 0,
    black: 0,
  });

  const socket = getSocketService(serverUrl);
  const lastVersionRef = useRef(0);
  const stateRef = useRef(state);
  const playerColorRef = useRef(playerColor);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  const sendIntent = useCallback(
    (payload: Record<string, unknown>) => {
      socket.send("state_update", payload);
    },
    [socket],
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
        await socket.connect(roomId, token);
        setIsLoading(false);

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
            clientLogger.debug("Initial state update received", {
              phase: raw.phase,
              turn: raw.turn,
              version: raw.version,
              playerColorInMsg: msg.playerColor,
            });
            if (msg.playerColor) setPlayerColor(msg.playerColor as Color);
            const v = typeof raw.version === "number" ? raw.version : 0;
            if (v > 0) lastVersionRef.current = v;
            if (hasReceivedState) {
              setReconnected(true);
              setTimeout(() => setReconnected(false), 3000);
            }
            hasReceivedState = true;
            setState(raw as unknown as GameState);

            const players = (msg as Record<string, unknown>).players as
              | { white?: string | null; black?: string | null }
              | undefined;
            if (players) {
              setWhiteName(players.white ?? null);
              setBlackName(players.black ?? null);
            }

            const tc = (msg as Record<string, unknown>).timeControl;
            if (typeof tc === "string") setTimeControl(parseTimeControl(tc));

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
            setNoMovesMessage({ dice: next.dice });
            setTimeout(() => setNoMovesMessage(null), 1500);
          }

          setState(next);
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
          // The server auto-resolves the opening once both sockets connect, so
          // a roll intent still in flight can hit a resolved opening. That
          // "Cannot roll now" is benign — the UI only offers roll when it is
          // the player's turn to roll.
          if (msg === "Cannot roll now") return;
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
          if (matchOver) {
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
            });
          } else {
            setGameResult(null);
          }
          const nextGameIn =
            typeof payload.nextGameIn === "number" ? payload.nextGameIn : null;
          if (matchOver) {
            setNextGameCountdown(null);
          } else if (nextGameIn !== null) {
            setNextGameCountdown(nextGameIn);
          }
          clearRoom();
          setState((prev) =>
            prev ? { ...prev, phase: "game_over", winner } : prev,
          );
        });
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
    (from: Source, to: Target) => {
      const current = stateRef.current;
      if (!current || current.phase !== "moving") return;
      if (current.turn !== playerColorRef.current) return;
      sendIntent({ action: "move", from, to });
    },
    [sendIntent],
  );

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
    const current = stateRef.current;
    if (!current || current.phase !== "moving") return;
    sendIntent({ action: "end_turn" });
  }, [sendIntent]);

  const undoMove = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.phase !== "moving") return;
    sendIntent({ action: "undo" });
  }, [sendIntent]);

  const giveUp = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    socket.send("give_up", {});
  }, [socket]);

  const leaveGame = useCallback(() => {
    socket.send("leave", {});
  }, [socket]);

  const updateState = useCallback((s: GameState) => setState(s), []);

  const clearError = useCallback(() => setError(null), []);

  const handleNextGame = useCallback(() => {
    setGameResult(null);
    sendIntent({ action: "next_game" });
  }, [sendIntent]);

  const handleHome = useCallback(() => {
    setGameResult(null);
  }, []);

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
        reconnected,
        opponentConnected,
        timeControl,
        clock: state?.clock ?? null,
        turnStartedAt: state?.turnStartedAt ?? null,
        gameResult,
        nextGameCountdown,
        matchScore,
        handleNextGame,
        handleHome,
        updateState,
        makeMove,
        rollDice,
        offerDouble: offerDoubleAction,
        respondToDouble,
        endTurn,
        undoMove,
        giveUp,
        leaveGame,
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
