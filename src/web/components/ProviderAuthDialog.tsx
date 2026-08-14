import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircledIcon,
  CopyIcon,
  ExternalLinkIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Flex,
  RadioGroup,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, mutation } from "../api.js";
import type { ProviderAuthTask } from "../model-access.js";
import type { InteractionEvent } from "../types.js";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  interaction?: InteractionEvent;
  onChooseModel: () => void;
  onDismiss: () => void;
  onInteractionClose: () => void;
  onRetry: (providerId: string) => void;
  task?: ProviderAuthTask;
}

function defaultInteractionValue(interaction?: InteractionEvent): string {
  if (!interaction) return "";
  if (
    interaction.kind === "select" &&
    interaction.options?.some((option) =>
      (typeof option === "string" ? option : option.id).includes("device_code"),
    )
  )
    return "device_code";
  return interaction.prefill ?? "";
}

export function ProviderAuthDialog({
  interaction,
  onChooseModel,
  onDismiss,
  onInteractionClose,
  onRetry,
  task,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() =>
    defaultInteractionValue(interaction),
  );
  const [copiedCode, setCopiedCode] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);
  const completed = useRef(false);
  useEffect(() => {
    setValue(defaultInteractionValue(interaction));
    completed.current = false;
  }, [interaction]);
  useEffect(() => {
    setNow(Date.now());
    if (!task?.expiresAt) return;
    const delay = Math.max(0, task.expiresAt - Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [task?.expiresAt]);

  const options = useMemo(
    () =>
      interaction?.options?.map((option) =>
        typeof option === "string" ? { id: option, label: option } : option,
      ),
    [interaction],
  );
  if (!task) return null;

  const active = task.phase === "starting" || task.phase === "waiting";
  const expired = Boolean(task.expiresAt && task.expiresAt <= now && active);
  const url = task.verificationUri ?? task.url;
  const isCodex = task.providerId === "openai-codex";
  const displayedOptions =
    options && isCodex
      ? [...options].sort(
          (left, right) =>
            (left.id === "device_code" ? 0 : left.id === "browser" ? 1 : 2) -
            (right.id === "device_code" ? 0 : right.id === "browser" ? 1 : 2),
        )
      : options;
  const primaryActionLabel =
    isCodex && value === "device_code"
      ? t("continueWithDeviceCode")
      : isCodex && value === "browser"
        ? t("continueInBrowser")
        : t("continue");

  const respond = async (response?: string) => {
    if (!interaction || completed.current) return;
    await api(
      `/api/interactions/${interaction.id}`,
      mutation("POST", response === undefined ? {} : { value: response }),
    );
    completed.current = true;
    onInteractionClose();
  };
  const cancel = async () => {
    if (active) {
      await api("/api/providers/login/cancel", mutation("POST"));
      onInteractionClose();
      return;
    }
    onDismiss();
  };
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (active) {
        await api("/api/providers/login/cancel", mutation("POST"));
        onInteractionClose();
      }
      onRetry(task.providerId);
    } catch {
      return;
    } finally {
      setRetrying(false);
    }
  };
  const chooseModel = () => {
    onDismiss();
    onChooseModel();
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && void cancel()}>
      <DialogPortal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content
          className="dialogContent providerAuthDialog"
          aria-describedby="provider-auth-description"
        >
          <Dialog.Title className="dialogTitle">
            {t("connectProvider", { provider: task.providerName })}
          </Dialog.Title>
          <Dialog.Description id="provider-auth-description" asChild>
            <Text as="p" color="gray" size="2">
              {isCodex ? t("codexSubscriptionDescription") : task.message}
            </Text>
          </Dialog.Description>

          {task.phase === "starting" && (
            <div className="providerAuthState" role="status">
              <Spinner /> {t("startingProviderSignIn")}
            </div>
          )}

          {task.phase === "waiting" && !expired && (
            <div className="providerAuthFlow">
              {displayedOptions && (
                <div className="authMethodStep">
                  <Text weight="medium">{t("chooseSignInMethod")}</Text>
                  <RadioGroup.Root value={value} onValueChange={setValue}>
                    {displayedOptions.map((option) => {
                      const label =
                        isCodex && option.id === "device_code"
                          ? t("deviceCodeLogin")
                          : isCodex && option.id === "browser"
                            ? t("browserLogin")
                            : option.label;
                      return (
                        <RadioGroup.Item
                          aria-label={label}
                          className={`authMethodOption${value === option.id ? " selected" : ""}`}
                          key={option.id}
                          value={option.id}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setValue(option.id);
                            }
                          }}
                        >
                          <span className="authMethodText">
                            <strong>{label}</strong>
                            {option.id === "device_code" && isCodex ? (
                              <small>{t("recommendedForDocker")}</small>
                            ) : option.id === "browser" && isCodex ? (
                              <small>{t("browserLoginHelp")}</small>
                            ) : (
                              option.description && (
                                <small>{option.description}</small>
                              )
                            )}
                          </span>
                        </RadioGroup.Item>
                      );
                    })}
                  </RadioGroup.Root>
                </div>
              )}

              {task.userCode && (
                <div className="deviceCodePanel">
                  <Text size="1" color="gray">
                    {t("deviceCode")}
                  </Text>
                  <Text as="div" aria-label={t("deviceCode")} role="status">
                    <code>{task.userCode}</code>
                  </Text>
                  <Button
                    variant="soft"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(task.userCode ?? "")
                        .then(() => setCopiedCode(task.userCode))
                    }
                  >
                    <CopyIcon />
                    {copiedCode === task.userCode ? t("copied") : t("copyCode")}
                  </Button>
                </div>
              )}

              {url && (
                <Button asChild size="3">
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon />
                    {isCodex ? t("openOpenAI") : t("openProvider")}
                  </a>
                </Button>
              )}

              {interaction && !options && (
                <div className="manualAuthStep">
                  {task.method === "browser" && isCodex && (
                    <Callout.Root color="amber">
                      <Callout.Text>{t("dockerCallbackHelp")}</Callout.Text>
                    </Callout.Root>
                  )}
                  <TextField.Root
                    autoFocus
                    aria-label={interaction.title}
                    placeholder={interaction.placeholder}
                    type={interaction.kind === "secret" ? "password" : "text"}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
              )}

              {!options && !interaction && (
                <div className="providerAuthState" role="status">
                  <Spinner />
                  {task.method === "device_code" && isCodex
                    ? t("waitingForOpenAI")
                    : t("waitingForProvider", { provider: task.providerName })}
                </div>
              )}
            </div>
          )}

          {(expired || task.phase === "failed") && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                {expired ? t("deviceCodeExpired") : t("providerConnectFailed")}
              </Callout.Text>
            </Callout.Root>
          )}

          {task.phase === "cancelled" && (
            <Callout.Root color="gray" role="status">
              <Callout.Text>{t("providerSignInCancelled")}</Callout.Text>
            </Callout.Root>
          )}

          {task.phase === "succeeded" && (
            <Callout.Root color="green" role="status">
              <Callout.Icon>
                <CheckCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {t("providerConnected", { provider: task.providerName })}
              </Callout.Text>
            </Callout.Root>
          )}

          <Flex
            className={`providerAuthActions${options ? " providerAuthMethodActions" : ""}`}
            gap="3"
            justify="end"
          >
            {active && !expired && (
              <Button color="gray" variant="soft" onClick={() => void cancel()}>
                {t("cancelSignIn")}
              </Button>
            )}
            {active && !expired && interaction && (
              <Button
                disabled={interaction.kind !== "confirm" && !value}
                onClick={() =>
                  void respond(interaction.kind === "confirm" ? "true" : value)
                }
              >
                {primaryActionLabel}
              </Button>
            )}
            {(expired ||
              task.phase === "failed" ||
              task.phase === "cancelled") && (
              <>
                <Button color="gray" variant="soft" onClick={onDismiss}>
                  {t("close")}
                </Button>
                <Button disabled={retrying} onClick={() => void retry()}>
                  {t("tryAgain")}
                </Button>
              </>
            )}
            {task.phase === "succeeded" && (
              <>
                <Button color="gray" variant="soft" onClick={onDismiss}>
                  {t("done")}
                </Button>
                <Button onClick={chooseModel}>{t("chooseModel")}</Button>
              </>
            )}
          </Flex>
        </Dialog.Content>
      </DialogPortal>
    </Dialog.Root>
  );
}
