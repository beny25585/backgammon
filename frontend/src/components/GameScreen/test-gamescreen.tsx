/* eslint-disable react-refresh/only-export-components */
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { GameContext } from "../../services/gameContext";
import { newGame } from "../../lib/backgammon/engine";
import GameScreen from "./GameScreen";
import type { GameContextType } from "../../types/context";
import "../../styles/global.css";

function makeState() {
  const state = newGame();
  state.phase = "moving";
  state.turn = "white";
  state.dice = [4, 3];
  state.remaining = [4, 3];
  state.home = { white: 5, black: 8 };
  state.bar = { white: 1, black: 0 };
  return state;
}

function makeMock(): GameContextType {
  return {
    state: makeState(),
    playerColor: "black",
    whiteName: null,
    blackName: null,
    isLoading: false,
    error: null,
    openingRollResult: null,
    setOpeningRollResult: () => {},
    reconnected: false,
    opponentConnected: false,
    timeControl: null,
    clock: null,
    turnStartedAt: null,
    gameResult: null,
    matchScore: null,
    handleNextGame: () => {},
    handleHome: () => {},
    updateState: () => {},
    makeMove: () => {},
    rollDice: () => {},
    offerDouble: () => {},
    respondToDouble: () => {},
    endTurn: () => {},
    undoMove: () => {},
    giveUp: () => {},
    noMovesMessage: null,
  };
}

function Game() {
  return (
    <MemoryRouter>
      <GameContext.Provider value={makeMock()}>
        <GameScreen />
      </GameContext.Provider>
    </MemoryRouter>
  );
}

const isEmbed = new URLSearchParams(window.location.search).has("embed");

if (isEmbed) {
  createRoot(document.getElementById("root")!).render(<Game />);
} else {
  const viewports: { label: string; w: number; h: number }[] = [
    { label: "Desktop 1440×900", w: 1440, h: 900 },
    { label: "Tablet 820×1180", w: 820, h: 1180 },
    { label: "Mobile portrait 390×844", w: 390, h: 844 },
    { label: "Mobile landscape 844×390", w: 844, h: 390 },
  ];

  createRoot(document.getElementById("root")!).render(
    <div style={{ background: "#0a0a0a", minHeight: "100vh", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ color: "#f7f1e7", marginBottom: 16, fontSize: 13, lineHeight: 1.6 }}>
        You are Black. Opponent (White) is disconnected and it&apos;s their turn. Check each viewport:
        <ul style={{ marginTop: 4, paddingLeft: 20 }}>
          <li>Banner "Opponent disconnected — you can keep playing" shows and does NOT block the board</li>
          <li>White&apos;s dice [4][3] are visible to you</li>
          <li>Board + side panel layout fits, no overflow, panel stacks below board on mobile</li>
        </ul>
      </div>
      {viewports.map((v) => (
        <div key={v.label} style={{ marginBottom: 24 }}>
          <div style={{ color: "rgba(247,241,231,0.6)", marginBottom: 8, fontSize: 12, fontWeight: 700 }}>
            {v.label}
          </div>
          <iframe
            src={`./test-gamescreen.html?embed`}
            style={{ width: v.w, height: v.h, border: "1px solid rgba(231,189,114,0.3)", borderRadius: 12, background: "#0a0a0a" }}
          />
        </div>
      ))}
    </div>,
  );
}
