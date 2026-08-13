import { Button, Flex, Heading, Select, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, mutation } from "../api.js";
import { setLanguage } from "../i18n.js";
import type { SessionInfo } from "../types.js";

interface ModelData {
  current?: { provider: string; id: string; name: string };
  thinkingLevel: string;
  models: Array<{ provider: string; id: string; name: string }>;
  providers: Array<{
    id: string;
    name: string;
    status: unknown;
    auth: { apiKey?: string; oauth?: string };
  }>;
}

export function SettingsPage({ session }: { session: SessionInfo }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ModelData>();
  const load = useCallback(
    () => api<ModelData>("/api/models").then(setData),
    [],
  );
  useEffect(() => void load(), [load]);
  const modelValue = data?.current
    ? `${data.current.provider}/${data.current.id}`
    : "";
  return (
    <section className="pageColumn settingsPage">
      <Heading size="6">{t("settings")}</Heading>
      <div className="settingRow">
        <div>
          <Text weight="medium">{t("language")}</Text>
          <Text as="p" size="2" color="gray">
            English / 繁體中文
          </Text>
        </div>
        <Select.Root
          value={i18n.language}
          onValueChange={(value) => void setLanguage(value as "en" | "zh-TW")}
        >
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="en">English</Select.Item>
            <Select.Item value="zh-TW">繁體中文</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      <div className="settingRow">
        <div>
          <Text weight="medium">Model</Text>
          <Text as="p" size="2" color="gray">
            {data?.current?.name}
          </Text>
        </div>
        {data && (
          <Select.Root
            value={modelValue}
            onValueChange={(value) => {
              const separator = value.indexOf("/");
              void api(
                "/api/model",
                mutation("PUT", {
                  provider: value.slice(0, separator),
                  modelId: value.slice(separator + 1),
                }),
              ).then(load);
            }}
          >
            <Select.Trigger placeholder="Select model" />
            <Select.Content>
              {data.models.map((model) => (
                <Select.Item
                  key={`${model.provider}/${model.id}`}
                  value={`${model.provider}/${model.id}`}
                >
                  {model.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
      </div>
      <div className="settingRow">
        <Text weight="medium">Thinking</Text>
        <Select.Root
          value={data?.thinkingLevel ?? "off"}
          onValueChange={(level) =>
            void api("/api/thinking", mutation("PUT", { level })).then(load)
          }
        >
          <Select.Trigger />
          <Select.Content>
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(
              (level) => (
                <Select.Item key={level} value={level}>
                  {level}
                </Select.Item>
              ),
            )}
          </Select.Content>
        </Select.Root>
      </div>
      <Heading size="4">{t("providers")}</Heading>
      {data?.providers.map((provider) => (
        <div className="settingRow" key={provider.id}>
          <div>
            <Text weight="medium">{provider.name}</Text>
            <Text as="p" size="1" color="gray">
              {typeof provider.status === "string"
                ? provider.status
                : JSON.stringify(provider.status)}
            </Text>
          </div>
          <Flex gap="2" wrap="wrap" justify="end">
            {provider.auth.apiKey && (
              <Button
                variant="soft"
                onClick={() =>
                  void api(
                    `/api/providers/${provider.id}/login`,
                    mutation("POST", { type: "api_key" }),
                  ).then(load)
                }
              >
                {provider.auth.apiKey}
              </Button>
            )}
            {provider.auth.oauth && (
              <Button
                variant="soft"
                onClick={() =>
                  void api(
                    `/api/providers/${provider.id}/login`,
                    mutation("POST", { type: "oauth" }),
                  ).then(load)
                }
              >
                {provider.auth.oauth}
              </Button>
            )}
            <Button
              color="red"
              variant="ghost"
              onClick={() =>
                void api(
                  `/api/providers/${provider.id}/logout`,
                  mutation("POST"),
                ).then(load)
              }
            >
              {t("providerLogout")}
            </Button>
          </Flex>
        </div>
      ))}
      <Heading size="4">{t("activeTools")}</Heading>
      <div className="toolChips">
        {session.tools.map((tool) => (
          <code key={tool}>{tool}</code>
        ))}
      </div>
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
    </section>
  );
}
