import { memo, useState } from "react";
import { useBoardMaterials } from "../../materials/boardMaterialContext";

interface CheckerProps {
  color: "white" | "black";
  label?: string;
}

function Checker({ color, label }: CheckerProps) {
  const { checkerImages } = useBoardMaterials();
  const source = checkerImages?.[color];
  const [loadedURL, setLoadedURL] = useState<string | null>(null);
  const decoded = Boolean(source && loadedURL === source);
  const nativeAppearance = color === "white"
    ? "border-[var(--lux-checker-light-border,#b88f4f)] [background:radial-gradient(ellipse_at_36%_24%,var(--lux-checker-light-hi,#fffdf4),var(--lux-checker-light-mid,#fff4d4)_55%,var(--lux-checker-light-low,#d9bf82)_85%,var(--lux-checker-light-deep,#8f6e3f))] before:border-2 before:border-t-white/80 before:border-l-white/65 before:border-r-black/15 before:border-b-black/25 before:shadow-[inset_0_-1px_2px_#00000014]"
    : "border-[var(--lux-checker-dark-border,#3b070d)] [background:radial-gradient(ellipse_at_36%_24%,var(--lux-checker-dark-hi,#c85a58),var(--lux-checker-dark-mid,#aa3940)_50%,var(--lux-checker-dark-low,#6f1722)_88%,var(--lux-checker-dark-deep,#260508))] before:border before:border-t-white/20 before:border-l-white/15 before:border-r-black/50 before:border-b-black/70";

  return (
    <div
      data-checker
      data-checker-color={color}
      data-pixi-ready={String(decoded)}
      data-pixi-material={color}
      className={`relative isolate flex size-[min(var(--checker),var(--checker-height-limit,100vmax))] shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-extrabold ${color === "white" ? "text-[#2b2118]" : "text-[#f7f1e7]"} ${
        decoded
          ? "border-0 bg-transparent shadow-[1px_2px_2px_#00000080,2px_3px_4px_#00000033]"
          : `border shadow-[1px_3px_2px_#000000a6,3px_5px_6px_#00000057,inset_1px_1px_1px_#ffffff40,inset_-2px_-3px_2px_#00000059] before:pointer-events-none before:absolute before:inset-[3%] before:rounded-full before:content-[''] ${nativeAppearance}`
      }`}
    >
      {source && (
        <img
          key={source}
          src={source}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-pixi-checker-image={color}
          data-pixi-ready={String(decoded)}
          onLoad={(event) => {
            if (event.currentTarget.currentSrc === source) setLoadedURL(source);
          }}
          className={`pointer-events-none absolute inset-0 size-full select-none ${decoded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {label && <span className="relative z-2 grid min-h-[58%] min-w-[58%] place-items-center rounded-full bg-black/20 text-current [text-shadow:0_1px_2px_#00000057]">{label}</span>}
    </div>
  );
}

export default memo(Checker);
