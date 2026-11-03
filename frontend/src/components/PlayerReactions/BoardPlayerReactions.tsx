import { useRef, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import type { Color } from "../../lib/backgammon/engine";
import type { PlayerReaction } from "../../lib/playerReactions";
import { useI18n } from "../../i18n/I18nProvider";
import PlayerReactionBubble from "./PlayerReactionBubble";
import { useBoardReactionPosition } from "./useBoardReactionPosition";

function BoardReaction({ reaction, sender, side, containerRef }: {
  reaction: PlayerReaction;
  sender: string;
  side: "left" | "right";
  containerRef: RefObject<HTMLDivElement>;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const position = useBoardReactionPosition({ containerRef, bubbleRef, side, active: true });

  return (
    <div ref={bubbleRef} data-board-reaction={reaction.color}
      className="pointer-events-none absolute left-0 top-0 w-max max-w-full"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>
      <PlayerReactionBubble reaction={reaction} sender={sender} />
    </div>
  );
}

export default function BoardPlayerReactions({ reactions, names, playerColor }: {
  reactions: Partial<Record<Color, PlayerReaction>>;
  names: Record<Color, string | null>;
  playerColor: Color;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-30" data-testid="board-player-reactions">
      <AnimatePresence>
        {(["white", "black"] as const).map(color => {
          const reaction = reactions[color];
          return reaction ? <BoardReaction key={reaction.id} reaction={reaction}
            containerRef={containerRef} side={color === playerColor ? "right" : "left"}
            sender={names[color] || t(color === playerColor ? "common.you" : "common.opponent")} /> : null;
        })}
      </AnimatePresence>
    </div>
  );
}
