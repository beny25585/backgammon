import { createContext, useContext, useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import type { GameContextType, OpeningRollResult } from "../types/context";
import type { GameState, Color } from "../types/game";
import {
  applyMove,
  applyOpeningRoll,
  applyRoll,
  offerDouble,
  respondDouble,
  undoLastMove,
  allLegalMoves,
  OFF,
  type Source, type Target, type Move,
} from "../lib/backgammon/engine";
import { getSocketService } from "./socket";
import { getAccessToken } from "./auth";
import { clientLogger } from "./logger";
import { clearRoom } from "./roomStorage";

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
  const [whiteName, setWhiteName] = useState<string | null>(null);
  const [blackName, setBlackName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingRollResult, setOpeningRollResult] = useState<OpeningRollResult | null>(null);
  const [noMovesMessage, setNoMovesMessage] = useState<{ dice: number[] } | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [gameResult, setGameResult] = useState<GameContextType["gameResult"]>(null);

  const socket = getSocketService(serverUrl);
  const lastVersionRef = useRef(0);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const sendStateUpdate = useCallback((newState: GameState, action: string) => {
    socket.send("state_update", { state: newState, action });
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

        socket.on("state_update", (message) => {
          const msg = message as Record<string, unknown>;
          const raw = msg.payload as Record<string, unknown>;
          const isInitial = msg.initial === true;

          // Initial message from server on connect (contains our own color).
          if (isInitial) {
            console.log("[FE] initial state_update received", {
              phase: (raw as any).phase,
              turn: (raw as any).turn,
              version: raw.version,
              openingRoll: (raw as any).openingRoll,
              playerColorInMsg: msg.playerColor,
              myStoredColor: playerColor,
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

            const players = (msg as Record<string, unknown>).players as { white?: string | null; black?: string | null } | undefined;
            if (players) {
              setWhiteName(players.white ?? null);
              setBlackName(players.black ?? null);
            }

            const s = raw as any;
            if (s.phase === "opening_roll" && (s.openingRoll?.white != null || s.openingRoll?.black != null)) {
              setOpeningRollResult((prev) => ({
                myDie: s.openingRoll?.[playerColor] ?? prev?.myDie ?? null,
                opponentDie: s.openingRoll?.[playerColor === "white" ? "black" : "white"] ?? prev?.opponentDie ?? null,
                winner: null,
              }));
            }
            return;
          }

          // Broadcast from another player.
          const version = typeof raw.version === "number" ? raw.version : 0;
          if (version > 0 && version <= lastVersionRef.current) {
            clientLogger.warn("Stale state_update ignored", { version, last: lastVersionRef.current });
            return;
          }
          if (version > 0) lastVersionRef.current = version;

          // Our own echo — the board state is already applied locally. Just stamp
          // the server-assigned version so our next send is not treated as stale.
          if (msg.playerColor === playerColor) {
            setState((prev) =>
              prev && version > (prev.version ?? 0) ? { ...prev, version } : prev,
            );
            return;
          }

          console.log("[FE] state_update received", {
            phase: (raw as any).phase,
            turn: (raw as any).turn,
            version,
            openingRoll: (raw as any).openingRoll,
            playerColorInMsg: msg.playerColor,
            myStoredColor: playerColor,
            isFirst: !hasReceivedState,
          });
          if (hasReceivedState) {
            setReconnected(true);
            setTimeout(() => setReconnected(false), 3000);
          } else {
            // Only set playerColor on first broadcast if we never got the initial
            // message (e.g. a state_update raced with the connect handshake).
            if (msg.playerColor) setPlayerColor(msg.playerColor as Color);
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

        socket.on("player_joined", (_message) => {
          setIsLoading(false);
          setOpponentConnected(true);
        });

        socket.on("player_disconnected", (_message) => {
          setOpponentConnected(false);
        });

        socket.on("room_status", (_message) => {
          const data = (_message as Record<string, unknown>).payload as { connected: number };
          setOpponentConnected(data.connected >= 2);
        });

        socket.on("error", (message) => {
          const payload = (message as Record<string, unknown>).payload;
          const msg = typeof payload === "string" ? payload : (payload as Record<string, unknown>)?.message as string;
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
          };
          const winner = payload?.winner;
          if (!winner) return;
          clientLogger.info("Game ended", { winner, reason: payload.reason });
          setGameResult({
            winner,
            winType: (payload.winType as "single" | "gammon" | "backgammon") || "single",
            points: payload.points ?? 1,
            cube: payload.cube ?? 1,
            matchScore: {
              white: payload.whiteScore ?? 0,
              black: payload.blackScore ?? 0,
            },
            targetPoints: payload.targetPoints,
          });
          clearRoom();
          setState((prev) =>
            prev ? { ...prev, phase: "game_over", winner } : prev,
          );
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to connect";
        clientLogger.error("Game connect failed", { roomId, playerColor, error: msg });
        setError(msg);
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
        const next = applyOpeningRoll(prev, prev.turn);
        sendStateUpdate(next, "roll");

        // Build opening roll result for the overlay
        setOpeningRollResult(() => {
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
        const hasMoves = allLegalMoves(next, next.turn).length > 0;
        if (!hasMoves) {
          const passed: GameState = {
            ...next,
            remaining: [] as number[],
            turn: (next.turn === "white" ? "black" : "white") as Color,
            phase: "rolling",
            dice: [],
            lastMove: null,
            moveHistory: null,
          };
          setNoMovesMessage({ dice: next.dice });
          setTimeout(() => {
            setNoMovesMessage(null);
            setState((current) => {
              if (!current || current.phase !== "moving" || current.turn !== next.turn) return current;
              return passed;
            });
            sendStateUpdate(passed, "end_turn");
          }, 1500);
          sendStateUpdate(next, "roll");
          return next;
        }
        sendStateUpdate(next, "roll");
        return next;
      }

      return prev;
    });
  }, [playerColor, sendStateUpdate]);

  const endGame = useCallback((winner: Color, winType: string, reason: string, cube: number) => {
    setGameResult({
      winner,
      winType: (winType as "single" | "gammon" | "backgammon") || "single",
      points: 1,
      cube,
      matchScore: { white: 0, black: 0 },
    });
    socket.send("game_ended", { winner, winType, reason, cube });
  }, [socket]);

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
        endGame(next.winner, next.winType || "single", "bear_off", next.cube || 1);
      }

      sendStateUpdate(next, "move");
      return next;
    });
  }, [sendStateUpdate, endGame]);

  const offerDoubleAction = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.phase !== "rolling") return prev;
      const next = offerDouble(prev, prev.turn);
      sendStateUpdate(next, "double");
      return next;
    });
  }, [sendStateUpdate]);

  const respondToDouble = useCallback((accept: boolean) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = respondDouble(prev, accept);

      if (next.phase === "game_over" && next.winner) {
        endGame(next.winner, next.winType || "single", "double_decline", next.cube || 1);
      }

      sendStateUpdate(next, "double_response");
      return next;
    });
  }, [sendStateUpdate, endGame]);

  const endTurn = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.phase !== "moving") return prev;
      const next = { ...prev, remaining: [] as number[] };
      next.turn = prev.turn === "white" ? "black" : "white";
      next.phase = "rolling";
      next.dice = [];
      next.lastMove = null;
      next.moveHistory = null;
      sendStateUpdate(next, "end_turn");
      return next;
    });
  }, [sendStateUpdate]);

  const undoMove = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const restored = undoLastMove(prev);
      if (!restored) return prev;
      sendStateUpdate(restored, "undo");
      return restored;
    });
  }, [sendStateUpdate]);

  const giveUp = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const opponent: Color = playerColor === "white" ? "black" : "white";
    endGame(opponent, "single", "give_up", current.cube || 1);
  }, [endGame, playerColor]);

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
        whiteName,
        blackName,
        isLoading,
        error,
        openingRollResult,
        setOpeningRollResult,
        noMovesMessage,
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
        giveUp,
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
