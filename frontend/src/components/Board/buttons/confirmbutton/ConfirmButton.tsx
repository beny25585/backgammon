import { motion } from "motion/react";

interface ConfirmButtonProps {
  onClick?: () => void;
}

export default function ConfirmButton({ onClick }: ConfirmButtonProps) {
  return (
    <motion.button
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      onClick={onClick}
      className="absolute right-37 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center rounded-full shadow-xl border-2 border-gold/60 hover:border-gold focus:outline-none"
      style={{
        width: "clamp(36px, 5vw, 48px)",
        height: "clamp(36px, 5vw, 48px)",
        background:
          "linear-gradient(135deg, rgba(40,25,10,0.95), rgba(20,10,5,0.95))",
        boxShadow:
          "0 4px 16px rgba(0,0,0,0.6), 0 0 20px rgba(201,169,97,0.2)",
        backdropFilter: "blur(4px)",
      }}
      whileHover={{
        scale: 1.1,
        boxShadow:
          "0 4px 24px rgba(0,0,0,0.8), 0 0 30px rgba(201,169,97,0.4)",
      }}
      whileTap={{ scale: 0.95 }}
      title="Confirm and end your turn"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#4caf50"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </motion.button>
  );
}
