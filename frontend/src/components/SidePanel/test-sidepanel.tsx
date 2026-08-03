import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { GameContext } from "../../services/gameContext";
import { newGame } from "../../lib/backgammon/engine";
import SidePanel from "./SidePanel";
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
  (state as unknown as Record<string, unknown>).whiteScore = 2;
  (state as unknown as Record<string, unknown>).blackScore = 3;
  (state as unknown as Record<string, unknown>).targetPoints = 7;
  return state;
}

const mock: GameContextType = {
  state: makeState(),
  playerColor: "white",
  whiteName: null,
  blackName: null,
  isLoading: false,
  error: null,
  openingRollResult: null,
  setOpeningRollResult: () => {},
  reconnected: false,
  opponentConnected: true,
  gameResult: null,
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

function Test() {
  const yourTurn = makeState();
  yourTurn.turn = "white";

  const opponentTurn = makeState();
  opponentTurn.turn = "black";

  return (
    <MemoryRouter>
      <GameContext.Provider value={mock}>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", padding: 20, background: "#0a0a0a" }}>
          <div style={{ width: 300 }}>
            <div style={{ color: "#f7f1e7", fontFamily: "system-ui", marginBottom: 8, fontSize: 13, fontWeight: 700 }}>
              Your turn
            </div>
            <SidePanel state={yourTurn} playerColor="white" onLeave={() => {}} />
          </div>
          <div style={{ width: 300 }}>
            <div style={{ color: "#f7f1e7", fontFamily: "system-ui", marginBottom: 8, fontSize: 13, fontWeight: 700 }}>
              Opponent's turn
            </div>
            <SidePanel state={opponentTurn} playerColor="white" onLeave={() => {}} />
          </div>
        </div>
      </GameContext.Provider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")!).render(<Test />);
