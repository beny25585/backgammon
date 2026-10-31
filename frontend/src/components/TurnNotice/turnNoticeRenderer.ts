import { Application, Assets, Sprite, type Texture } from "pixi.js";

export interface TurnNoticeRenderer {
  setAsset: (url: string | null) => Promise<boolean>;
  destroy: () => void;
}

/** One static Pixi renderer switches cached images; Motion animates its shared DOM wrapper. */
export async function createTurnNoticeRenderer(
  host: HTMLDivElement,
  signal: AbortSignal,
  onError: () => void,
): Promise<TurnNoticeRenderer> {
  const app = new Application();
  let destroyed = false;
  let sprite: Sprite | null = null;
  let observer: ResizeObserver | null = null;
  let generation = 0;
  let displayedUrl: string | null = null;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    signal.removeEventListener("abort", destroy);
    if (app.renderer) {
      app.canvas.removeEventListener("webglcontextlost", onContextLost);
      // Textures belong to Assets' shared cache and may also be used by another Application.
      app.destroy({ removeView: true }, { children: true });
    }
    sprite = null;
  }

  function fail() {
    if (destroyed) return;
    destroy();
    onError();
  }

  function onContextLost() {
    fail();
  }

  function render() {
    if (destroyed || !sprite || document.hidden) return;
    const width = Math.round(host.clientWidth);
    const height = Math.round(host.clientHeight);
    if (width <= 0 || height <= 0) return;
    try {
      if (app.screen.width !== width || app.screen.height !== height) app.renderer.resize(width, height);
      if (sprite.visible) {
        sprite.scale.set(Math.min(width / sprite.texture.width, height / sprite.texture.height));
        sprite.position.set(width / 2, height / 2);
      }
      app.render();
    } catch {
      fail();
    }
  }

  function onVisibilityChange() {
    if (!document.hidden) render();
  }

  async function setAsset(url: string | null): Promise<boolean> {
    if (destroyed || !sprite) return false;
    const requestId = ++generation;
    if (url && url === displayedUrl && sprite.visible) {
      render();
      return !destroyed;
    }
    displayedUrl = null;
    sprite.visible = false;
    app.canvas.dataset.noticeAsset = "";
    render();
    if (!url) return false;
    try {
      const texture = await Assets.load<Texture>(url);
      if (destroyed || signal.aborted || requestId !== generation || !sprite) return false;
      sprite.texture = texture;
      sprite.visible = true;
      displayedUrl = url;
      render();
      if (destroyed) return false;
      app.canvas.dataset.noticeAsset = url;
      return true;
    } catch {
      // A missing image keeps its own fallback; a later asset can still reuse this Application.
      return false;
    }
  }

  try {
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
      autoStart: false,
      sharedTicker: false,
    });
    if (signal.aborted) throw new DOMException("Notice cancelled", "AbortError");
    app.stage.eventMode = "none";
    app.stage.interactiveChildren = false;
    sprite = new Sprite({ anchor: 0.5, eventMode: "none", visible: false });
    app.stage.addChild(sprite);
    app.canvas.setAttribute("aria-hidden", "true");
    app.canvas.dataset.pixiTurnNotice = "true";
    app.canvas.dataset.noticeAsset = "";
    app.canvas.className = "pointer-events-none absolute inset-0 block size-full";
    host.appendChild(app.canvas);
    app.canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibilityChange);
    signal.addEventListener("abort", destroy, { once: true });
    observer = new ResizeObserver(render);
    observer.observe(host);
    render();
    return { setAsset, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}
