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
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Time</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Summary</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {runs.map((run) => (
              <Table.Row key={run.id}>
                <Table.Cell>
                  <span className={`status ${run.status}`}>{run.status}</span>
                </Table.Cell>
                <Table.Cell>
                  {new Date(run.startedAt).toLocaleString()}
                </Table.Cell>
                <Table.Cell>{run.summary ?? run.error ?? "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </section>
  );
}
