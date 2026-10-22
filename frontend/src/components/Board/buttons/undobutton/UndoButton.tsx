import { useI18n } from "../../../../i18n/I18nProvider";
import BoardActionButton from "../BoardActionButton";

interface UndoButtonProps {
  onClick?: () => void;
}

export default function UndoButton({ onClick }: UndoButtonProps) {
  const { t } = useI18n();

  return (
    <BoardActionButton onClick={onClick} title={t("common.undoMove")}>
      {t("common.undo")}
    </BoardActionButton>
  );
}
