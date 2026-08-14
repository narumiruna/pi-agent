import { Button, Flex, Heading, Table, Text, TextArea } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, mutation } from "../api.js";
import type { HeartbeatRun } from "../types.js";

export function HeartbeatPage({ refresh }: { refresh: number }) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [runs, setRuns] = useState<HeartbeatRun[]>([]);
  const [diagnostic, setDiagnostic] = useState<string>();
  const load = useCallback(async () => {
    const [document, status] = await Promise.all([
      api<{ content: string }>("/api/documents/heartbeat"),
      api<{ config?: { diagnostic?: string }; runs: HeartbeatRun[] }>(
        "/api/heartbeat",
      ),
    ]);
    setContent(document.content);
    setRuns(status.runs);
    setLoaded(true);
    setDiagnostic(status.config?.diagnostic);
  }, []);
  useEffect(() => {
    void refresh;
    void load();
  }, [refresh, load]);
  const save = async () => {
    await api("/api/documents/heartbeat", mutation("PUT", { content }));
    await load();
  };

  return (
    <section className="pageColumn">
      <div>
        <Heading size="6">{t("heartbeat")}</Heading>
        <Text color="gray">HEARTBEAT.md</Text>
      </div>
      {diagnostic && <div className="inlineNotice">{diagnostic}</div>}
      <TextArea
        rows={14}
        value={content}
        disabled={!loaded}
        onChange={(event) => setContent(event.target.value)}
        aria-label="HEARTBEAT.md"
      />
      <Flex gap="3">
        <Button highContrast disabled={!loaded} onClick={() => void save()}>
          {t("save")}
        </Button>
        <Button
          highContrast
          disabled={!loaded}
          variant="soft"
          onClick={() =>
            void api("/api/heartbeat/run", mutation("POST")).then(load)
          }
        >
          {t("runNow")}
        </Button>
        <Button
          color="red"
          variant="ghost"
          onClick={() => void api("/api/heartbeat/stop", mutation("POST"))}
        >
          {t("stop")}
        </Button>
      </Flex>
      <Heading size="4">{t("lastRuns")}</Heading>
      {runs.length === 0 ? (
        <Text color="gray">{t("noRuns")}</Text>
      ) : (
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>{t("runStatus")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("runTime")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{t("runSummary")}</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {runs.map((run) => {
              const details = run.details;
              const hasDetails = Boolean(
                run.error ||
                  details?.response ||
                  details?.reasoning ||
                  details?.tools?.length,
              );
              return (
                <Table.Row key={run.id}>
                  <Table.Cell>
                    <span
                      className={`status ${run.status}`}
                      title={
                        run.status === "attention"
                          ? t("heartbeatAttentionExplanation")
                          : undefined
                      }
                    >
                      {t(`heartbeatStatus_${run.status}`)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    {new Date(run.startedAt).toLocaleString()}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="heartbeatRunSummary">
                      <span>{run.summary ?? run.error ?? "—"}</span>
                      {hasDetails && (
                        <details className="heartbeatRunDetails">
                          <summary>{t("viewRunDetails")}</summary>
                          <div className="heartbeatRunDetailContent">
                            {run.status === "attention" && (
                              <Text as="p" color="amber" size="2">
                                {t("heartbeatAttentionExplanation")}
                              </Text>
                            )}
                            {run.error && (
                              <section>
                                <strong>{t("runError")}</strong>
                                <pre>{run.error}</pre>
                              </section>
                            )}
                            {details?.response && (
                              <section>
                                <strong>{t("runResponse")}</strong>
                                <pre>{details.response}</pre>
                              </section>
                            )}
                            {details?.reasoning && (
                              <section>
                                <strong>{t("runReasoning")}</strong>
                                <pre>{details.reasoning}</pre>
                              </section>
                            )}
                            {details?.tools?.map((tool) => (
                              <section
                                className={tool.isError ? "toolError" : ""}
                                key={tool.id}
                              >
                                <strong>
                                  {t("runTool", { name: tool.name })}
                                </strong>
                                {tool.input && (
                                  <>
                                    <Text as="p" color="gray" size="1">
                                      {t("runToolInput")}
                                    </Text>
                                    <pre>{tool.input}</pre>
                                  </>
                                )}
                                {tool.output && (
                                  <>
                                    <Text as="p" color="gray" size="1">
                                      {t("runToolOutput")}
                                    </Text>
                                    <pre>{tool.output}</pre>
                                  </>
                                )}
                                {tool.diff && <pre>{tool.diff}</pre>}
                              </section>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}
    </section>
  );
}
