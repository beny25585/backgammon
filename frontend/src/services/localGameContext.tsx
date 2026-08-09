import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import type { GameResult, OpeningRollResult } from "../types/context";
import type { GameState, Color, Move } from "../types/game";
import { saveMatch, fetchDice } from "../services/api";
import {
  newGame,
  applyMove,
  applyOpeningRoll,
  applyRoll,
  offerDouble,
  respondDouble,
  undoLastMove,
  allLegalMoves,
  OFF,
  type Source, type Target,
} from "@/lib/backgammon/engine";
import { chooseMove } from "@/lib/bot/chooseMove";
import { GameContext } from "./gameContext";
import GameResultOverlay from "../components/GameResultOverlay/GameResultOverlay";
import { useLocalClock } from "../hooks/useLocalClock";
import type { TimeControl } from "../lib/clock";

function extractTranscript(state: GameState) {
  const history = state.moveHistory;
  if (!history || history.length === 0) return [];
  const turns: Array<{ turn: string; roll: number[]; moves: Array<{ from: unknown; to: unknown }> }> = [];
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

export function LocalGameProvider({ children, botColor, matchTarget = 7, timeControl, onQuitMatch }: LocalGameProviderProps) {
  const [state, setState] = useState<GameState>(() => newGame());
  const humanColor: Color = botColor ? (botColor === "white" ? "black" : "white") : "white";
  const [playerColor, setPlayerColor] = useState<Color>(humanColor);
  const [isLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingRollResult, setOpeningRollResult] = useState<OpeningRollResult | null>(null);
  const [noMovesMessage, setNoMovesMessage] = useState<{ dice: number[] } | null>(null);
  const [reconnected] = useState(false);
  const [opponentConnected] = useState(true);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const playerColorRef = useRef(playerColor);
  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  const openingDiceRef = useRef<[number, number] | null>(null);
  const rollingRef = useRef(false);

  const getOpeningDie = useCallback(async (color: Color): Promise<number | null> => {
    try {
      if (!openingDiceRef.current) {
        openingDiceRef.current = await fetchDice("opening");
      }
      return openingDiceRef.current[color === "white" ? 0 : 1];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dice service unavailable");
      return null;
    }
  }, []);

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

  // ── Match tracking ─────────────────────────────────────────────

  const [matchScore, setMatchScore] = useState<Record<Color, number>>({ white: 0, black: 0 });
  const [matchWinner, setMatchWinner] = useState<Color | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);

  // Auto-advance to next game after 30s
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nextGameCountdown, setNextGameCountdown] = useState<number | null>(null);
  const savedMatchRef = useRef(false);

  const MATCH_TARGET = matchTarget;

  const handleNextGame = useCallback(() => {
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

  // Score game when it ends (uses state directly, no setState nesting).
  const [prevPhase, setPrevPhase] = useState(state.phase);
  if (prevPhase !== state.phase) {
    setPrevPhase(state.phase);
    if (state.phase === "game_over" && state.winner && gameResult === null) {
      const base =
        state.winType === "single"
          ? 1
          : state.winType === "gammon"
            ? 2
            : 3;
      const points = base * (state.cube || 1);

      setGameResult({
        winner: state.winner,
        winType: state.winType || "single",
        points,
        cube: state.cube || 1,
        matchScore: { ...matchScore },
        targetPoints: MATCH_TARGET,
      });

      const nextScore = { ...matchScore };
      nextScore[state.winner] += points;
      setMatchScore(nextScore);
      if (nextScore[state.winner] >= MATCH_TARGET) {
        setMatchWinner(state.winner);
      }
    }
  }

  // Reset the countdown whenever no result is shown or the match is over.
  if (
    (!gameResult || matchWinner || MATCH_TARGET <= 1) &&
    nextGameCountdown !== null
  ) {
    setNextGameCountdown(null);
  }

  // Start the countdown when a new game result is shown.
  if (
    gameResult &&
    !matchWinner &&
    MATCH_TARGET > 1 &&
    nextGameCountdown === null
  ) {
    setNextGameCountdown(30);
  }

  // Auto-advance when game result is shown and match isn't over
  useEffect(() => {
    if (!gameResult || matchWinner || MATCH_TARGET <= 1) return;

    autoAdvanceTimer.current = setTimeout(() => {
      handleNextGame();
    }, 30000);

    const tick = setInterval(() => {
      setNextGameCountdown((prev) => (prev == null ? null : prev - 1));
    }, 1000);

    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      clearInterval(tick);
    };
  }, [gameResult, matchWinner, handleNextGame, MATCH_TARGET]);

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
      games: [{
        game_number: 1,
        winner: state.winner,
        win_type: state.winType || "single",
        points_awarded: (state.cube || 1) * (state.winType === "gammon" ? 2 : state.winType === "backgammon" ? 3 : 1),
        transcript: extractTranscript(state),
      }],
    }).catch(() => {});
  }, [matchWinner, matchScore, state, MATCH_TARGET]);

  // ── Bot turn automation ──────────────────────────────────────────

  useEffect(() => {
    if (!botColor) return;
    if (state.turn !== botColor) return;

    const timer = setTimeout(() => {
      void (async () => {
        if (state.phase === "opening_roll") {
          const die = await getOpeningDie(botColor);
          if (die === null) return;
          setState((prev) => {
            if (prev.turn !== botColor || prev.phase !== "opening_roll") return prev;
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
  }, [state, botColor, getOpeningDie, getTurnDice, setTurnColor]);

  // ── Human actions ──────────────────────────────────────────────

  const rollDice = useCallback(() => {
    const current = stateRef.current;
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
            if (prev.phase !== "opening_roll" || prev.turn !== color) return prev;
            const next = applyOpeningRoll(prev, prev.turn, die);
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
            setTurnColor(next.turn);
            return next;
          });
          return;
        }
        if (current.phase === "rolling") {
          const dice = await getTurnDice();
          if (!dice) return;
          setState((prev) => {
            if (prev.phase !== "rolling") return prev;
            const rolled = applyRoll(prev, dice);
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
                  if (!cur || cur.phase !== "moving" || cur.turn !== rolled.turn) return cur;
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
  }, [getOpeningDie, getTurnDice, setTurnColor]);

  const makeMove = useCallback((from: Source, to: Target) => {
    setState((prev) => {
      if (prev.phase !== "moving") return prev;
      if (prev.turn !== playerColorRef.current) return prev;
      const dest = to === OFF ? OFF : to;
      const moves = allLegalMoves(prev, prev.turn);
      const match = moves.find(
        (m: Move) => m.from === from && (dest === OFF ? m.to === OFF : m.to === dest),
      );
      if (!match) return prev;
      const next = applyMove(prev, match, prev.turn);
      setTurnColor(next.turn);
      return next;
    });
  }, [setTurnColor]);

  const offerDoubleAction = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== "rolling") return prev;
      return offerDouble(prev, prev.turn);
    });
  }, []);

  const respondToDouble = useCallback((accept: boolean) => {
    setState((prev) => {
      const next = respondDouble(prev, accept);
      if (next.phase !== "game_over") setTurnColor(next.turn);
      return next;
    });
  }, [setTurnColor]);

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
        offerDouble: offerDoubleAction,
        respondToDouble,
        endTurn,
        undoMove,
        giveUp: () => {},
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
