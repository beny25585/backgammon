import { useState } from "react";
import { useAuth } from "../../services/authContext";
import { joinRoom, createRoom } from "@/services/api";

interface RoomResponse {
  id: string;
  code: string;
  status: string;
  white_player: { id: number; username: string } | null;
  black_player: { id: number; username: string } | null;
}

export default function LobbyPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [code, setCode] = useState("");
  const [createdRoom, setCreatedRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const room = await createRoom();
      setCreatedRoom(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    setError("");
    setLoading(true);
    try {
      const room = await joinRoom(code);
      window.location.href = `/game/${room.code}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  function handlePlay() {
    if (createdRoom) {
      window.location.href = `/game/${createdRoom.code}`;
    }
  }

  function copyCode() {
    if (createdRoom) {
      navigator.clipboard.writeText(createdRoom.code);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-[#0a0a0a] to-[#1a1a1a] p-4">
      <div className="bg-checker-black rounded-2xl p-8 w-full max-w-md shadow-2xl border border-gold/30">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gold">Backgammon</h1>
          <div className="flex items-center gap-3">
            <span className="text-gold/60 text-sm">{user?.username}</span>
            <button
              onClick={logout}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Logout
            </button>
          </div>
        </div>

        {createdRoom ? (
          <div className="text-center space-y-4">
            <p className="text-gold">Room created!</p>
            <div
              onClick={copyCode}
              className="text-4xl font-bold text-white bg-black/40 rounded-lg py-4 cursor-pointer hover:bg-black/60 transition"
            >
              {createdRoom.code}
            </div>
            <p className="text-gold/60 text-sm">
              Click code to copy. Share it with your opponent.
            </p>
            <button
              onClick={handlePlay}
              className="w-full py-3 rounded-lg bg-linear-to-r from-gold to-[#b8860b] text-black font-bold"
            >
              Play
            </button>
          </div>
        ) : (
          <>
            <div className="flex mb-6 bg-black/30 rounded-lg p-1">
              <button
                onClick={() => setTab("create")}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                  tab === "create" ? "bg-gold text-black" : "text-gold/60"
                }`}
              >
                Create Room
              </button>
              <button
                onClick={() => setTab("join")}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                  tab === "join" ? "bg-gold text-black" : "text-gold/60"
                }`}
              >
                Join Room
              </button>
            </div>

            {tab === "create" ? (
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full py-3 rounded-lg bg-linear-to-r from-gold to-[#b8860b] text-black font-bold hover:brightness-110 transition disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create New Room"}
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleJoin();
                }}
                className="space-y-4"
              >
                <input
                  type="text"
                  placeholder="Enter room code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 rounded-lg bg-black/40 border border-gold/20 text-white text-center text-2xl tracking-widest placeholder:text-base focus:outline-none focus:border-gold uppercase"
                  maxLength={6}
                  required
                />
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full py-3 rounded-lg bg-linear-to-r from-gold to-[#b8860b] text-black font-bold hover:brightness-110 transition disabled:opacity-50"
                >
                  {loading ? "Joining..." : "Join Room"}
                </button>
              </form>
            )}

            {error && (
              <p className="text-red-400 text-sm text-center mt-4">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
