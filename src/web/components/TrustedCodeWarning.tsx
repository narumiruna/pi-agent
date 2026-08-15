import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Callout } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

export function TrustedCodeWarning() {
  const { t } = useTranslation();
  return (
    <Callout.Root color="amber" highContrast role="note">
      <Callout.Icon>
        <ExclamationTriangleIcon />
      </Callout.Icon>
      <Callout.Text>{t("trustedCodeWarning")}</Callout.Text>
    </Callout.Root>
  );
}
