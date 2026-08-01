import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { login, register, storeTokens } from "../../services/auth";
import styles from "./AuthScreen.module.css";

const highlights = [
  {
    title: "Fast entry",
    text: "Get into a match in a few seconds, without a noisy setup.",
  },
  {
    title: "Clear states",
    text: "See login, register, and loading states at a glance.",
  },
  {
    title: "Same visual DNA",
    text: "Matches the homepage without copying it one-to-one.",
  },
];

export default function AuthScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState(
    searchParams.get("expired") === "1" ? "Session expired, please log in again" : "",
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!isLogin && password !== password2) {
        throw new Error("Passwords do not match");
      }

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

  const pointsTop = Array.from({ length: 12 }, (_, index) => index);
  const pointsBottom = Array.from({ length: 12 }, (_, index) => index);

  return (
    <main className={styles.container}>
      <div className={styles.glowA} />
      <div className={styles.glowB} />

      <section className={styles.shell}>
        <motion.aside
          className={styles.hero}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <p className={styles.kicker}>Backgammon club</p>
          <h1>
            Play with style.
            <br />
            Move with purpose.
          </h1>
          <p className={styles.heroText}>
            A calmer entrance into the game: quick to sign in, easy to scan,
            and shaped to feel like the rest of the app.
          </p>

          <div className={styles.highlights}>
            {highlights.map((item) => (
              <article key={item.title} className={styles.highlight}>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </article>
            ))}
          </div>

          <div className={styles.boardCard} aria-hidden="true">
            <div className={styles.boardHeader}>
              <span>Opening board</span>
              <span>2 players</span>
            </div>
            <div className={styles.board}>
              <div className={styles.pointsTop}>
                {pointsTop.map((index) => (
                  <span
                    key={`top-${index}`}
                    className={index % 2 === 0 ? styles.darkPoint : styles.lightPoint}
                  />
                ))}
              </div>
              <div className={styles.bar} />
              <div className={styles.pointsBottom}>
                {pointsBottom.map((index) => (
                  <span
                    key={`bottom-${index}`}
                    className={index % 2 === 0 ? styles.lightPoint : styles.darkPoint}
                  />
                ))}
              </div>
              <span className={`${styles.checker} ${styles.goldChecker} ${styles.checkerOne}`} />
              <span className={`${styles.checker} ${styles.goldChecker} ${styles.checkerTwo}`} />
              <span className={`${styles.checker} ${styles.darkChecker} ${styles.checkerThree}`} />
              <span className={`${styles.checker} ${styles.darkChecker} ${styles.checkerFour}`} />
            </div>
            <p className={styles.boardFooter}>
              Your next match, framed like a proper table game.
            </p>
          </div>
        </motion.aside>

        <motion.section
          className={styles.card}
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08 }}
        >
          <div className={styles.brandRow}>
            <span className={styles.brandMark}>B</span>
            <div>
              <p>Backgammon</p>
              <span>Secure sign in</span>
            </div>
          </div>

          <div className={styles.cardHeader}>
            <h2>{isLogin ? "Welcome back" : "Create your account"}</h2>
            <p>
              {isLogin
                ? "Use the same visual system as the rest of the app."
                : "Keep the same experience, just add a new player."}
            </p>
          </div>

          <div className={styles.tabs}>
            <button
              onClick={() => !isLogin && switchMode()}
              className={`${styles.tab} ${isLogin ? styles.tabActive : ""}`}
              type="button"
            >
              Log In
            </button>
            <button
              onClick={() => isLogin && switchMode()}
              className={`${styles.tab} ${!isLogin ? styles.tabActive : ""}`}
              type="button"
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.field}>
              <span>Username</span>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className={styles.input}
                required
                minLength={3}
              />
            </label>

            <label className={styles.field}>
              <span>Password</span>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={styles.input}
                required
                minLength={4}
              />
            </label>

            {!isLogin && (
              <label className={styles.field}>
                <span>Confirm password</span>
                <input
                  type="password"
                  placeholder="Re-enter your password"
                  value={password2}
                  onChange={(event) => setPassword2(event.target.value)}
                  className={styles.input}
                  required
                  minLength={4}
                />
              </label>
            )}

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className={styles.submit}>
              {loading ? "Please wait..." : isLogin ? "Log In" : "Register"}
            </button>

            <p className={styles.helper}>
              {isLogin
                ? "New here? Switch to register and join the table."
                : "Already have an account? Go back to log in."}
            </p>
          </form>
        </motion.section>
      </section>
    </main>
  );
}
