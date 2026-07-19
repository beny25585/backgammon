import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";
import type { GameContextType, OpeningRollResult } from "../types/context";
import type { GameState, Color } from "../types/game";
import { BAR, OFF, type Source, type Target } from "../lib/backgammon/engine";
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

  const socket = getSocketService(serverUrl);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setError('Not authenticated');
      setIsLoading(false);
      return;
    }

    let hasReceivedState = false;

    const connectAndSetup = async () => {
      try {
        await socket.connect(roomId, token);
        setIsLoading(false);

        socket.on('state_update', (payload) => {
          const raw = payload as Record<string, unknown>;
          if (hasReceivedState) {
            setReconnected(true);
            setTimeout(() => setReconnected(false), 3000);
          }
          hasReceivedState = true;
          setState(raw as unknown as GameState);
          if (raw.playerColor) setPlayerColor(raw.playerColor as Color);
        });

        socket.on('opening_roll_result', (payload) => {
          const data = payload as { dice: number[]; playerColor: string; winner?: string };
          const isMe = data.playerColor === playerColor;
          setOpeningRollResult(prev => {
            const base = prev || { myDie: null, opponentDie: null, winner: null };
            const winner = data.winner ? (data.winner as Color) : base.winner;
            if (isMe) {
              return { ...base, myDie: data.dice[0], winner };
            } else {
              return { ...base, opponentDie: data.dice[0], winner };
            }
          });
        });

        socket.on('error', (payload) => {
          const msg = typeof payload === 'string' ? payload : (payload as Record<string, unknown>)?.message as string;
          setError(msg);
        });

        socket.on('player_joined', () => {
          setIsLoading(false);
          setOpponentConnected(true);
        });

        socket.on('player_disconnected', () => {
          setOpponentConnected(false);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
        setIsLoading(false);
      }
    };

    connectAndSetup();

    return () => {
      socket.disconnect();
    };
  }, [roomId, socket, playerColor]);

  const makeMove = useCallback(
    (from: Source, to: Target) => {
      socket.send("move", { from, to });
    },
    [socket],
  );

  const rollDice = useCallback(() => {
    socket.send("roll_dice", {});
  }, [socket]);

  const offerDouble = useCallback(() => {
    socket.send("offer_double", {});
  }, [socket]);

  const respondToDouble = useCallback((accept: boolean) => {
    socket.send("respond_double", { accept });
  }, [socket]);

  const endTurn = useCallback(() => {
    socket.send("end_turn", {});
  }, [socket]);

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
        updateState: () => {},
        makeMove,
        rollDice,
        offerDouble,
        respondToDouble,
        endTurn,
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
