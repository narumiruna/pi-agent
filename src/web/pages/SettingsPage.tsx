import { CheckCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Flex,
  Heading,
  Select,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, mutation } from "../api.js";
import { DisconnectProviderDialog } from "../components/DisconnectProviderDialog.js";
import { ModelAccessDialog } from "../components/ModelAccessDialog.js";
import { ModelPickerDialog } from "../components/ModelPickerDialog.js";
import { setLanguage } from "../i18n.js";
import type {
  ModelData,
  ModelOption,
  ProviderOption,
} from "../model-access.js";
import type { SessionInfo } from "../types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error";
}

function sourceLabel(
  provider: ProviderOption,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (provider.status.label) return provider.status.label;
  switch (provider.status.source) {
    case "stored":
      return provider.status.credentialType === "oauth"
        ? translate("providerAccountConnected")
        : translate("apiKeyStored");
    case "environment":
      return translate("environmentCredential");
    case "models_json_command":
    case "models_json_key":
      return translate("modelsJsonCredential");
    case "runtime":
      return translate("runtimeCredential");
    default:
      return translate("providerConfigured");
  }
}

export function SettingsPage({
  chooseModelRequest = 0,
  session,
}: {
  chooseModelRequest?: number;
  session: SessionInfo;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ModelData>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [accessOpen, setAccessOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [disconnectProvider, setDisconnectProvider] =
    useState<ProviderOption>();

  const load = useCallback(async () => {
    const result = await api<ModelData>("/api/models");
    setData(result);
    return result;
  }, []);

  useEffect(() => {
    void load().catch((reason) => setError(errorMessage(reason)));
  }, [load]);

  useEffect(() => {
    if (chooseModelRequest > 0) {
      setAccessOpen(false);
      setModelOpen(true);
      void load();
    }
  }, [chooseModelRequest, load]);

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    successMessage?: string,
  ): Promise<boolean> => {
    setPending(key);
    setError(undefined);
    setSuccess(undefined);
    try {
      await action();
      await load();
      if (successMessage) setSuccess(successMessage);
      return true;
    } catch (reason) {
      if (!(reason instanceof ApiError && reason.code === "cancelled"))
        setError(errorMessage(reason));
      try {
        await load();
      } catch {
        // Keep the actionable operation error when recovery refresh also fails.
      }
      return false;
    } finally {
      setPending(undefined);
    }
  };

  const configured = data?.providers.filter(
    (provider) => provider.status.configured,
  );

  const login = (
    provider: ProviderOption,
    type: "api_key" | "oauth",
    apiKey?: string,
  ) =>
    run(
      `login:${provider.id}`,
      () =>
        api(
          `/api/providers/${provider.id}/login`,
          mutation("POST", {
            type,
            ...(apiKey ? { apiKey } : {}),
          }),
        ),
      t("providerConnected", { provider: provider.name }),
    );

  const chooseModel = (model: ModelOption) =>
    run(
      "model",
      () =>
        api(
          "/api/model",
          mutation("PUT", { provider: model.provider, modelId: model.id }),
        ),
      t("modelApplied", { model: model.name }),
    );

  return (
    <section className="pageColumn settingsPage">
      <header className="settingsHeader">
        <Heading size="6">{t("settings")}</Heading>
        <Text as="p" color="gray">
          {t("settingsDescription")}
        </Text>
      </header>
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>
            {error}{" "}
            {!data && (
              <Button size="1" variant="soft" onClick={() => void load()}>
                {t("tryAgain")}
              </Button>
            )}
          </Callout.Text>
        </Callout.Root>
      )}
      {success && (
        <Callout.Root color="green" role="status">
          <Callout.Icon>
            <CheckCircledIcon />
          </Callout.Icon>
          <Callout.Text>{success}</Callout.Text>
        </Callout.Root>
      )}
      {!data ? (
        <div className="settingsLoading" role="status">
          <Spinner /> {t("loadingModelAccess")}
        </div>
      ) : (
        <>
          <section className="settingsSection" aria-labelledby="model-heading">
            <div className="sectionHeading">
              <div>
                <Heading id="model-heading" size="4">
                  {t("modelAccess")}
                </Heading>
                <Text as="p" size="2" color="gray">
                  {t("modelAccessDescription")}
                </Text>
              </div>
            </div>
            <div className="modelSummary">
              <div className="modelSignal" aria-hidden="true">
                π
              </div>
              <div className="modelSummaryText">
                <Text size="1" color="gray">
                  {t("currentModel")}
                </Text>
                <Text weight="medium">
                  {data.current?.name ?? t("noModelSelected")}
                </Text>
                <Text size="1" color="gray">
                  {data.current
                    ? `${data.current.provider} · ${data.current.id}`
                    : data.models.length === 0
                      ? configured?.length
                        ? t("noModelsAvailable")
                        : t("configureProviderFirst")
                      : t("chooseAvailableModel")}
                </Text>
              </div>
              <Button
                variant="soft"
                disabled={data.models.length === 0 || pending === "model"}
                onClick={() => setModelOpen(true)}
              >
                {t("changeModel")}
              </Button>
            </div>
            <div className="settingRow compactRow">
              <div>
                <Text weight="medium">{t("thinking")}</Text>
                <Text as="p" size="1" color="gray">
                  {t("thinkingDescription")}
                </Text>
              </div>
              <Select.Root
                value={data.thinkingLevel}
                onValueChange={(level) =>
                  void run("thinking", () =>
                    api("/api/thinking", mutation("PUT", { level })),
                  )
                }
              >
                <Select.Trigger
                  aria-label={t("thinking")}
                  disabled={!data.current || pending === "thinking"}
                />
                <Select.Content>
                  {data.thinkingLevels.map((level) => (
                    <Select.Item key={level} value={level}>
                      {t(`thinking_${level}`)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </section>

          <section className="settingsSection" aria-labelledby="access-heading">
            <div className="sectionHeading">
              <div>
                <Heading id="access-heading" size="4">
                  {t("configuredAccess")}
                </Heading>
                <Text as="p" size="2" color="gray">
                  {t("configuredAccessDescription")}
                </Text>
              </div>
              <Button
                disabled={data.authPending || Boolean(pending)}
                onClick={() => setAccessOpen(true)}
              >
                <PlusIcon /> {t("addAccess")}
              </Button>
            </div>
            {configured?.length ? (
              <div className="accessList">
                {configured.map((provider) => (
                  <div className="accessRow" key={provider.id}>
                    <div className="accessIdentity">
                      <span className="status quiet">{t("connected")}</span>
                      <div>
                        <Text weight="medium">{provider.name}</Text>
                        <Text as="p" size="1" color="gray">
                          {sourceLabel(provider, t)}
                        </Text>
                        {!provider.status.disconnectable && (
                          <Text as="p" size="1" color="gray">
                            {t("managedOutside")}
                          </Text>
                        )}
                      </div>
                    </div>
                    <Flex gap="2">
                      {provider.auth.oauth &&
                        provider.status.credentialType === "oauth" && (
                          <Button
                            variant="ghost"
                            disabled={Boolean(pending)}
                            onClick={() => void login(provider, "oauth")}
                          >
                            {t("reconnect")}
                          </Button>
                        )}
                      {provider.status.disconnectable && (
                        <Button
                          color="red"
                          variant="ghost"
                          disabled={Boolean(pending)}
                          onClick={() => setDisconnectProvider(provider)}
                        >
                          {t("disconnect")}
                        </Button>
                      )}
                    </Flex>
                  </div>
                ))}
              </div>
            ) : (
              <div className="accessEmpty">
                <Text weight="medium">{t("noAccessConfigured")}</Text>
                <Text as="p" size="2" color="gray">
                  {t("configureProviderFirst")}
                </Text>
              </div>
            )}
          </section>

          <section
            className="settingsSection"
            aria-labelledby="preferences-heading"
          >
            <Heading id="preferences-heading" size="4">
              {t("preferences")}
            </Heading>
            <div className="settingRow compactRow">
              <div>
                <Text weight="medium">{t("language")}</Text>
                <Text as="p" size="2" color="gray">
                  English / 繁體中文
                </Text>
              </div>
              <Select.Root
                value={i18n.language}
                onValueChange={(value) =>
                  void setLanguage(value as "en" | "zh-TW")
                }
              >
                <Select.Trigger aria-label={t("language")} />
                <Select.Content>
                  <Select.Item value="en">English</Select.Item>
                  <Select.Item value="zh-TW">繁體中文</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </section>

          <section className="settingsSection" aria-labelledby="agent-heading">
            <Heading id="agent-heading" size="4">
              {t("agent")}
            </Heading>
            <Text weight="medium">{t("activeTools")}</Text>
            <div className="toolChips">
              {session.tools.map((tool) => (
                <code key={tool}>{tool}</code>
              ))}
            </div>
          </section>

          <section
            className="settingsSection"
            aria-labelledby="account-heading"
          >
            <Heading id="account-heading" size="4">
              {t("account")}
            </Heading>
            <Flex>
              <Button
                color="red"
                variant="soft"
                onClick={() =>
                  void api("/api/logout", mutation("POST")).then(() =>
                    window.location.reload(),
                  )
                }
              >
                {t("logout")}
              </Button>
            </Flex>
          </section>
        </>
      )}

      {data && (
        <>
          <ModelAccessDialog
            open={accessOpen}
            providers={data.providers}
            pending={data.authPending || pending?.startsWith("login:") === true}
            onOpenChange={setAccessOpen}
            onApiKey={(provider, apiKey) => login(provider, "api_key", apiKey)}
            onOAuth={(provider) => login(provider, "oauth")}
            onCancelAuth={async () => {
              if (data.authPending || pending?.startsWith("login:")) {
                await api("/api/providers/login/cancel", mutation("POST"));
                await load();
              }
            }}
          />
          <ModelPickerDialog
            current={data.current}
            models={data.models}
            open={modelOpen}
            pending={pending === "model"}
            onApply={chooseModel}
            onOpenChange={setModelOpen}
          />
          <DisconnectProviderDialog
            currentProvider={data.current?.provider}
            open={Boolean(disconnectProvider)}
            pending={pending?.startsWith("logout:") === true}
            provider={disconnectProvider}
            onOpenChange={(open) => !open && setDisconnectProvider(undefined)}
            onConfirm={(provider) =>
              run(
                `logout:${provider.id}`,
                () =>
                  api(`/api/providers/${provider.id}/logout`, mutation("POST")),
                t("providerDisconnected", { provider: provider.name }),
              )
            }
          />
        </>
      )}
    </section>
  );
}
