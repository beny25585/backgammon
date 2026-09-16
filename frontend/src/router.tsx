import {
  Routes,
  Route,
  Navigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { getAccessToken, clearTokens, isTokenExpired } from "./services/auth";
import { clearRoom } from "./services/roomStorage";

import WaitingRoom from "./components/WaitingRoom";
import GameScreen from "./components/GameScreen";
import LinkEntry from "./components/LinkEntry";
import MatchDetail from "./components/MatchDetail";
import MatchHistory from "./components/MatchHistory";
import { GameProvider } from "./services/gameContext";
import { LocalGameProvider } from "./services/localGameContext";
import { parseTimeControl } from "./lib/clock";
import type { Color } from "./types/game";
import { resolveGameType, isValidTournamentId } from "./routerGameType";

const configuredTournamentsUrl =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_TOURNAMENTS_URL?.trim();
const TOURNAMENTS_URL = configuredTournamentsUrl || "/tournaments/";

function safeTournamentReturnUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://localhost:5173";
    const base = new URL(TOURNAMENTS_URL, origin);
    const next = new URL(value, origin);
    const basePath = base.pathname.replace(/\/+$/, "") || "/";
    const isWithinBase =
      next.pathname === basePath || next.pathname.startsWith(`${basePath}/`);
    return next.origin === base.origin && isWithinBase ? next : null;
  } catch {
    return null;
  }
}

function tournamentLobbyUrl(): URL {
  const fallback = "/tournaments/";
  const target = TOURNAMENTS_URL || fallback;
  const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://localhost:5173";
  try {
    return new URL(target, origin);
  } catch {
    return new URL(fallback, origin);
  }
}

function returnToTournament() {
  window.location.assign(tournamentLobbyUrl().toString());
}

function RedirectToTournaments() {
  const url = tournamentLobbyUrl().toString();
  // Immediate redirect + effect fallback. Show fallback link if auto-redirect blocked.
  useEffect(() => {
    window.location.replace(url);
  }, [url]);
  if (typeof window !== "undefined" && window.location.href !== url) {
    // Kick redirect synchronously on mount (outside effect) for blank-screen case
    // Use timeout to avoid render-phase side-effect in StrictMode double-invoke
    setTimeout(() => {
      if (window.location.href !== url) window.location.replace(url);
    }, 0);
  }
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh", background: "#03090a", color: "#f0e3cd", padding: 24, textAlign: "center" }}>
      <div>
        <p style={{ marginBottom: 12 }}>Redirecting to tournaments…</p>
        <a href={url} style={{ color: "#e7bd72", textDecoration: "underline" }}>{url}</a>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getAccessToken();
  if (token && isTokenExpired(token)) {
    clearTokens();
    return <Navigate to="/?expired=1" replace />;
  }
  if (!token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export { resolveGameType, isValidTournamentId } from "./routerGameType";

function GameRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const playerColor =
    (new URLSearchParams(location.search).get("color") as Color) || "white";
  const params = new URLSearchParams(location.search);
  const tournamentId = params.get("tournament");
  const backendFormat = params.get("format");
  const gameType = resolveGameType(params, backendFormat);
  const tournamentReturnUrl = safeTournamentReturnUrl(params.get("return"));
  const returnUrl = tournamentReturnUrl ?? tournamentLobbyUrl();

  function handleLeave(outcome?: "won" | "lost") {
    clearRoom();
    let next: URL;
    try {
      next = new URL(returnUrl.toString());
    } catch {
      next = tournamentLobbyUrl();
    }
    if (outcome) next.searchParams.set("matchResult", outcome);
    if (isValidTournamentId(tournamentId)) next.searchParams.set("tournament", tournamentId!);
    window.location.assign(next.toString());
  }

  const isLinkedOneToOne =
    gameType === "1v1" && tournamentReturnUrl !== null;

  return (
    <GameProvider
      roomId={roomId || ""}
      playerColor={playerColor}
      gameType={gameType}
      serverUrl={
        (
          import.meta as ImportMeta & {
            env?: Record<string, string | undefined>;
          }
        ).env?.VITE_SERVER_URL
      }
    >
      <GameScreen
        onLeave={handleLeave}
        homeLabel={
          gameType === "tournament"
            ? "Back to Tournament"
            : isLinkedOneToOne
              ? "Back to Tournaments"
              : "Back to Lobby"
        }
        showRematch={!isLinkedOneToOne}
        gameType={gameType}
      />
    </GameProvider>
  );
}

function LocalRoute() {
  const [params] = useSearchParams();
  const botParam = params.get("bot");
  const targetParam = params.get("target");
  const timeParam = params.get("time");
  const modeParam = params.get("mode");
  const botColor: Color | undefined =
    botParam === "white" || botParam === "black" ? botParam : undefined;
  const parsedTarget = targetParam ? parseInt(targetParam, 10) : 7;
  const matchTarget = Number.isFinite(parsedTarget) && parsedTarget > 0
    ? parsedTarget
    : 7;
  const timeControl = useMemo(
    () => parseTimeControl(timeParam, matchTarget),
    [timeParam, matchTarget],
  );
  const localGameType: import("./types/context").GameType =
    modeParam === "quick" ? "quick" : modeParam === "tournament" ? "tournament" : botColor ? "1v1" : "quick";
  return (
    <LocalGameProvider
      botColor={botColor}
      matchTarget={matchTarget}
      timeControl={timeControl}
      gameType={localGameType}
      onQuitMatch={returnToTournament}
    >
      <GameScreen onLeave={returnToTournament} homeLabel={localGameType === "tournament" ? "Back to Tournament" : "Back to Lobby"} gameType={localGameType} />
    </LocalGameProvider>
  );
}

export default function Router() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToTournaments />} />
      <Route path="/home" element={<RedirectToTournaments />} />
      <Route
        path="/waiting/:roomId"
        element={
          <RequireAuth>
            <WaitingRoom />
          </RequireAuth>
        }
      />
      <Route
        path="/game/:roomId"
        element={
          <RequireAuth>
            <GameRoute />
          </RequireAuth>
        }
      />
      {/* Deliberately outside RequireAuth: arriving here with a ticket-issued session in
          the fragment is what establishes auth in the first place. */}
      <Route path="/link" element={<LinkEntry />} />
      <Route path="/local" element={<LocalRoute />} />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <MatchHistory />
          </RequireAuth>
        }
      />
      <Route
        path="/history/:id"
        element={
          <RequireAuth>
            <MatchDetail />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={<Navigate to={getAccessToken() ? "/home" : "/"} replace />}
      />
    </Routes>
  );
}
