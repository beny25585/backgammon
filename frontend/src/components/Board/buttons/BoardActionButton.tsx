import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

/** A compact visual button with a full 44px touch target at the same center. */
export default function BoardActionButton({ variant = "secondary", className = "", children, type = "button", ...props }: Props) {
  return (
    <button
      {...props}
      type={type}
      className={`group pointer-events-auto relative flex min-h-11 w-[var(--board-action-width,96px)] max-w-[calc(100%_-_16px)] shrink-0 items-center justify-center border-0 bg-transparent px-2 text-[length:var(--board-action-font,13px)] leading-tight font-extrabold outline-offset-2 enabled:cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-50 ${variant === "primary" ? "text-[var(--ui-on-accent,#17251d)]" : "text-[#f7f1e3]"} ${className}`}
    >
      <span
        aria-hidden="true"
        data-button-surface
        className={`pointer-events-none absolute inset-x-0 top-1/2 h-[var(--board-action-face-height,36px)] -translate-y-1/2 rounded-md border shadow-[0_3px_10px_#00000066,inset_0_1px_0_#ffffff26] group-enabled:group-hover:border-[var(--ui-accent-hover,#e7bd72)] ${variant === "primary" ? "border-[var(--ui-accent-border,#d9b65db3)] [background:var(--board-primary-surface,var(--ui-accent,#d9b65d))]" : "border-[var(--ui-secondary-border,#f7f1e340)] [background:var(--ui-secondary-bg,#0f1d15eb)]"}`}
      />
      <span className="pointer-events-none relative whitespace-nowrap">{children}</span>
    </button>
  );
}
