import {
  Button,
  Checkbox,
  Flex,
  Heading,
  Tabs,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, mutation } from "../api.js";

interface Template {
  name: string;
  content: string;
}

interface PackageInfo {
  source: string;
  scope: string;
  installedPath?: string;
}

function DocumentEditor({
  kind,
  label,
}: {
  kind: "append" | "system";
  label: string;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  useEffect(() => {
    void api<{ content: string }>(`/api/documents/${kind}`).then((result) =>
      setContent(result.content),
    );
  }, [kind]);
  return (
    <div className="editorBlock">
      <Heading size="4">{label}</Heading>
      <TextArea
        rows={14}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        aria-label={label}
      />
      <Button
        onClick={() =>
          void api(`/api/documents/${kind}`, mutation("PUT", { content }))
        }
      >
        {t("save")}
      </Button>
    </div>
  );
}

export function LibraryPage() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [source, setSource] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [mcp, setMcp] = useState('{\n  "mcpServers": {}\n}\n');
  const [mcpError, setMcpError] = useState<string>();
  const [mcpDiagnostics, setMcpDiagnostics] = useState<
    Array<{ server: string; level: string; message: string }>
  >([]);
  const load = useCallback(async () => {
    const [templateData, packageData, mcpData, diagnostics] = await Promise.all(
      [
        api<Template[]>("/api/templates"),
        api<PackageInfo[]>("/api/packages"),
        api<unknown>("/api/mcp"),
        api<{ mcp: Array<{ server: string; level: string; message: string }> }>(
          "/api/diagnostics",
        ),
      ],
    );
    setTemplates(templateData);
    setPackages(packageData);
    setMcp(`${JSON.stringify(mcpData, null, 2)}\n`);
    setMcpDiagnostics(diagnostics.mcp);
  }, []);
  useEffect(() => void load(), [load]);

  const saveTemplate = async () => {
    await api(
      `/api/templates/${templateName}`,
      mutation("PUT", { content: templateContent }),
    );
    setTemplateName("");
    setTemplateContent("");
    await load();
  };
  const installPackage = async () => {
    await api(
      "/api/packages",
      mutation("POST", { source, acknowledgeRisk: trusted }),
    );
    setSource("");
    setTrusted(false);
    await load();
  };
  const saveMcp = async () => {
    try {
      const config = JSON.parse(mcp) as unknown;
      await api("/api/mcp", mutation("PUT", config));
      setMcpError(undefined);
      await load();
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : t("error"));
    }
  };

  return (
    <section className="pageColumn">
      <Heading size="6">{t("library")}</Heading>
      <Tabs.Root defaultValue="system">
        <Tabs.List>
          <Tabs.Trigger value="system">{t("systemPrompt")}</Tabs.Trigger>
          <Tabs.Trigger value="templates">{t("templates")}</Tabs.Trigger>
          <Tabs.Trigger value="packages">{t("packages")}</Tabs.Trigger>
          <Tabs.Trigger value="mcp">{t("mcp")}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="system" className="tabContent">
          <DocumentEditor kind="system" label={t("systemPrompt")} />
          <DocumentEditor kind="append" label={t("appendPrompt")} />
        </Tabs.Content>
        <Tabs.Content value="templates" className="tabContent">
          <div className="editorBlock">
            <Heading size="4">{t("addTemplate")}</Heading>
            <TextField.Root
              placeholder="daily-review"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            <TextArea
              rows={8}
              value={templateContent}
              onChange={(event) => setTemplateContent(event.target.value)}
            />
            <Button
              disabled={!templateName || !templateContent}
              onClick={() => void saveTemplate()}
            >
              {t("save")}
            </Button>
          </div>
          {templates.map((template) => (
            <div className="listRow" key={template.name}>
              <div>
                <Text weight="medium">/{template.name}</Text>
                <Text as="p" size="2" color="gray">
                  {template.content.slice(0, 140)}
                </Text>
              </div>
              <Flex gap="2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTemplateName(template.name);
                    setTemplateContent(template.content);
                  }}
                >
                  {t("edit")}
                </Button>
                <Button
                  color="red"
                  variant="ghost"
                  onClick={() =>
                    void api(
                      `/api/templates/${template.name}`,
                      mutation("DELETE"),
                    ).then(load)
                  }
                >
                  {t("delete")}
                </Button>
              </Flex>
            </div>
          ))}
        </Tabs.Content>
        <Tabs.Content value="packages" className="tabContent">
          <div className="riskNotice">
            <Text weight="medium">{t("packageWarning")}</Text>
          </div>
          <TextField.Root
            placeholder={t("source")}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox
                checked={trusted}
                onCheckedChange={(value) => setTrusted(value === true)}
              />
              {t("confirmInstall")}
            </Flex>
          </Text>
          <Button
            disabled={!trusted || !source}
            onClick={() => void installPackage()}
          >
            {t("install")}
          </Button>
          {packages.map((item) => (
            <div className="listRow" key={`${item.scope}-${item.source}`}>
              <div>
                <Text weight="medium">{item.source}</Text>
                <Text as="p" size="1" color="gray">
                  {item.scope} · {item.installedPath}
                </Text>
              </div>
              <Flex gap="2">
                <Button
                  variant="ghost"
                  onClick={() =>
                    void api(
                      "/api/packages/update",
                      mutation("POST", {
                        source: item.source,
                        acknowledgeRisk: true,
                      }),
                    ).then(load)
                  }
                >
                  {t("update")}
                </Button>
                <Button
                  color="red"
                  variant="ghost"
                  onClick={() =>
                    void api(
                      "/api/packages",
                      mutation("DELETE", {
                        source: item.source,
                        acknowledgeRisk: true,
                      }),
                    ).then(load)
                  }
                >
                  {t("delete")}
                </Button>
              </Flex>
            </div>
          ))}
        </Tabs.Content>
        <Tabs.Content value="mcp" className="tabContent">
          <TextArea
            rows={20}
            className="codeEditor"
            value={mcp}
            onChange={(event) => setMcp(event.target.value)}
            aria-label={t("mcp")}
          />
          {mcpError && <div className="inlineNotice">{mcpError}</div>}
          {mcpDiagnostics.map((diagnostic) => (
            <div
              className="inlineNotice"
              key={`${diagnostic.server}-${diagnostic.message}`}
            >
              {diagnostic.server}: {diagnostic.message}
            </div>
          ))}
          <Button onClick={() => void saveMcp()}>{t("save")}</Button>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
