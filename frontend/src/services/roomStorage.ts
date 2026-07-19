import type { Color } from "../types/game";

export interface StoredRoom {
  roomId: string;
  roomCode: string;
  playerColor: Color;
  status: "waiting" | "playing";
}

const KEY = "bg_active_room";

export function saveRoom(room: StoredRoom): void {
  localStorage.setItem(KEY, JSON.stringify(room));
}

export function getRoom(): StoredRoom | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredRoom;
  } catch {
    return null;
  }
}

export function clearRoom(): void {
  localStorage.removeItem(KEY);
}

export function updateRoomStatus(status: "waiting" | "playing"): void {
  const room = getRoom();
  if (room) {
    saveRoom({ ...room, status });
  }
}
