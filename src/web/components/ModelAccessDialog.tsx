import * as Dialog from "@radix-ui/react-dialog";
import { Button, Callout, Flex, Tabs, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderOption } from "../model-access.js";

interface Props {
  open: boolean;
  providers: ProviderOption[];
  pending: boolean;
  onApiKey: (provider: ProviderOption, apiKey: string) => Promise<boolean>;
  onCancelAuth: () => Promise<void>;
  onOAuth: (provider: ProviderOption) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}

export function ModelAccessDialog({
  open,
  providers,
  pending,
  onApiKey,
  onCancelAuth,
  onOAuth,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<"account" | "api_key">("account");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProviderOption>();
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!open) {
      setMethod("account");
      setQuery("");
      setSelected(undefined);
      setApiKey("");
    }
  }, [open]);

  const options = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return providers
      .filter((provider) =>
        method === "account" ? provider.auth.oauth : provider.auth.apiKey,
      )
      .filter((provider) => {
        if (!normalized) return true;
        const methodName =
          method === "account"
            ? provider.auth.oauth?.name
            : provider.auth.apiKey?.name;
        return `${provider.name} ${methodName}`
          .toLocaleLowerCase()
          .includes(normalized);
      });
  }, [method, providers, query]);

  const close = async () => {
    if (pending) await onCancelAuth();
    onOpenChange(false);
  };

  const choose = async (provider: ProviderOption) => {
    if (method === "api_key") {
      setSelected(provider);
      return;
    }
    onOpenChange(false);
    await onOAuth(provider);
  };

  const saveApiKey = async () => {
    if (!selected || !apiKey) return;
    if (await onApiKey(selected, apiKey)) {
      setApiKey("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content
          className="dialogContent accessDialog"
          aria-describedby="access-description"
        >
          <Dialog.Title className="dialogTitle">{t("addAccess")}</Dialog.Title>
          <Dialog.Description id="access-description" asChild>
            <Text as="p" size="2" color="gray">
              {t("addAccessDescription")}
            </Text>
          </Dialog.Description>
          <Tabs.Root
            value={method}
            onValueChange={(value) => {
              setMethod(value as "account" | "api_key");
              setSelected(undefined);
              setApiKey("");
            }}
          >
            <Tabs.List>
              <Tabs.Trigger value="account">
                {t("subscriptionAccount")}
              </Tabs.Trigger>
              <Tabs.Trigger value="api_key">{t("apiKey")}</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          {selected?.auth.apiKey ? (
            <div className="accessKeyStep">
              <Button
                variant="ghost"
                color="gray"
                onClick={() => {
                  setSelected(undefined);
                  setApiKey("");
                }}
              >
                {t("back")}
              </Button>
              <Text weight="medium">{selected.name}</Text>
              <TextField.Root
                autoFocus
                aria-label={selected.auth.apiKey.name}
                autoComplete="off"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={selected.auth.apiKey.name}
              />
              <Text size="1" color="gray">
                {t("apiKeyStoredByPi")}
              </Text>
              <Flex justify="end" gap="3">
                <Button
                  variant="soft"
                  color="gray"
                  onClick={() => void close()}
                >
                  {t("cancel")}
                </Button>
                <Button
                  disabled={!apiKey || pending}
                  onClick={() => void saveApiKey()}
                >
                  {pending ? t("connecting") : t("saveApiKey")}
                </Button>
              </Flex>
            </div>
          ) : (
            <>
              <TextField.Root
                className="providerSearch"
                aria-label={t("searchProviders")}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchProviders")}
              />
              {pending && (
                <Callout.Root color="blue" role="status">
                  <Callout.Text>{t("completeProviderSignIn")}</Callout.Text>
                </Callout.Root>
              )}
              <div className="providerChoices">
                {options.length === 0 ? (
                  <Text color="gray">{t("noMatchingProviders")}</Text>
                ) : (
                  options.map((provider) => {
                    const oauth = provider.auth.oauth;
                    const apiKeyMethod = provider.auth.apiKey;
                    const methodName =
                      method === "account" ? oauth?.name : apiKeyMethod?.name;
                    return (
                      <button
                        className="providerChoice"
                        disabled={pending}
                        key={`${method}:${provider.id}`}
                        onClick={() => void choose(provider)}
                        type="button"
                      >
                        <span>
                          <strong>{provider.name}</strong>
                          <small>{methodName}</small>
                        </span>
                        {method === "account" && (
                          <small>
                            {oauth?.subscription
                              ? t("subscription")
                              : t("providerAccount")}
                          </small>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <Flex justify="end">
                <Button
                  variant="soft"
                  color="gray"
                  onClick={() => void close()}
                >
                  {t("cancel")}
                </Button>
              </Flex>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
