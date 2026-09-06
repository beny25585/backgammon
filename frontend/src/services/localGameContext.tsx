import {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import type { GameResult, OpeningRollResult } from "../types/context";
import type { GameState, Color, Move } from "../types/game";
import { saveMatch, fetchDice } from "../services/api";
import {
  newGame,
  applyMove,
  applyOpeningRoll,
  applyRoll,
  reorderDice as reorderGameDice,
  offerDouble,
  respondDouble,
  undoLastMove,
  allLegalMoves,
  OFF,
  type Source,
  type Target,
} from "@/lib/backgammon/engine";
import { chooseMove } from "@/lib/bot/chooseMove";
import { GameContext } from "./gameContext";
import GameResultOverlay from "../components/GameResultOverlay/GameResultOverlay";
import { useLocalClock } from "../hooks/useLocalClock";
import type { TimeControl } from "../lib/clock";
import { clientLogger } from "./logger";

function extractTranscript(state: GameState) {
  const history = state.moveHistory;
  if (!history || history.length === 0) return [];
  const turns: Array<{
    turn: string;
    roll: number[];
    moves: Array<{ from: unknown; to: unknown }>;
  }> = [];
  let current: (typeof turns)[0] | null = null;
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const turnColor = entry.turn;
    if (!current || current.turn !== turnColor) {
      if (current) turns.push(current);
      current = { turn: String(turnColor), roll: [...entry.dice], moves: [] };
    }
    const nextEntry = i + 1 < history.length ? history[i + 1] : state;
    if (nextEntry.lastMove && nextEntry.lastMove.length > 0) {
      const m = nextEntry.lastMove[nextEntry.lastMove.length - 1];
      current.moves.push({ from: m.from, to: m.to });
    }
  }
  if (current) turns.push(current);
  return turns;
}

interface LocalGameProviderProps {
  children: ReactNode;
  botColor?: Color;
  matchTarget?: number;
  timeControl?: TimeControl | null;
  onQuitMatch?: () => void;
}

const BOT_DELAY = 1000;

export function LocalGameProvider({
  children,
  botColor,
  matchTarget = 7,
  timeControl,
  onQuitMatch,
}: LocalGameProviderProps) {
  const [state, setState] = useState<GameState>(() => newGame());
  const humanColor: Color = botColor
    ? botColor === "white"
      ? "black"
      : "white"
    : "white";
  const [playerColor, setPlayerColor] = useState<Color>(humanColor);
  const [isLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingRollResult, setOpeningRollResult] =
    useState<OpeningRollResult | null>(null);
  const [noMovesMessage, setNoMovesMessage] = useState<{
    dice: number[];
  } | null>(null);
  const [reconnected] = useState(false);
  const [opponentConnected] = useState(true);

  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const playerColorRef = useRef(playerColor);
  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  const openingDiceRef = useRef<[number, number] | null>(null);
  const rollingRef = useRef(false);

  const getOpeningDie = useCallback(
    async (color: Color): Promise<number | null> => {
      try {
        if (!openingDiceRef.current) {
          openingDiceRef.current = await fetchDice("opening");
        }
        return openingDiceRef.current[color === "white" ? 0 : 1];
      } catch (e) {
        setError(e instanceof Error ? e.message : "Dice service unavailable");
        return null;
      }
    },
    [],
  );

  const getTurnDice = useCallback(async (): Promise<number[] | null> => {
    try {
      const [a, b] = await fetchDice("normal");
      return a === b ? [a, a, a, a] : [a, b];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dice service unavailable");
      return null;
    }
  }, []);

  const setTurnColor = useCallback(
    (color: Color) => {
      if (!botColor) setPlayerColor(color);
    },
    [botColor],
  );

  // After the result banner, let the winner play the two opening dice.
  const advanceToOpeningMove = useCallback(() => {
    clientLogger.debug("[advanceToOpeningMove] scheduled");
    setTimeout(() => {
      setState((prev) =>
        prev.phase === "opening_result"
          ? { ...prev, phase: "moving" as const }
          : prev,
      );
    }, 2000);
  }, []);

  // ── Match tracking ─────────────────────────────────────────────

  const [matchScore, setMatchScore] = useState<Record<Color, number>>({
    white: 0,
    black: 0,
  });
  const [matchWinner, setMatchWinner] = useState<Color | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);

  const nextGameCountdown = null;
  const savedMatchRef = useRef(false);
  const betweenGamesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MATCH_TARGET = matchTarget;

  const handleNextGame = useCallback(() => {
    if (betweenGamesTimer.current) {
      clearTimeout(betweenGamesTimer.current);
      betweenGamesTimer.current = null;
    }
    openingDiceRef.current = null;
    setGameResult(null);
    setState(newGame());
    setTurnColor("white");
    setOpeningRollResult(null);
  }, [setTurnColor]);

  const handleHome = useCallback(() => {
    openingDiceRef.current = null;
    setGameResult(null);
    setMatchWinner(null);
    setMatchScore({ white: 0, black: 0 });
    setState(newGame());
    setTurnColor("white");
    if (onQuitMatch) onQuitMatch();
  }, [setTurnColor, onQuitMatch]);

  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const phaseChanged = prevPhaseRef.current !== state.phase;
    prevPhaseRef.current = state.phase;
    if (!phaseChanged || state.phase !== "game_over" || !state.winner || gameResult) {
      return;
    }

    const base =
      state.winType === "single" ? 1 : state.winType === "gammon" ? 2 : 3;
    const points = base * (state.cube || 1);
    const nextScore = {
      ...matchScore,
      [state.winner]: matchScore[state.winner] + points,
    };
    setMatchScore(nextScore);

    if (nextScore[state.winner] >= MATCH_TARGET) {
      setMatchWinner(state.winner);
      setGameResult({
        winner: state.winner,
        winType: state.winType || "single",
        points,
        cube: state.cube || 1,
        matchScore: nextScore,
        targetPoints: MATCH_TARGET,
        matchOver: true,
      });
      return;
    }

    if (!betweenGamesTimer.current) {
      betweenGamesTimer.current = setTimeout(() => {
        betweenGamesTimer.current = null;
        handleNextGame();
      }, 1500);
    }
  }, [gameResult, handleNextGame, matchScore, MATCH_TARGET, state]);

  useEffect(
    () => () => {
      if (betweenGamesTimer.current) clearTimeout(betweenGamesTimer.current);
    },
    [],
  );

  // Auto-save match on completion (local/AI mode only — online mode saves server-side)
  useEffect(() => {
    if (!matchWinner) {
      savedMatchRef.current = false;
      return;
    }
    if (savedMatchRef.current) return;
    savedMatchRef.current = true;
    saveMatch({
      white_player_id: null,
      black_player_id: null,
      match_type: "ai",
      target_points: MATCH_TARGET,
      white_score: matchScore.white,
      black_score: matchScore.black,
      winner: matchWinner,
      games: [
        {
          game_number: 1,
          winner: state.winner,
          win_type: state.winType || "single",
          points_awarded:
            (state.cube || 1) *
            (state.winType === "gammon"
              ? 2
              : state.winType === "backgammon"
                ? 3
                : 1),
          transcript: extractTranscript(state),
        },
      ],
    }).catch(() => {});
  }, [matchWinner, matchScore, state, MATCH_TARGET]);

  // ── Bot turn automation ──────────────────────────────────────────

  useEffect(() => {
    if (!botColor) return;
    if (state.turn !== botColor) return;
    clientLogger.debug("[bot automation] firing", {
      phase: state.phase,
      turn: state.turn,
    });

    const timer = setTimeout(() => {
      void (async () => {
        if (state.phase === "opening_roll") {
          const die = await getOpeningDie(botColor);
          if (die === null) return;
          setState((prev) => {
            if (prev.turn !== botColor || prev.phase !== "opening_roll")
              return prev;
            const next = applyOpeningRoll(prev, botColor, die);
            if (next.phase === "opening_roll") {
              const other: Color = botColor === "white" ? "black" : "white";
              setTurnColor(other);
              return { ...next, turn: other };
            }
            const winner: Color = next.turn;
            setOpeningRollResult({
              myDie: next.openingRoll.white,
              opponentDie: next.openingRoll.black,
              winner,
            });
            setTimeout(() => setOpeningRollResult(null), 3500);
            advanceToOpeningMove();
            setTurnColor(next.turn);
            return next;
          });
          return;
        }

        if (state.phase === "rolling") {
          const dice = await getTurnDice();
          if (!dice) return;
          setState((prev) => {
            if (prev.turn !== botColor || prev.phase !== "rolling") return prev;
            const next = applyRoll(prev, dice);
            clientLogger.debug("[bot rolled]", {
              dice,
              turn: next.turn,
              phase: next.phase,
            });
            setTurnColor(next.turn);
            return next;
          });
          return;
        }

        if (state.phase === "moving") {
          setState((prev) => {
            if (prev.turn !== botColor) return prev;
            const move = chooseMove(prev, botColor);
            if (!move) {
              const next = { ...prev, remaining: [] as number[] };
              next.turn = botColor === "white" ? "black" : "white";
              next.phase = "rolling" as const;
              next.dice = [];
              next.lastMove = null;
              setTurnColor(next.turn);
              return next;
            }
            const next = applyMove(prev, move, botColor);
            setTurnColor(next.turn);
            return next;
          });
        }
      })();
    }, BOT_DELAY);

    return () => clearTimeout(timer);
  }, [state, botColor, getOpeningDie, getTurnDice, setTurnColor, advanceToOpeningMove]);

  // ── Human actions ──────────────────────────────────────────────

  const rollDice = useCallback(() => {
    const current = stateRef.current;
    clientLogger.debug("[local rollDice] called", {
      phase: current?.phase,
      turn: current?.turn,
      rollingRef: rollingRef.current,
    });
    if (!current) return;
    if (current.phase !== "opening_roll" && current.phase !== "rolling") return;
    if (rollingRef.current) return;
    rollingRef.current = true;

    void (async () => {
      try {
        if (current.phase === "opening_roll") {
          const color = current.turn;
          const die = await getOpeningDie(color);
          if (die === null) return;
          setState((prev) => {
            if (prev.phase !== "opening_roll" || prev.turn !== color)
              return prev;
            const next = applyOpeningRoll(prev, prev.turn, die);
            clientLogger.debug("[opening roll applied]", {
              die,
              phase: next.phase,
              turn: next.turn,
              openingRoll: next.openingRoll,
            });
            if (next.phase === "opening_roll") {
              const other: Color = prev.turn === "white" ? "black" : "white";
              setOpeningRollResult({
                myDie: next.openingRoll[prev.turn],
                opponentDie: null,
                winner: null,
              });
              setTurnColor(other);
              return { ...next, turn: other };
            }
            const winner: Color = next.turn;
            setOpeningRollResult({
              myDie: next.openingRoll.white,
              opponentDie: next.openingRoll.black,
              winner,
            });
            setTimeout(() => setOpeningRollResult(null), 3500);
            advanceToOpeningMove();
            setTurnColor(next.turn);
            return next;
          });
          return;
        }
        if (current.phase === "rolling") {
          const dice = await getTurnDice();
          clientLogger.debug("[roll dice fetched]", {
            dice,
            phaseAtFetch: current.phase,
            turnAtFetch: current.turn,
          });
          if (!dice) return;
          setState((prev) => {
            if (prev.phase !== "rolling") return prev;
            const rolled = applyRoll(prev, dice);
            clientLogger.debug("[turn roll applied]", {
              dice,
              fromPhase: prev.phase,
              toPhase: rolled.phase,
              turn: rolled.turn,
            });
            const hasMoves = allLegalMoves(rolled, rolled.turn).length > 0;
            setTurnColor(rolled.turn);
            if (!hasMoves) {
              const passed: GameState = {
                ...rolled,
                remaining: [] as number[],
                turn: (rolled.turn === "white" ? "black" : "white") as Color,
                phase: "rolling",
                dice: [],
                lastMove: null,
                moveHistory: null,
              };
              setNoMovesMessage({ dice: rolled.dice });
              setTimeout(() => {
                setNoMovesMessage(null);
                setState((cur) => {
                  if (
                    !cur ||
                    cur.phase !== "moving" ||
                    cur.turn !== rolled.turn
                  )
                    return cur;
                  return passed;
                });
                setTurnColor(passed.turn);
              }, 1500);
            }
            return rolled;
          });
        }
      } finally {
        rollingRef.current = false;
      }
    })();
  }, [getOpeningDie, getTurnDice, setTurnColor, advanceToOpeningMove]);

  const reorderDice = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== "moving") return prev;
      if (prev.turn !== playerColorRef.current) return prev;
      return reorderGameDice(prev);
    });
  }, []);

  const makeMove = useCallback(
    (from: Source, to: Target) => {
      setState((prev) => {
        if (prev.phase !== "moving") return prev;
        if (prev.turn !== playerColorRef.current) return prev;
        const dest = to === OFF ? OFF : to;
        const moves = allLegalMoves(prev, prev.turn);
        const matchingMoves = moves.filter(
          (m: Move) =>
            m.from === from && (dest === OFF ? m.to === OFF : m.to === dest),
        );
        const match =
          prev.remaining
            .map((die) => matchingMoves.find((m) => m.die === die))
            .find((move): move is Move => Boolean(move)) ?? matchingMoves[0];
        if (!match) return prev;
        const next = applyMove(prev, match, prev.turn);
        setTurnColor(next.turn);
        return next;
      });
    },
    [setTurnColor],
  );

  const offerDoubleAction = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== "rolling") return prev;
      return offerDouble(prev, prev.turn);
    });
  }, []);

  const respondToDouble = useCallback(
    (accept: boolean) => {
      setState((prev) => {
        const next = respondDouble(prev, accept);
        if (next.phase !== "game_over") setTurnColor(next.turn);
        return next;
      });
    },
    [setTurnColor],
  );

  const endTurn = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== "moving") return prev;
      const next = { ...prev, remaining: [] as number[] };
      next.turn = prev.turn === "white" ? "black" : "white";
      next.phase = "rolling";
      next.dice = [];
      next.lastMove = null;
      next.moveHistory = null;
      setTurnColor(next.turn);
      return next;
    });
  }, [setTurnColor]);

  const undoMove = useCallback(() => {
    setState((prev) => {
      const restored = undoLastMove(prev);
      if (!restored) return prev;
      setTurnColor(restored.turn);
      return restored;
    });
  }, [setTurnColor]);

  const updateState = useCallback((s: GameState) => setState(s), []);

  const clearError = useCallback(() => setError(null), []);

  const handleTimeout = useCallback((color: Color) => {
    setState((prev) => {
      if (!prev || prev.phase === "game_over") return prev;
      const winner: Color = color === "white" ? "black" : "white";
      return {
        ...prev,
        phase: "game_over",
        winner,
        winType: "single",
        message: `${color} ran out of time`,
      };
    });
  }, []);

  const localClock = useLocalClock(state, timeControl ?? null, handleTimeout);

  return (
    <GameContext.Provider
      value={{
        state,
        playerColor,
        whiteName: botColor === "white" ? "Bot" : null,
        blackName: botColor === "black" ? "Bot" : null,
        isLoading,
        error,
        clearError,
        openingRollResult,
        setOpeningRollResult,
        noMovesMessage,
        reconnected,
        opponentConnected,
        timeControl: timeControl ?? null,
        clock: localClock.clock,
        turnStartedAt: localClock.turnStartedAt,
        gameResult,
        nextGameCountdown,
        matchScore,
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
        giveUp: () => {},
        leaveGame: () => {},
      }}
    >
      {children}

      {gameResult && (
        <GameResultOverlay
          playerColor={playerColor}
          winner={gameResult.winner}
          winType={gameResult.winType}
          points={gameResult.points}
          cube={gameResult.cube}
          matchScore={matchScore}
          matchTarget={MATCH_TARGET}
          whiteName={botColor === "white" ? "Bot" : null}
          blackName={botColor === "black" ? "Bot" : null}
          countdown={nextGameCountdown}
          onNext={handleNextGame}
          onHome={handleHome}
        />
      )}
    </GameContext.Provider>
  );
}
