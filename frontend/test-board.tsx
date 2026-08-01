import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { GameContext } from "./src/services/gameContext";
import { newGame } from "./src/lib/backgammon/engine";
import GameBoard from "./src/components/GameScreen/GameBoard";
import styles from "./src/components/GameScreen/GameScreen.module.css";
import type { GameContextType } from "./src/types/context";
import "./src/styles/global.css";

const state = newGame();
state.phase = "moving";
state.turn = "white";
state.dice = [4, 3];
state.remaining = [4, 3];
state.home = { white: 3, black: 2 };
state.bar = { white: 1, black: 0 };

const mock: GameContextType = {
  state,
  playerColor: "white",
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
  return (
    <MemoryRouter>
      <GameContext.Provider value={mock}>
        <div className={styles.container}>
          <GameBoard
            state={state}
            playerColor="white"
            makeMove={() => {}}
            onLeave={() => {}}
          />
        </div>
      </GameContext.Provider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")!).render(<Test />);
