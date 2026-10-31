import { useState, useMemo } from "react";
import { newGame, applyMove, BAR, OFF } from "@/lib/backgammon/engine";
import { Board } from "@/components/Board";
import type { Color, GameState, Move, Phase } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";

interface ApiMove {
  from: number | string;
  to: number | string;
}

interface TurnEntry {
  kind?: "blocked_pass";
  turn: string;
  roll: number[];
  moves: ApiMove[];
}

function computeDie(from: number | string, to: number | string, color: Color): number {
  if (from === BAR) {
    return color === "white" ? 24 - (to as number) : (to as number) + 1;
  }
  if (to === OFF) {
    return color === "white" ? (from as number) + 1 : 24 - (from as number);
  }
  return Math.abs((from as number) - (to as number));
}

export default function ReplayPlayer({ transcript }: { transcript: TurnEntry[] }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);

  const boardState = useMemo(() => {
    let state: GameState = newGame();
    for (let i = 0; i < Math.min(step, transcript.length); i++) {
      const turn = transcript[i];
      const turnColor = turn.turn as Color;
      if (turn.kind === "blocked_pass") {
        state = {
          ...state, turn: turnColor === "white" ? "black" : "white", phase: "rolling",
          dice: [], remaining: [], lastMove: null, moveHistory: null,
        };
        continue;
      }
      state = {
        ...state,
        dice: turn.roll,
        remaining: [...turn.roll],
        phase: "moving" as Phase,
        turn: turnColor,
        message: "",
        lastMove: null,
        moveHistory: null,
      };
      for (const move of turn.moves) {
        const die = computeDie(move.from, move.to, turnColor);
        state = applyMove(state, { from: move.from, to: move.to, die } as Move, turnColor);
      }
    }
    return state;
  }, [step, transcript]);

  const current = step > 0 && step <= transcript.length ? transcript[step - 1] : null;
  const turnInfo = current
    ? t(current.kind === "blocked_pass" ? "match.replayBlockedPass" : "match.replayRolled", {
      turn: step, player: t(`common.${current.turn}`), dice: current.roll.join(", "),
    })
    : t("match.replayStart");

  return (
    <div className="replayContainer">
      <Board
        state={boardState}
        myColor="white"
        selected={null}
        legalTargets={[]}
        legalFromPoints={[]}
        onSelect={() => {}}
        onMove={() => {}}
      />
      <div className="replayControls" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem", marginTop: "0.75rem" }}>
        <button
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          style={{
            background: "rgba(201, 169, 97, 0.1)",
            border: "1px solid rgba(201, 169, 97, 0.3)",
            color: "#c9a961",
            padding: "0.4rem 1rem",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.8rem",
          }}
        >
          {t("match.replayBack")}
        </button>
        <span style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "0.85rem" }}>
          {turnInfo}
        </span>
        <button
          onClick={() => setStep(Math.min(transcript.length, step + 1))}
          disabled={step >= transcript.length}
          style={{
            background: "rgba(201, 169, 97, 0.1)",
            border: "1px solid rgba(201, 169, 97, 0.3)",
            color: "#c9a961",
            padding: "0.4rem 1rem",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.8rem",
          }}
        >
          {t("match.replayForward")}
        </button>
      </div>
    </div>
  );
}
