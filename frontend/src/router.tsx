import {
  Routes,
  Route,
  useParams,
  useLocation,
} from "react-router-dom";
import { useSearchParams } from "react-router-dom";
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

function ReturnToTournaments() {
  window.location.replace(TOURNAMENTS_URL);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getAccessToken();
  if (token && isTokenExpired(token)) {
    clearTokens();
    return <ReturnToTournaments />;
  }
  if (!token) return <ReturnToTournaments />;
  return <>{children}</>;
}

function GameRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const playerColor =
    (new URLSearchParams(location.search).get("color") as Color) || "white";
  const params = new URLSearchParams(location.search);
  const returnUrl = safeTournamentReturnUrl(params.get("return"));
  const tournamentId = params.get("tournament");

  function handleLeave(outcome?: "won" | "lost") {
    clearRoom();
    if (returnUrl) {
      const next = new URL(returnUrl);
      if (outcome) next.searchParams.set("matchResult", outcome);
      if (tournamentId) next.searchParams.set("tournament", tournamentId);
      window.location.assign(next.toString());
      return;
    }
    window.location.assign(TOURNAMENTS_URL);
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
  const botParam = params.get("bot");
  const targetParam = params.get("target");
  const timeParam = params.get("time");
  const botColor: Color | undefined =
    botParam === "white" || botParam === "black" ? botParam : undefined;
  const matchTarget = targetParam ? parseInt(targetParam, 10) : undefined;
  return (
    <LocalGameProvider
      botColor={botColor}
      matchTarget={matchTarget}
      timeControl={parseTimeControl(timeParam)}
      onQuitMatch={() => window.location.assign(TOURNAMENTS_URL)}
    >
      <GameScreen onLeave={() => window.location.assign(TOURNAMENTS_URL)} />
    </LocalGameProvider>
  );
}

export default function Router() {
  return (
    <Routes>
      <Route path="/" element={<ReturnToTournaments />} />
      <Route path="/home" element={<ReturnToTournaments />} />
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
        element={<ReturnToTournaments />}
      />
    </Routes>
  );
}
