import { useEffect, useRef } from "react";

export default function BoardCount({ count, className }: { count: number; className?: string }) {
  const face = useRef<HTMLSpanElement>(null);
  const previous = useRef(count);

  useEffect(() => {
    if (previous.current === count) return;
    previous.current = count;
    const animation = face.current?.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: 125,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    return () => animation?.cancel();
  }, [count]);

  return <span ref={face} className={className}>{count}</span>;
}
