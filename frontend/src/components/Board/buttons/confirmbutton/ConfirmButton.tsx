import { useI18n } from "../../../../i18n/I18nProvider";
import BoardActionButton from "../BoardActionButton";

interface ConfirmButtonProps {
  onClick?: () => void;
}

export default function ConfirmButton({ onClick }: ConfirmButtonProps) {
  const { t } = useI18n();

  return (
    <BoardActionButton variant="primary" onClick={onClick} title={t("common.confirmTurn")}>
      {t("common.confirm")}
    </BoardActionButton>
  );
}
