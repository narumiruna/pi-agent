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
import {
  resourceProvenanceLabel,
  type WebMcpDiagnostic,
  type WebPackageSummary,
} from "../../shared/contracts.js";
import { api, mutation } from "../api.js";
import { TrustedCodeWarning } from "../components/TrustedCodeWarning.js";

export function LibraryPage() {
  const { t } = useTranslation();
  const [packages, setPackages] = useState<WebPackageSummary[]>([]);
  const [source, setSource] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mcp, setMcp] = useState('{\n  "mcpServers": {}\n}\n');
  const [mcpError, setMcpError] = useState<string>();
  const [mcpDiagnostics, setMcpDiagnostics] = useState<WebMcpDiagnostic[]>([]);
  const load = useCallback(async () => {
    const [packageData, mcpData, diagnostics] = await Promise.all([
      api<WebPackageSummary[]>("/api/packages"),
      api<unknown>("/api/mcp"),
      api<{ mcp: WebMcpDiagnostic[] }>("/api/diagnostics"),
    ]);
    setPackages(packageData);
    setMcp(`${JSON.stringify(mcpData, null, 2)}\n`);
    setMcpDiagnostics(diagnostics.mcp);
    setLoaded(true);
  }, []);
  useEffect(() => void load(), [load]);

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
      <Tabs.Root defaultValue="packages">
        <Tabs.List>
          <Tabs.Trigger value="packages">{t("packages")}</Tabs.Trigger>
          <Tabs.Trigger value="mcp">{t("mcp")}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className="tabContent" value="packages">
          <TrustedCodeWarning />
          <TextField.Root
            onChange={(event) => setSource(event.target.value)}
            placeholder={t("source")}
            value={source}
          />
          <Text as="label" size="2">
            <Flex align="center" gap="2">
              <Checkbox
                checked={trusted}
                onCheckedChange={(value) => setTrusted(value === true)}
              />
              {t("confirmInstall")}
            </Flex>
          </Text>
          <Button
            disabled={!trusted || !source}
            highContrast
            onClick={() => void installPackage()}
          >
            {t("install")}
          </Button>
          {packages.map((item) => (
            <div className="listRow" key={item.id}>
              <div>
                <Text weight="medium">{item.name}</Text>
                <Text as="p" color="gray" size="1">
                  {resourceProvenanceLabel(item.provenance)}
                </Text>
              </div>
              <Flex gap="2">
                <Button
                  onClick={() =>
                    void api(
                      "/api/packages/update",
                      mutation("POST", {
                        id: item.id,
                        acknowledgeRisk: true,
                      }),
                    ).then(load)
                  }
                  variant="ghost"
                >
                  {t("update")}
                </Button>
                <Button
                  color="red"
                  onClick={() =>
                    void api(
                      "/api/packages",
                      mutation("DELETE", {
                        id: item.id,
                        acknowledgeRisk: true,
                      }),
                    ).then(load)
                  }
                  variant="ghost"
                >
                  {t("delete")}
                </Button>
              </Flex>
            </div>
          ))}
        </Tabs.Content>
        <Tabs.Content className="tabContent" value="mcp">
          <TrustedCodeWarning />
          <TextArea
            aria-label={t("mcp")}
            className="codeEditor"
            disabled={!loaded}
            onChange={(event) => setMcp(event.target.value)}
            rows={20}
            value={mcp}
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
          <Button
            disabled={!loaded}
            highContrast
            onClick={() => void saveMcp()}
          >
            {t("save")}
          </Button>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
