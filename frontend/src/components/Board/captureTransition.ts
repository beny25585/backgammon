import { BAR, type Color, type GameState, type Source } from "@/lib/backgammon/engine";

interface CaptureTransition {
  mover: Color;
  victim: Color;
  targets: number[];
  attackingMove?: { from: Source; to: number };
}

/** Resolve captures from the state already displayed, even when a forced pass clears lastMove. */
export function captureTransition(before: GameState, after: GameState): CaptureTransition | null {
  const mover = before.turn;
  const victim = mover === "white" ? "black" : "white";
  const sign = mover === "white" ? 1 : -1;
  const added = after.bar[victim] - before.bar[victim];
  if (added <= 0 || before.home[victim] !== after.home[victim]) return null;

  const sameTurn = after.turn === mover && after.phase === "moving" &&
    (before.phase === "moving" || before.phase === "rolling");
  const forcedPass = after.turn === victim && before.phase === "moving" &&
    after.phase === "rolling" && !after.lastMove?.length;
  if (!sameTurn && !forcedPass) return null;

  const targets: number[] = [];
  for (let point = 0; point < before.points.length; point++) {
    const previous = before.points[point];
    const current = after.points[point];
    if (previous === current) continue;
    if (current * sign < 0 || previous * sign < -1) return null;
    if (previous === -sign) targets.push(point);
  }
  if (targets.length !== added) return null;

  const result: CaptureTransition = { mover, victim, targets };
  const earlier = before.lastMove ?? [];
  const moves = after.lastMove ?? [];
  const suffix = earlier.every((move, index) => moves[index]?.from === move.from && moves[index]?.to === move.to)
    ? moves.slice(earlier.length)
    : [];
  const hitOrder = targets.map(point => ({ point, index: suffix.findIndex(move => move.to === point) }));
  if (hitOrder.every(hit => hit.index >= 0)) {
    result.targets = hitOrder.sort((a, b) => a.index - b.index).map(hit => hit.point);
    const last = suffix[suffix.length - 1];
    if (typeof last.to === "number" && hitOrder[hitOrder.length - 1].index === suffix.length - 1 &&
        after.points[last.to] === sign) {
      result.attackingMove = { from: last.from, to: last.to };
    }
    return result;
  }

  // If the move log is missing, animate the attacker only when a single origin
  // and a single hit explain the entire board change.
  if (targets.length !== 1 || suffix.length || before.home[mover] !== after.home[mover]) return result;
  const [to] = targets;
  if (after.points[to] !== sign) return result;
  const sources = before.points.flatMap((value, point) => point !== to && value !== after.points[point] ? [point] : []);
  const movedFromBar = before.bar[mover] - after.bar[mover];
  if (movedFromBar === 1 && sources.length === 0) {
    result.attackingMove = { from: BAR, to };
  } else if (movedFromBar === 0 && sources.length === 1) {
    const [from] = sources;
    if (before.points[from] * sign > 0 && after.points[from] === before.points[from] - sign) {
      result.attackingMove = { from, to };
    }
  }
  return result;
}
