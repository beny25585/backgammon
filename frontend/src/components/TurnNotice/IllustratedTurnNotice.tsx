import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate } from "motion";
import { useReducedMotion } from "motion/react";
import type { TurnNoticeRenderer } from "./turnNoticeRenderer";
import type { GuidanceVariant } from "../GuidanceBanner/guidance";

export interface IllustratedNoticeAsset {
  id: string;
  url: string;
  width: number;
  height: number;
}

interface Props {
  active: boolean;
  eventKey: string;
  text: string;
  locale: string;
  direction: "ltr" | "rtl";
  expiresAt?: number;
  variant: GuidanceVariant;
  asset: IllustratedNoticeAsset | null;
}

interface RendererSession {
  controller: AbortController;
  renderer: TurnNoticeRenderer | null;
  loading: Promise<void> | null;
  failed: boolean;
  assetUrl: string | null;
  requestId: number;
}

interface NoticeEvent {
  key: string;
  startedAt: number;
  expiresAt: number;
}

const ENTER_MS = 250;
const EXIT_MS = 180;
const DEFAULT_LIFETIME_MS = 3000;
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Keep mounted between notices; Motion animates the fallback and Pixi canvas together. */
export default function IllustratedTurnNotice({ active, eventKey, text, locale, direction, expiresAt, variant, asset }: Props) {
  const noticeRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<RendererSession | null>(null);
  const eventRef = useRef<NoticeEvent | null>(null);
  const assetUrl = asset?.url ?? null;
  const [imageState, setImageState] = useState({ url: assetUrl, ready: false, failed: false });
  // Reset resource state before committing a different asset, including A -> B -> A races.
  if (imageState.url !== assetUrl) setImageState({ url: assetUrl, ready: false, failed: false });
  const ready = imageState.url === assetUrl && imageState.ready;
  const imageFailed = imageState.url === assetUrl && imageState.failed;
  const reducedMotion = useReducedMotion() === true;

  useLayoutEffect(() => {
    const element = noticeRef.current;
    if (!element) return;
    element.style.opacity = "0";
    if (!active) return;

    const now = Date.now();
    if (eventRef.current?.key !== eventKey) {
      eventRef.current = { key: eventKey, startedAt: now, expiresAt: expiresAt ?? now + DEFAULT_LIFETIME_MS };
    }
    const event = eventRef.current;
    if (!event) return;
    // An update for the same event can shorten its deadline, never restart or extend it.
    if (expiresAt !== undefined) event.expiresAt = Math.min(event.expiresAt, expiresAt);
    const durationMs = event.expiresAt - event.startedAt;
    if (durationMs <= 0 || now >= event.expiresAt) return;
    const enterMs = Math.min(ENTER_MS, durationMs / 2);
    const exitMs = Math.min(EXIT_MS, durationMs - enterMs);
    const times = [0, enterMs / durationMs, (durationMs - exitMs) / durationMs, 1];
    element.style.transform = reducedMotion ? "none" : "translateY(10px) scale(0.90)";
    const animation = animate(element, {
      opacity: [0, 1, 1, 0],
      ...(reducedMotion ? {} : {
        transform: [
          "translateY(10px) scale(0.90)",
          "translateY(0px) scale(1)",
          "translateY(0px) scale(1)",
          "translateY(6px) scale(0.96)",
        ],
      }),
    }, {
      duration: durationMs / 1000,
      times,
      ease: [EASE_OUT, "linear", EASE_OUT],
      autoplay: false,
    });

    const syncVisibility = () => {
      if (document.hidden) {
        animation.pause();
        return;
      }
      const elapsed = Date.now() - event.startedAt;
      if (elapsed >= durationMs) {
        animation.stop();
        element.style.opacity = "0";
        return;
      }
      // Resume at wall-clock progress, so hidden tabs do not replay or prolong the notice.
      animation.time = Math.max(0, elapsed) / 1000;
      animation.play();
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      animation.stop();
    };
  }, [active, eventKey, expiresAt, reducedMotion]);

  useEffect(() => {
    const session: RendererSession = {
      controller: new AbortController(), renderer: null, loading: null, failed: false,
      assetUrl: null, requestId: 0,
    };
    sessionRef.current = session;
    return () => {
      session.controller.abort();
      session.renderer?.destroy();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const session = sessionRef.current;
    if (!host || !session) return;
    session.assetUrl = active ? assetUrl : null;
    session.requestId += 1;

    const showLatestAsset = async () => {
      const renderer = session.renderer;
      if (!renderer || session.controller.signal.aborted || session.failed) return;
      const requestId = session.requestId;
      const url = session.assetUrl;
      const loaded = await renderer.setAsset(url);
      if (!loaded || !url || requestId !== session.requestId || session.controller.signal.aborted || session.failed) return;
      setImageState(current => current.url === url ? { ...current, ready: true, failed: false } : current);
    };

    if (session.renderer) {
      void showLatestAsset();
      return;
    }
    if (!active || !assetUrl || session.loading || session.failed) return;
    session.loading = import("./turnNoticeRenderer")
      .then(({ createTurnNoticeRenderer }) => {
        if (session.controller.signal.aborted) return null;
        return createTurnNoticeRenderer(host, session.controller.signal, () => {
          if (session.controller.signal.aborted) return;
          session.failed = true;
          setImageState(current => ({ ...current, ready: false }));
        });
      })
      .then(renderer => {
        if (!renderer) return;
        if (session.controller.signal.aborted) {
          renderer.destroy();
          return;
        }
        session.renderer = renderer;
        return showLatestAsset();
      })
      .catch(() => {
        if (!session.controller.signal.aborted) {
          session.failed = true;
          setImageState(current => ({ ...current, ready: false }));
        }
      });
  }, [active, assetUrl]);

  return (
    <div
      ref={noticeRef}
      className="pointer-events-none relative w-full"
      hidden={!active}
      role={active ? "status" : undefined}
      data-testid={active ? "guidance-banner" : undefined}
      data-variant={variant}
      data-notice-renderer={ready ? "pixi" : "image"}
      data-notice-animation="motion"
      data-notice-asset={assetUrl ?? ""}
    >
      {imageFailed || !asset ? (
        active ? <span className="block text-center text-sm font-semibold text-[#fff8eb]" data-testid="guidance-text" dir={direction} lang={locale}>{text}</span> : null
      ) : (
        <>
          <img
            key={asset.url}
            src={asset.url}
            width={asset.width}
            height={asset.height}
            alt=""
            aria-hidden="true"
            draggable={false}
            className={`pointer-events-none block h-auto w-full ${ready ? "invisible" : "visible"}`}
            onError={() => setImageState(current => current.url === asset.url && !current.ready ? { ...current, failed: true } : current)}
          />
          {active && <span className="sr-only" data-testid="guidance-text" dir={direction} lang={locale}>{text}</span>}
        </>
      )}
      <div ref={hostRef} className={`pointer-events-none absolute inset-0 ${ready ? "visible" : "invisible"}`} aria-hidden="true" />
    </div>
  );
}
