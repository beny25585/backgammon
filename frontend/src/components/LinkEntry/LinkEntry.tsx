import { useEffect, useRef, useState } from "react";
import { cancelRoom } from '../../services/api';
import { useNavigate } from "react-router-dom";
import { storeTokens } from "../../services/auth";
import { useI18n } from "../../i18n/I18nProvider";
import BrandLockup from "../BrandLockup";
import styles from "./LinkEntry.module.css";

// Where the address bar is left pointing once the fragment has been taken out of it. Written out
// rather than derived from the router, to match `handleSessionExpired` in services/auth.
const LANDING_PATH = "/backgammon/link";

/**
 * The landing route a player arrives on from the tournaments server.
 *
 * The backgammon server puts a session in the URL *fragment* — a fragment is never sent to a
 * server, so it stays out of access logs and `Referer` headers on the way here. It is still in the
 * address bar, though, and from there it would reach the browser's history and any bookmark, so
 * the first thing this route does is take it out. The tokens are never rendered.
 *
 * Both outcomes are a redirect, so this component holds no state: it always renders the same
 * short message and the effect navigates away from it.
 */
export default function LinkEntry() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const consumed = useRef(false);
  const [conflict, setConflict] = useState<{ path: string; room: string; waiting: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // A fragment can only be consumed once. Without this guard React's development-mode double
    // invocation runs the effect again, finds the fragment already stripped, and reports a
    // perfectly good link as broken.
    if (consumed.current) return;
    consumed.current = true;

    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    // Before anything else, and on every path through this function — including the failure
    // below, which must not leave a session sitting in the address bar.
    window.history.replaceState(null, "", LANDING_PATH);

    const access = fragment.get("access");
    const refresh = fragment.get("refresh");
    const room = fragment.get("room");
    const color = fragment.get("color");
    const tournament = fragment.get("tournament");
    const returnUrl = fragment.get("return");

    if (!access || !refresh || !room || (color !== "white" && color !== "black")) {
      navigate("/?link=invalid", { replace: true });
      return;
    }

    storeTokens({ access, refresh });
    const params = new URLSearchParams({ color });
    if (tournament) params.set("tournament", tournament);
    if (returnUrl) params.set("return", returnUrl);
    if (fragment.get("practice") === "1") params.set("practice", "1");
    if (fragment.get('conflict') === '1') {
      setConflict({ path: `/game/${encodeURIComponent(room)}?${params.toString()}`, room, waiting: fragment.get('waiting') === '1' });
      return;
    }

    navigate(`/game/${encodeURIComponent(room)}?${params.toString()}`, {
      replace: true,
    });
  }, [navigate]);

  async function closeExisting() {
    if (!conflict || busy) return;
    if (!conflict.waiting) { navigate(`${conflict.path}&closeExisting=1`, { replace: true }); return; }
    setBusy(true);
    setError('');
    try {
      await cancelRoom(conflict.room);
      window.location.assign('/tournaments/my-games');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'לא ניתן לסגור כרגע. נסה שוב.'); }
    finally { setBusy(false); }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <BrandLockup subtitle={t("common.room")} size="md" />
        {conflict ? <div dir="rtl" className={styles.recovery}>
          <h1>יש לך משחק שעדיין פתוח</h1>
          <p>אפשר לחזור אליו, או לסיים אותו ואז לבחור משחק חדש.</p>
          <p>{conflict.waiting ? 'המשחק עדיין ממתין. הסגירה תבטל אותו.' : 'סיום משחק שהתחיל נחשב לפרישה והפסד, בהתאם לכללי המשחק וההימור.'}</p>
          <button disabled={busy} onClick={() => navigate(conflict.path, { replace: true })}>חזרה למשחק הקיים</button>
          <button disabled={busy} onClick={() => void closeExisting()}>{busy ? 'סוגר…' : conflict.waiting ? 'סגירת המשחק הממתין' : 'סיום המשחק הקיים'}</button>
          {error && <p role="alert">{error}</p>}
          <a href="/tournaments/my-games">חזרה למשחקים שלי</a>
        </div> : <p className={styles.message}>{t("game.takingToGame")}</p>}
      </div>
    </div>
  );
}
