import {
  Routes,
  Route,
  Navigate,
  useParams,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { getAccessToken, clearTokens, isTokenExpired } from "./services/auth";
import { clearRoom } from "./services/roomStorage";
import AuthScreen from "./components/AuthScreen";
import HomeScreen from "./components/HomeScreen";
import WaitingRoom from "./components/WaitingRoom";
import GameScreen from "./components/GameScreen";
import LinkEntry from "./components/LinkEntry";
import MatchDetail from "./components/MatchDetail";
import MatchHistory from "./components/MatchHistory";
import { GameProvider } from "./services/gameContext";
import { LocalGameProvider } from "./services/localGameContext";
import { parseTimeControl } from "./lib/clock";
import type { Color } from "./types/game";

const configuredTournamentsUrl =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_TOURNAMENTS_URL?.trim();
const TOURNAMENTS_URL = configuredTournamentsUrl || "/tournaments/";

function safeTournamentReturnUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const base = new URL(TOURNAMENTS_URL, window.location.origin);
    const next = new URL(value, window.location.origin);
    const basePath = base.pathname.replace(/\/+$/, "") || "/";
    const isWithinBase =
      next.pathname === basePath || next.pathname.startsWith(`${basePath}/`);
    return next.origin === base.origin && isWithinBase ? next : null;
  } catch {
    return null;
  }
}

function tournamentLobbyUrl(tournamentId: string | null): URL | null {
  // A tournament ticket normally carries a `return` URL.  Keep the tournament
  // context as a fallback, though: older/partially migrated links may carry
  // only the tournament id.  Those players must never be sent to the game's
  // own home screen after the match ends.
  if (!tournamentId || tournamentId === "0") return null;
  return new URL(TOURNAMENTS_URL, window.location.origin);
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

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const token = getAccessToken();
  if (token && isTokenExpired(token)) {
    clearTokens();
    return <>{children}</>;
  }
  if (token) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function GameRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const playerColor =
    (new URLSearchParams(location.search).get("color") as Color) || "white";
  const params = new URLSearchParams(location.search);
  const tournamentId = params.get("tournament");
  const returnUrl =
    safeTournamentReturnUrl(params.get("return")) ??
    tournamentLobbyUrl(tournamentId);

  function handleLeave(outcome?: "won" | "lost") {
    clearRoom();
    if (returnUrl) {
      const next = new URL(returnUrl);
      if (outcome) next.searchParams.set("matchResult", outcome);
      if (tournamentId) next.searchParams.set("tournament", tournamentId);
      window.location.assign(next.toString());
      return;
    }
    navigate("/home", { replace: true });
  }

  return (
    <GameProvider
      roomId={roomId || ""}
      playerColor={playerColor}
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
        homeLabel={returnUrl ? "Back to Tournament" : undefined}
      />
    </GameProvider>
  );
}

function LocalRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const botParam = params.get("bot");
  const targetParam = params.get("target");
  const timeParam = params.get("time");
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
  return (
    <LocalGameProvider
      botColor={botColor}
      matchTarget={matchTarget}
      timeControl={timeControl}
      onQuitMatch={() => navigate("/home", { replace: true })}
    >
      <GameScreen onLeave={() => navigate("/home", { replace: true })} />
    </LocalGameProvider>
  );
}

export default function Router() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RedirectIfAuthed>
            <AuthScreen />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/home"
        element={
          <RequireAuth>
            <HomeScreen />
          </RequireAuth>
        }
      />
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
