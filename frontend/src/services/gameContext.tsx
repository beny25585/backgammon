import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";
import type { GameContextType, OpeningRollResult } from "../types/context";
import type { GameState, Color } from "../types/game";
import {
  newGame,
  applyMove,
  applyOpeningRoll,
  applyRoll,
  offerDouble,
  respondDouble,
  undoLastMove,
  allLegalMoves,
  BAR, OFF,
  type Source, type Target, type Move,
} from "../lib/backgammon/engine";
import { getSocketService } from "./socket";
import { getAccessToken } from "./auth";

export const GameContext = createContext<GameContextType | undefined>(undefined);

interface GameProviderProps {
  children: ReactNode;
  roomId: string;
  playerColor: Color;
  serverUrl?: string;
}

export function GameProvider({ children, roomId, playerColor: initialColor, serverUrl }: GameProviderProps) {
  const [state, setState] = useState<GameState | null>(null);
  const [playerColor, setPlayerColor] = useState<Color>(initialColor);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingRollResult, setOpeningRollResult] = useState<OpeningRollResult | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [gameResult, setGameResult] = useState<GameContextType["gameResult"]>(null);

  const socket = getSocketService(serverUrl);

  const sendStateUpdate = useCallback((newState: GameState) => {
    socket.send("state_update", newState);
  }, [socket]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setError("Not authenticated");
      setIsLoading(false);
      return;
    }

    let hasReceivedState = false;

    const connectAndSetup = async () => {
      try {
        await socket.connect(roomId, token);
        setIsLoading(false);

        socket.on("state_update", (payload) => {
          const raw = payload as Record<string, unknown>;
          console.log("[FE] state_update received", {
            phase: (raw as any).phase,
            turn: (raw as any).turn,
            dice: (raw as any).dice,
            openingRoll: (raw as any).openingRoll,
            playerColorInMsg: raw.playerColor,
            myStoredColor: playerColor,
            isFirst: !hasReceivedState,
          });
          if (hasReceivedState) {
            setReconnected(true);
            setTimeout(() => setReconnected(false), 3000);
          } else {
            // Only set playerColor on first state_update (initial connect)
            // Subsequent broadcasts include the sender's color, not ours
            if (raw.playerColor) setPlayerColor(raw.playerColor as Color);
          }
          hasReceivedState = true;
          setState(raw as unknown as GameState);

          // Update opening roll result from received state
          const s = raw as any;
          if (s.phase === "opening_roll" && (s.openingRoll?.white != null || s.openingRoll?.black != null)) {
            setOpeningRollResult((prev) => ({
              myDie: s.openingRoll?.[playerColor] ?? prev?.myDie ?? null,
              opponentDie: s.openingRoll?.[playerColor === "white" ? "black" : "white"] ?? prev?.opponentDie ?? null,
              winner: null,
            }));
          }
        });

        socket.on("player_joined", () => {
          setIsLoading(false);
          setOpponentConnected(true);
        });

        socket.on("player_disconnected", () => {
          setOpponentConnected(false);
        });

        socket.on("room_status", (payload: unknown) => {
          const data = payload as { connected: number };
          setOpponentConnected(data.connected >= 2);
        });

        socket.on("error", (payload) => {
          const msg = typeof payload === "string" ? payload : (payload as Record<string, unknown>)?.message as string;
          setError(msg);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect");
        setIsLoading(false);
      }
    };

    connectAndSetup();

    return () => {
      socket.removeAllListeners();
    };
  }, [roomId, socket]);

  const rollDice = useCallback(() => {
    setState((prev) => {
      console.log("[FE] rollDice called, phase:", prev?.phase, "turn:", prev?.turn, "playerColor:", playerColor);
      if (!prev) return prev;

      if (prev.phase === "opening_roll") {
        const next = applyOpeningRoll(prev, playerColor);
        sendStateUpdate(next);

        // Build opening roll result for the overlay
        setOpeningRollResult((existing) => {
          const myDie = next.openingRoll[playerColor];
          const oppColor = playerColor === "white" ? "black" : "white";
          const opponentDie = next.openingRoll[oppColor];
          const winner = next.phase !== "opening_roll" ? (next.turn as Color) : null;

          // Clear overlay after 2s if opening resolved
          if (winner) {
            setTimeout(() => setOpeningRollResult(null), 2000);
          }

          return { myDie, opponentDie, winner };
        });

        return next;
      }

      if (prev.phase === "rolling") {
        const next = applyRoll(prev);
        sendStateUpdate(next);
        return next;
      }

      return prev;
    });
  }, [playerColor, sendStateUpdate]);

  const makeMove = useCallback((from: Source, to: Target) => {
    setState((prev) => {
      if (!prev || prev.phase !== "moving") return prev;
      const dest = to === OFF ? OFF : to;
      const moves = allLegalMoves(prev, prev.turn);
      const match = moves.find(
        (m: Move) => m.from === from && (dest === OFF ? m.to === OFF : m.to === dest),
      );
      if (!match) return prev;
      const next = applyMove(prev, match, prev.turn);

      // Check for game over
      if (next.phase === "game_over" && next.winner) {
        setGameResult({
          winner: next.winner,
          winType: next.winType || "single",
          points: 1,
          cube: next.cube || 1,
          matchScore: { white: 0, black: 0 },
        });
      }

      sendStateUpdate(next);
      return next;
    });
  }, [sendStateUpdate]);

  const offerDoubleAction = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.phase !== "rolling") return prev;
      const next = offerDouble(prev, prev.turn);
      sendStateUpdate(next);
      return next;
    });
  }, [sendStateUpdate]);

  const respondToDouble = useCallback((accept: boolean) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = respondDouble(prev, accept);

      if (next.phase === "game_over" && next.winner) {
        setGameResult({
          winner: next.winner,
          winType: next.winType || "single",
          points: 1,
          cube: next.cube || 1,
          matchScore: { white: 0, black: 0 },
        });
      }

      sendStateUpdate(next);
      return next;
    });
  }, [sendStateUpdate]);

  const endTurn = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.phase !== "moving") return prev;
      const next = { ...prev, remaining: [] as number[] };
      next.turn = prev.turn === "white" ? "black" : "white";
      next.phase = "rolling";
      next.dice = [];
      next.lastMove = null;
      next.moveHistory = null;
      sendStateUpdate(next);
      return next;
    });
  }, [sendStateUpdate]);

  const undoMove = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const restored = undoLastMove(prev);
      if (!restored) return prev;
      sendStateUpdate(restored);
      return restored;
    });
  }, [sendStateUpdate]);

  const updateState = useCallback((s: GameState) => setState(s), []);

  const handleNextGame = useCallback(() => {
    setGameResult(null);
  }, []);

  const handleHome = useCallback(() => {
    setGameResult(null);
  }, []);

  return (
    <GameContext.Provider
      value={{
        state,
        playerColor,
        isLoading,
        error,
        openingRollResult,
        setOpeningRollResult,
        reconnected,
        opponentConnected,
        gameResult,
        handleNextGame,
        handleHome,
        updateState,
        makeMove,
        rollDice,
        offerDouble: offerDoubleAction,
        respondToDouble,
        endTurn,
        undoMove,
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
