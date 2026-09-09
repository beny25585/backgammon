import { useEffect, useRef, useState } from "react";
import type { PointerEvent, MouseEvent, RefObject } from "react";
import { BAR, OFF, legalMovesFrom } from "@/lib/backgammon/engine";
import type { Color, GameState, Source, Target } from "@/lib/backgammon/engine";

interface Drag {
  pointerId: number;
  from: Source;
  color: Color;
  startX: number;
  startY: number;
  x: number;
  y: number;
  size: number;
  boardLeft: number;
  boardTop: number;
  active: boolean;
  state: GameState;
}

export function useCheckerDrag({ state, myColor, blocked, legalFromPoints, boardRef, wrapperRef, onDrop }: {
  state: GameState;
  myColor: Color | null;
  blocked: boolean;
  legalFromPoints: Source[];
  boardRef: RefObject<HTMLDivElement>;
  wrapperRef: RefObject<HTMLDivElement>;
  onDrop: (from: Source, to: Target, origin: { x: number; y: number }) => void;
}) {
  const pending = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  function clear() {
    const pointerId = pending.current?.pointerId;
    pending.current = null;
    setDrag(null);
    if (pointerId !== undefined && boardRef.current?.hasPointerCapture(pointerId)) {
      boardRef.current.releasePointerCapture(pointerId);
    }
  }

  // Never submit a gesture started against an older position or turn.
  useEffect(() => {
    if (pending.current && (pending.current.state !== state || blocked || pending.current.color !== myColor)) {
      clear();
    }
  }, [state, blocked, myColor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cancel = () => clear();
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", keyDown);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", keyDown);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const targets = drag ? legalMovesFrom(state, drag.from, drag.color).map(move => move.to) : [];

  return {
    drag,
    targets,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!event.isPrimary || event.button !== 0 || pending.current) return;
        suppressClick.current = false;
        if (blocked || !myColor || state.turn !== myColor || state.phase !== "moving") return;
        const checker = (event.target as HTMLElement).closest<HTMLElement>("[data-checker]");
        const cell = checker?.closest<HTMLElement>("[data-point-idx]");
        if (!checker || !cell || checker.dataset.checkerColor !== myColor) return;
        const location = cell.dataset.pointIdx;
        if (location === OFF || location === undefined) return;
        const from: Source = location === BAR ? BAR : Number(location);
        if (!legalFromPoints.includes(from)) return;
        const bounds = wrapperRef.current!.getBoundingClientRect();
        pending.current = {
          pointerId: event.pointerId, from, color: myColor,
          startX: event.clientX, startY: event.clientY,
          x: event.clientX, y: event.clientY,
          size: checker.getBoundingClientRect().width, active: false, state,
          boardLeft: bounds.left, boardTop: bounds.top,
        };
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const current = pending.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (current.state !== state || blocked) { clear(); return; }
        if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
        event.preventDefault();
        if (!current.active) {
          event.currentTarget.setPointerCapture(event.pointerId);
          suppressClick.current = true;
        }
        pending.current = { ...current, active: true, x: event.clientX, y: event.clientY };
        setDrag(pending.current);
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        const current = pending.current;
        if (!current || current.pointerId !== event.pointerId) return;
        clear();
        if (!current.active) return;
        event.preventDefault();
        if (current.state !== state || blocked || state.turn !== myColor || current.color !== myColor) return;
        const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-point-idx]");
        if (!cell || !boardRef.current?.contains(cell)) return;
        const location = cell.dataset.pointIdx;
        if (location === BAR || location === undefined) return;
        const to: Target = location === OFF ? OFF : Number(location);
        if (legalMovesFrom(state, current.from, current.color).some(move => move.to === to)) {
          onDrop(current.from, to, { x: event.clientX, y: event.clientY });
        }
      },
      onPointerCancel(event: PointerEvent<HTMLDivElement>) {
        if (pending.current?.pointerId === event.pointerId) clear();
      },
      onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
        if (pending.current?.pointerId === event.pointerId) clear();
      },
      onClickCapture(event: MouseEvent<HTMLDivElement>) {
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
