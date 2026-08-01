import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import type { GameContextType, OpeningRollResult } from "../types/context";
import type { GameState, Color, Move } from "../types/game";
import { saveMatch } from "../services/api";
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
  type Source, type Target,
} from "@/lib/backgammon/engine";
import { chooseMove } from "@/lib/bot/chooseMove";
import { GameContext } from "./gameContext";
import GameResultOverlay from "../components/GameResultOverlay/GameResultOverlay";

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
  onQuitMatch?: () => void;
}

const BOT_DELAY = 2200;

export function LocalGameProvider({ children, botColor, matchTarget = 7, onQuitMatch }: LocalGameProviderProps) {
  const [state, setState] = useState<GameState>(() => newGame());
  const humanColor: Color = botColor ? (botColor === "white" ? "black" : "white") : "white";
  const [playerColor, setPlayerColor] = useState<Color>(humanColor);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);
  const [openingRollResult, setOpeningRollResult] = useState<OpeningRollResult | null>(null);
  const [noMovesMessage, setNoMovesMessage] = useState<{ dice: number[] } | null>(null);
  const [reconnected] = useState(false);
  const [opponentConnected] = useState(true);

  const setTurnColor = (color: Color) => {
    if (!botColor) setPlayerColor(color);
  };

  // ── Match tracking ─────────────────────────────────────────────

  const [matchScore, setMatchScore] = useState<Record<Color, number>>({ white: 0, black: 0 });
  const [matchWinner, setMatchWinner] = useState<Color | null>(null);
  const [gameResult, setGameResult] = useState<{
    winner: Color;
    winType: "single" | "gammon" | "backgammon";
    points: number;
    cube: number;
    matchScore: Record<Color, number>;
  } | null>(null);

  // Auto-advance to next game after 30s
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MATCH_TARGET = matchTarget;

  // Score game when it ends (uses state directly, no setState nesting)
  useEffect(() => {
    if (state.phase !== "game_over" || !state.winner) return;
    if (gameResult !== null) return;

    const base = state.winType === "single" ? 1 : state.winType === "gammon" ? 2 : 3;
    const points = base * (state.cube || 1);

    setGameResult({
      winner: state.winner,
      winType: state.winType || "single",
      points,
      cube: state.cube || 1,
      matchScore: { ...matchScore },
    });

    setMatchScore((prev) => {
      const next = { ...prev };
      next[state.winner!] += points;
      if (next[state.winner!] >= MATCH_TARGET) {
        setMatchWinner(state.winner!);
      }
      return next;
    });
  }, [state.phase]);

  // Auto-advance when game result is shown and match isn't over
  useEffect(() => {
    if (!gameResult) return;
    if (matchWinner) return;
    if (MATCH_TARGET <= 1) return; // single game, no auto-advance

    autoAdvanceTimer.current = setTimeout(() => {
      handleNextGame();
    }, 30000);

    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    };
  }, [gameResult, matchWinner]);

  // Auto-save match on completion (local/AI mode only — online mode saves server-side)
  useEffect(() => {
    if (!matchWinner) return;
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
  }, [matchWinner]);

  function handleNextGame() {
    setGameResult(null);
    setState(newGame());
    setTurnColor("white");
    setOpeningRollResult(null);
  }

  function handleHome() {
    setGameResult(null);
    setMatchWinner(null);
    setMatchScore({ white: 0, black: 0 });
    setState(newGame());
    setTurnColor("white");
    if (onQuitMatch) onQuitMatch();
  }

  // ── Bot turn automation ──────────────────────────────────────────

  useEffect(() => {
    if (!botColor) return;
    if (state.turn !== botColor) return;

    const timer = setTimeout(() => {
      setState((prev) => {
        if (prev.turn !== botColor) return prev;

        if (prev.phase === "opening_roll") {
          const next = applyOpeningRoll(prev, botColor);
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
        }

        if (prev.phase === "rolling") {
          const next = applyRoll(prev);
          setTurnColor(next.turn);
          return next;
        }

        if (prev.phase === "moving") {
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
        }

        return prev;
      });
    }, BOT_DELAY);

    return () => clearTimeout(timer);
  }, [state, botColor]);

  // ── Human actions ──────────────────────────────────────────────

  const rollDice = useCallback(() => {
    setState((prev) => {
      if (prev.phase === "opening_roll") {
        const next = applyOpeningRoll(prev, prev.turn);
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
      }
      if (prev.phase === "rolling") {
        const rolled = applyRoll(prev);
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
            setState((current) => {
              if (!current || current.phase !== "moving" || current.turn !== rolled.turn) return current;
              return passed;
            });
            setTurnColor(passed.turn);
          }, 1500);
        }
        return rolled;
      }
      return prev;
    });
  }, []);

  const makeMove = useCallback((from: Source, to: Target) => {
    setState((prev) => {
      if (prev.phase !== "moving") return prev;
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
  }, []);

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
  }, []);

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
  }, []);

  const undoMove = useCallback(() => {
    setState((prev) => {
      const restored = undoLastMove(prev);
      if (!restored) return prev;
      setTurnColor(restored.turn);
      return restored;
    });
  }, []);

  const updateState = useCallback((s: GameState) => setState(s), []);

  return (
    <GameContext.Provider
      value={{
        state,
        playerColor,
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
        giveUp: () => {},
      }}
    >
      {children}

      {gameResult && (
        <GameResultOverlay
          winner={gameResult.winner}
          winType={gameResult.winType}
          points={gameResult.points}
          cube={gameResult.cube}
          matchScore={matchScore}
          matchTarget={MATCH_TARGET}
          matchWinner={matchWinner}
          onNext={handleNextGame}
          onHome={handleHome}
        />
      )}
    </GameContext.Provider>
  );
}
