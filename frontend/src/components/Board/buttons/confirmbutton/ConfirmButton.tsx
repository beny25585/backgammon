import { useI18n } from "../../../../i18n/I18nProvider";
import BoardActionButton from "../BoardActionButton";

interface ConfirmButtonProps {
  onClick?: () => void;
  labelKey?: "common.confirm" | "common.confirmMove";
  className?: string;
}

export default function ConfirmButton({ onClick, labelKey = "common.confirm", className }: ConfirmButtonProps) {
  const { t } = useI18n();

  return (
    <BoardActionButton variant="primary" onClick={onClick} title={t("common.confirmTurn")} className={className}>
      {t(labelKey)}
    </BoardActionButton>
  );
}
