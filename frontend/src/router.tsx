import { Routes, Route, Navigate, useParams, useLocation, useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { getAccessToken } from "./services/auth";
import { clearRoom } from "./services/roomStorage";
import AuthScreen from "./components/AuthScreen";
import HomeScreen from "./components/HomeScreen";
import WaitingRoom from "./components/WaitingRoom";
import GameScreen from "./components/GameScreen";
import { GameProvider } from "./services/gameContext";
import { LocalGameProvider } from "./services/localGameContext";
import type { Color } from "./types/game";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getAccessToken()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  if (getAccessToken()) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function GameRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const playerColor = (new URLSearchParams(location.search).get("color") as Color) || "white";

  function handleLeave() {
    clearRoom();
    navigate("/home", { replace: true });
  }

  return (
    <GameProvider roomId={roomId || ""} playerColor={playerColor} serverUrl={import.meta.env.VITE_SERVER_URL}>
      <GameScreen onLeave={handleLeave} />
    </GameProvider>
  );
}

function LocalRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const botParam = params.get("bot");
  const targetParam = params.get("target");
  const botColor: Color | undefined = botParam === "white" || botParam === "black"
    ? botParam
    : undefined;
  const matchTarget = targetParam ? parseInt(targetParam, 10) : undefined;
  return (
    <LocalGameProvider botColor={botColor} matchTarget={matchTarget} onQuitMatch={() => navigate("/home", { replace: true })}>
      <GameScreen onLeave={() => navigate("/home", { replace: true })} />
    </LocalGameProvider>
  );
}

export default function Router() {
  return (
    <Routes>
      <Route path="/" element={<RedirectIfAuthed><AuthScreen /></RedirectIfAuthed>} />
      <Route path="/home" element={<RequireAuth><HomeScreen /></RequireAuth>} />
      <Route path="/waiting/:roomId" element={<RequireAuth><WaitingRoom /></RequireAuth>} />
      <Route path="/game/:roomId" element={<RequireAuth><GameRoute /></RequireAuth>} />
      <Route path="/local" element={<LocalRoute />} />
      <Route path="*" element={<Navigate to={getAccessToken() ? "/home" : "/"} replace />} />
    </Routes>
  );
}
