import { boardRect } from "../../Board/boardCoordinates";
import type { BoardSide } from "../../Board/BoardHalfOverlay";

export interface BoardDiceThrow {
  side: BoardSide;
  index: number;
}

export const BOARD_DICE_THROW_MS = 1080;

const SLIDE_START_MS = 900;
const SLIDE_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";
const FIELD_OBSTACLES = '[data-testid="turn-notice-details"], [data-testid="auto-roll-countdown"]';

function getPath(slot: HTMLElement, { side, index }: BoardDiceThrow) {
  const board = slot.closest('[data-testid="board-wrapper"]');
  const half = board?.querySelector(`[data-testid="board-half-${side}"]`);
  if (!(half instanceof HTMLElement)) return null;

  const field = boardRect(half);
  const slotRect = boardRect(slot);
  const scaleX = slotRect.width / slot.offsetWidth;
  const scaleY = slotRect.height / slot.offsetHeight;
  if (!scaleX || !scaleY || !field.width || !field.height) return null;

  // Measure the parked dice, whose boxes stay still while their contents move.
  const row = slot.closest('[data-testid="dice-overlay"]');
  const dice = Array.from(row?.querySelectorAll<HTMLElement>('[data-testid="die"]') ?? [])
    .slice(0, 2)
    .map(boardRect);
  if (dice.length === 0) return null;

  const positions = dice.map(die => ({
    x: die.left + die.width / 2,
    y: die.top + die.height / 2,
  }));
  const clearance = Math.max(slotRect.width, slotRect.height) * 0.59;
  const direction = side === "right" ? 1 : -1;
  const fieldEnd = field.left + field.width;
  const backwardRoom = Math.min(...positions.map(({ x }) => direction === 1 ? x - field.left : fieldEnd - x));
  const forwardRoom = Math.min(...positions.map(({ x }) => direction === 1 ? fieldEnd - x : x - field.left));
  const launchX = -direction * Math.min(field.width * 0.31, backwardRoom - clearance);
  const obstacles = Array.from(half.querySelectorAll<HTMLElement>("[data-checker-slot]"), boardRect);
  // Other overlays, such as a previous turn's notice, may occupy the playfield.
  obstacles.push(...Array.from(board?.querySelectorAll<HTMLElement>(FIELD_OBSTACLES) ?? [])
    .filter(element => !element.contains(slot) && element.getClientRects().length && getComputedStyle(element).visibility === "visible")
    .map(boardRect));

  const clear = (px: number, py: number) =>
    px >= field.left + clearance && px <= field.left + field.width - clearance &&
    py >= field.top + clearance && py <= field.top + field.height - clearance &&
    obstacles.every(obstacle =>
      px + clearance <= obstacle.left || px - clearance >= obstacle.left + obstacle.width ||
      py + clearance <= obstacle.top || py - clearance >= obstacle.top + obstacle.height,
    );

  const preferredY = slotRect.height * 0.24;
  for (const distance of [0.24, 0.18, 0.12]) {
    const landingX = direction * Math.min(field.width * distance, forwardRoom - clearance);
    if (Math.abs(landingX) < slotRect.width * 0.58 || backwardRoom <= clearance) continue;
    for (const spread of [preferredY, 0, -preferredY]) {
      // A common horizontal path keeps the dice apart. Check the bounces and glide
      // for both dice before committing either to the flight.
      const roomForDice = positions.every(({ x, y }, dieIndex) => {
        const dy = dieIndex === 0 ? -spread : spread;
        return [0.68, 0.93, 1].every(p => clear(x + launchX + (landingX - launchX) * p, y + dy * p)) &&
          [0, 0.25, 0.5, 0.75, 1].every(p => clear(x + landingX * p, y + dy * p));
      });
      if (!roomForDice) continue;
      return {
        launchX: launchX / scaleX,
        landingX: landingX / scaleX,
        landingY: (index === 0 ? -spread : spread) / scaleY,
        height: Math.min(slotRect.height * (index === 0 ? 1.28 : 1.02), field.height * 0.115) / scaleY,
      };
    }
  }
  return null;
}

export function animateBoardDiceFlight(
  slot: HTMLDivElement,
  cube: HTMLDivElement,
  shadow: HTMLSpanElement,
  placement: BoardDiceThrow,
  depth: string,
  rotateX: number,
  rotateY: number,
) {
  const path = getPath(slot, placement);
  if (!path) return null;

  const { launchX, landingX, landingY, height } = path;
  const flight = 695;
  const duration = BOARD_DICE_THROW_MS;
  const impact = flight / duration;
  const glide = SLIDE_START_MS / duration;
  const position = (progress: number, lift = 0) =>
    `translate(${launchX + (landingX - launchX) * progress}px,${landingY * progress - lift * height}px)`;
  const bounce = [
    { progress: 0, lift: 0.18, fraction: 0, shade: 0.45 },
    { progress: 0.35, lift: 1, fraction: 0.29, shade: 0.32 },
    { progress: 0.68, lift: 0, fraction: 0.55, shade: 0.9 },
    { progress: 0.82, lift: 0.35, fraction: 0.71, shade: 0.56 },
    { progress: 0.93, lift: 0, fraction: 0.88, shade: 0.96 },
    { progress: 1, lift: 0, fraction: 1, shade: 1 },
  ];
  const translateHome = [
    { transform: position(1), offset: glide, easing: SLIDE_EASING },
    { transform: "none", offset: 1 },
  ];
  const turns = placement.index % 2 === 0 ? 1 : -1;
  const rotation = (rx: number, ry: number, rz: number) =>
    `${depth} rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
  const faceUp = rotation(rotateX, rotateY, 0);
  const timing: KeyframeAnimationOptions = { duration, fill: "both", easing: "linear" };

  return [
    slot.animate(bounce.map(({ progress, lift, fraction }) => ({
      transform: position(progress, lift),
      offset: fraction * impact,
    })).concat(translateHome), timing),
    cube.animate([
      { transform: rotation(rotateX - turns * 720, rotateY - turns * 720, -turns * 360), offset: 0 },
      { transform: rotation(rotateX - turns * 380, rotateY - turns * 335, -turns * 190), offset: impact * 0.5 },
      { transform: faceUp, offset: impact },
      { transform: faceUp, offset: 1 },
    ], timing),
    shadow.animate(bounce.map(({ progress, lift, fraction, shade }) => ({
      transform: `${position(progress)} scale(${1 + lift * 0.3})`,
      opacity: shade,
      offset: fraction * impact,
    })).concat(translateHome.map(frame => ({ ...frame, opacity: 1 }))), timing),
  ];
}
