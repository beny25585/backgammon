import { motion, useReducedMotion } from "motion/react";

export default function ConnectionStatus({ connected, text }: { connected: boolean; text: string }) {
  const reduceMotion = useReducedMotion() === true;

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0.35, transform: reduceMotion ? "none" : "translateY(-4px)" }}
      animate={{ opacity: 1, transform: "none" }}
      transition={{ duration: reduceMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
      className="pointer-events-none absolute left-1/2 top-2 z-50 flex w-max max-w-[calc(100%_-_1rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[#d6ab65]/45 bg-[#221a14] px-3 py-1.5 text-center text-[clamp(12px,1.5vw,16px)] leading-snug font-semibold text-[#f5e4ca] shadow-[0_4px_14px_#0007]"
    >
      <svg
        aria-hidden="true" className={`size-4 shrink-0 ${connected ? "text-emerald-300" : "text-[#e9bc72]"}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      >
        {connected ? <path d="m5 12 4 4L19 6" /> : <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2 2" /></>}
      </svg>
      <bdi className="min-w-0 [overflow-wrap:anywhere]">{text}</bdi>
    </motion.div>
  );
}
