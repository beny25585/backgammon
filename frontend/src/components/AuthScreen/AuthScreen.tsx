import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { login, register, storeTokens } from "../../services/auth";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./AuthScreen.module.css";

export default function AuthScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState(() => {
    if (searchParams.get("expired") === "1")
      return t("auth.expired");
    if (searchParams.get("link") === "invalid")
      return t("auth.invalidLink");
    return "";
  });
  const [loading, setLoading] = useState(false);
  const highlights = [
    { title: t("auth.fastEntry"), text: t("auth.fastEntryText") },
    { title: t("auth.clearStates"), text: t("auth.clearStatesText") },
    { title: t("auth.sameVisual"), text: t("auth.sameVisualText") },
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!isLogin && password !== password2) {
        throw new Error(t("auth.passwordsMismatch"));
      }

      const tokens = isLogin
        ? await login(username, password)
        : await register(username, password);
      storeTokens(tokens);
      navigate("/home", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.genericError"));
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
          <p className={styles.kicker}>{t("auth.club")}</p>
          <h1>
            {t("auth.heroLine1")}
            <br />
            {t("auth.heroLine2")}
          </h1>
          <p className={styles.heroText}>{t("auth.heroText")}</p>

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
              <span>{t("auth.openingBoard")}</span>
              <span>{t("auth.players")}</span>
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
              {t("auth.boardFooter")}
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
              <p>{t("common.backgammon")}</p>
              <span>{t("auth.secureSignIn")}</span>
            </div>
          </div>

          <div className={styles.cardHeader}>
            <h2>{isLogin ? t("auth.welcome") : t("auth.createAccount")}</h2>
            <p>
              {isLogin
                ? t("auth.loginSubtitle")
                : t("auth.registerSubtitle")}
            </p>
          </div>

          <div className={styles.tabs}>
            <button
              onClick={() => !isLogin && switchMode()}
              className={`${styles.tab} ${isLogin ? styles.tabActive : ""}`}
              type="button"
            >
              {t("auth.logIn")}
            </button>
            <button
              onClick={() => isLogin && switchMode()}
              className={`${styles.tab} ${!isLogin ? styles.tabActive : ""}`}
              type="button"
            >
              {t("auth.register")}
            </button>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.field}>
              <span>{t("auth.username")}</span>
              <input
                type="text"
                placeholder={t("auth.usernamePlaceholder")}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className={styles.input}
                required
                minLength={3}
              />
            </label>

            <label className={styles.field}>
              <span>{t("auth.password")}</span>
              <input
                type="password"
                placeholder={t("auth.passwordPlaceholder")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={styles.input}
                required
                minLength={4}
              />
            </label>

            {!isLogin && (
              <label className={styles.field}>
                <span>{t("auth.confirmPassword")}</span>
                <input
                  type="password"
                  placeholder={t("auth.confirmPlaceholder")}
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
              {loading ? t("auth.pleaseWait") : isLogin ? t("auth.logIn") : t("auth.register")}
            </button>

            <p className={styles.helper}>
              {isLogin
                ? t("auth.newHere")
                : t("auth.hasAccount")}
            </p>
          </form>
        </motion.section>
      </section>
    </main>
  );
}
