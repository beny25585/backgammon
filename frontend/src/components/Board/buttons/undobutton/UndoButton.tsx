import { useI18n } from "../../../../i18n/I18nProvider";
import BoardActionButton from "../BoardActionButton";

interface UndoButtonProps {
  onClick?: () => void;
  iconOnly?: boolean;
  className?: string;
}

export default function UndoButton({ onClick, iconOnly = false, className }: UndoButtonProps) {
  const { t } = useI18n();

  return (
    <BoardActionButton onClick={onClick} title={t("common.undoMove")} aria-label={iconOnly ? t("common.undoMove") : undefined} className={className}>
      {iconOnly ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-[clamp(18px,2.8cqw,28px)]">
          <path d="M3 7v6h6" />
          <path d="M3 13a8 8 0 1 1 2.4 5.7" />
        </svg>
      ) : t("common.undo")}
    </BoardActionButton>
  );
}
