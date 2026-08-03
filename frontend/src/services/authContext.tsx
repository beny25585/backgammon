import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { clientLogger } from "./logger";

interface User {
  id: number;
  username: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = (import.meta.env.VITE_SERVER_URL || "") + "/api";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("bg_access_token"),
  );

  const isAuthenticated = !!token && !!user;

  const storeSession = (access: string, refresh: string, user: User) => {
    localStorage.setItem("bg_access_token", access);
    localStorage.setItem("bg_refresh_token", refresh);
    localStorage.setItem("user", JSON.stringify(user));
    setToken(access);
    setUser(user);
  };

  const login = useCallback(
    async (username: string, password: string) => {
      clientLogger.info("Login attempt", { username });
      const res = await fetch(`${API_BASE}/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        clientLogger.error("Login failed", { username, status: res.status, detail: data.detail });
        throw new Error(data.detail || "Login failed");
      }
      const payload = JSON.parse(atob(data.access.split(".")[1]));
      const user: User = { id: payload.user_id, username };
      clientLogger.info("Login success", { username, userId: user.id });
      storeSession(data.access, data.refresh, user);
    },
    [],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      clientLogger.info("Register attempt", { username });
      const res = await fetch(`${API_BASE}/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, password2: password }),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg: string;
        try {
          const data = JSON.parse(text);
          msg = typeof data === "object"
            ? Object.values(data).flat().join(", ")
            : "Registration failed";
        } catch {
          msg = `Registration failed (${res.status}): ${text.slice(0, 200)}`;
        }
        clientLogger.error("Register failed", { username, status: res.status, response: text.slice(0, 300) });
        throw new Error(msg);
      }
      const data = JSON.parse(text);
      clientLogger.info("Register success", { username, userId: data.user?.id });
      storeSession(data.access, data.refresh, data.user);
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("bg_access_token");
    localStorage.removeItem("bg_refresh_token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, isAuthenticated, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
