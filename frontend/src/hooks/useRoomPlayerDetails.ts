import { useCallback, useEffect, useState } from "react";
import { getRoomPlayerDetails } from "../services/api";
import type { RoomPlayerDetails } from "../types/playerDetails";

export function useRoomPlayerDetails(roomId?: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    roomId?: string;
    revision: number;
    data?: RoomPlayerDetails;
    unavailable?: boolean;
  }>({ revision: 0 });
  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setResult({ roomId, revision, unavailable: true });
    }, 8000);
    getRoomPlayerDetails(roomId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ roomId, revision, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ roomId, revision, unavailable: true });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [roomId, revision]);
  const current = result.roomId === roomId && result.revision === revision;
  return {
    players: current ? result.data?.players : undefined,
    loading: Boolean(roomId) && (!current || (!result.data && !result.unavailable)),
    unavailable: current && Boolean(result.unavailable),
    retry: useCallback(() => setRevision((value) => value + 1), []),
  };
}
