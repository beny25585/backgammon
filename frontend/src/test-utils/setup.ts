export const ANIMATION_DISABLE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

export function disableAnimations(): void {
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = ANIMATION_DISABLE_CSS;
  document.head.appendChild(style);
}
