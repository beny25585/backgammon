import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, storeTokens } from "../../services/auth";
import styles from "./AuthScreen.module.css";

export default function AuthScreen() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tokens = isLogin
        ? await login(username, password)
        : await register(username, password);
      storeTokens(tokens);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setIsLogin(!isLogin);
    setError("");
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Backgammon</h1>

        <div className={styles.tabs}>
          <button
            onClick={() => !isLogin && switchMode()}
            className={`${styles.tab} ${isLogin ? styles.tabActive : ""}`}
          >
            Log In
          </button>
          <button
            onClick={() => isLogin && switchMode()}
            className={`${styles.tab} ${!isLogin ? styles.tabActive : ""}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={styles.input}
            required
            minLength={3}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            required
            minLength={4}
          />
          {!isLogin && (
            <input
              type="password"
              placeholder="Confirm password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className={styles.input}
              required
              minLength={4}
            />
          )}
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className={styles.submit}
          >
            {loading ? "Please wait..." : isLogin ? "Log In" : "Register"}
          </button>
        </form>
      </div>
    </div>
  );
}
