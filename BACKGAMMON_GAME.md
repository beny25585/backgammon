# Backgammon Game MVP (Online Real-Time)

**Status:** MVP Phase 1  
**Focus:** Game only (no auth, no home, no profile)

---

# 🎯 Scope

This document defines the **minimum complete product** for a playable online Backgammon game.

## ❌ Not included (for now)

- Google login
- Home screen
- Profile system
- Match history
- Leaderboards
- Settings
- Notifications
- Splash screen

---

## ✅ Included (MVP)

- Single Game Screen
- Real-time multiplayer (2 players)
- Full Backgammon rules
- Doubling cube
- Dice system
- Turn system
- Game engine (authoritative)
- Board UI + animations

---

# 🎮 Game Screen (Single Screen App)

The entire application exists inside one screen:

```
┌──────────────────────────────┐
│ Opponent Status / Score      │
├──────────────────────────────┤
│                              │
│        BACKGAMMON BOARD      │
│                              │
├──────────────────────────────┤
│ Dice | Doubling Cube | Turn  │
└──────────────────────────────┘
```

---

# 🧠 Core Architecture

## Server Authoritative Model

The server (or game engine) is the single source of truth.

Flow:

```
Client Action
    ↓
Server Function
    ↓
Game Engine Validation
    ↓
State Update
    ↓
Realtime Broadcast
    ↓
UI Update
```

---

## Pure Game Engine

The engine is fully stateless:

```ts
nextState = applyMove(state, move)
```

### Rules:
- No side effects
- No UI logic
- No server dependency
- Fully testable

---

# 🧩 Game State

```ts
type GameState = {
  board: number[] // 24 points
  bar: {
    white: number
    black: number
  }
  home: {
    white: number
    black: number
  }

  currentTurn: "white" | "black"

  dice: number[]
  movesLeft: number[]

  phase:
    | "ROLLING"
    | "MOVING"
    | "DOUBLING"
    | "GAME_OVER"

  doublingCube: number
  cubeOwner: "white" | "black" | "center"

  winner?: "white" | "black"

  version: number
}
```

---

# 🎲 Game Rules

## Movement Rules
- Standard Backgammon movement
- Dice-based movement
- Must use all possible moves
- Blocked points are invalid

---

## Bar Rule
- If a checker is on the bar:
  - Must re-enter first
  - No other moves allowed until entry

---

## Bearing Off
- Allowed only when all 15 checkers are in home board
- Exact dice or higher rules apply

---

## Doubling Cube
- Starts at 1 in center
- Player can offer double before rolling
- Opponent can:
  - Accept → cube switches owner
  - Decline → loses game

---

## Winning Conditions

- Normal win = 1 point
- Gammon = 2 points (opponent has no checkers off)
- Backgammon = 3 points (opponent on bar or home board trapped)

---

# 🧠 Game Engine Modules

```
engine/
│
├── engine.ts
├── board.ts
├── moves.ts
├── dice.ts
├── bar.ts
├── bearingOff.ts
├── capture.ts
├── doubling.ts
├── scoring.ts
├── validation.ts
├── types.ts
```

---

## Engine Rules

- Fully pure functions
- No mutations
- No UI logic
- Deterministic output

---

# 🔁 State Machine

```ts
type Phase =
  | "ROLLING"
  | "MOVING"
  | "DOUBLING"
  | "GAME_OVER"
```

Flow:

```
ROLLING → MOVING → END TURN → ROLLING
                     ↓
                DOUBLING (optional)
                     ↓
                GAME_OVER
```

---

# 🌐 Real-Time System

## Channel
```
room:{roomId}
```

## Events

- state_update
- move_made
- dice_rolled
- double_offered
- double_response
- game_finished

---

# 🎨 Design System

## Core Theme

### Colors

```css
--board-frame: #3d2817
--board-felt: #8b5a2b
--point-light: #d4a574
--point-dark: #3d2817
--checker-white: #f4e4c1
--checker-black: #2a1810
--gold: #c9a961
```

---

## UI Tokens

```css
--background: deep dark wood
--foreground: warm cream
--primary: gold accent
--muted: soft brown
--border: semi-transparent wood tone
```

---

## Motion System

```css
--ease-game: cubic-bezier(.2,.7,.2,1)
--duration-fast: 150ms
--duration-normal: 300ms
```

---

## Animations

- Dice roll → spin + bounce
- Checker move → smooth slide
- Capture → pop + fade
- Turn change → glow shift
- Legal move → pulse highlight

---

# 🧱 UI Structure

```
GameScreen
│
├── OpponentBar
├── Board
│   ├── Point (x24)
│   ├── Checker
│
├── Dice
├── DoublingCube
├── TurnIndicator
└── Controls
    ├── Roll
    ├── End Turn
    ├── Double
```

---

# 🎯 Interaction Model

## Checker Selection
1. Click checker
2. Show legal moves
3. Highlight valid points
4. Click destination → move executed

---

## Drag Support (optional)
- Drag checker to point
- Snap to valid positions
- Reject invalid drops

---

# 🎲 Dice System

- Animated roll
- 2 dice
- Doubles = 4 moves
- Must consume all moves if possible

---

# 🧠 Validation Rules

All validation happens in engine:

- Legal move check
- Bar priority check
- Bearing off rules
- Dice usage validation
- Turn consistency

---

# 🧪 Testing Strategy

Must cover:

```
opening.test.ts
moves.test.ts
bar.test.ts
bearingOff.test.ts
capture.test.ts
doubling.test.ts
winConditions.test.ts
validation.test.ts
```

Goal: 100% engine coverage

---

# 🚀 MVP Success Criteria

The MVP is complete when:

- Two players can join a room
- Game runs fully end-to-end
- All Backgammon rules work
- No UI bugs in state sync
- No illegal moves possible
- Game can finish and declare winner

---

# 🔥 Key Principle

> The UI is just a renderer.  
> The engine is the truth.  
> The server is the authority.
```