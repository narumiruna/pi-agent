import {
  ArrowTopRightIcon,
  CodeIcon,
  MagicWandIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import { useTranslation } from "react-i18next";

const STARTERS = [
  {
    id: "explore",
    icon: CodeIcon,
    title: "starterExplore",
    description: "starterExploreDescription",
    prompt: "starterExplorePrompt",
  },
  {
    id: "improve",
    icon: MagicWandIcon,
    title: "starterImprove",
    description: "starterImproveDescription",
    prompt: "starterImprovePrompt",
  },
  {
    id: "plan",
    icon: ReaderIcon,
    title: "starterPlan",
    description: "starterPlanDescription",
    prompt: "starterPlanPrompt",
  },
] as const;

interface Props {
  disabled: boolean;
  onSelect: (prompt: string) => void;
}

export function ChatWelcome({ disabled, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <div className="chatWelcome">
      <span className="welcomeMark" aria-hidden="true">
        π
      </span>
      <p className="welcomeEyebrow">{t("workspaceTagline")}</p>
      <h2>{t("welcomeTitle")}</h2>
      <p className="welcomeDescription">{t("emptyConversation")}</p>
      <fieldset className="chatStarters">
        <legend className="srOnly">{t("conversationStarters")}</legend>
        {STARTERS.map(({ id, icon: Icon, title, description, prompt }) => (
          <button
            className="chatStarter"
            disabled={disabled}
            key={id}
            onClick={() => onSelect(t(prompt))}
            type="button"
          >
            <span className={`starterIcon ${id}`}>
              <Icon aria-hidden="true" />
            </span>
            <span className="starterTitle">{t(title)}</span>
            <ArrowTopRightIcon className="starterArrow" aria-hidden="true" />
            <span className="starterDescription">{t(description)}</span>
          </button>
        ))}
      </fieldset>
      <p className="welcomeHint">{t("starterHint")}</p>
    </div>
  );
}
