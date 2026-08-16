import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  resourceProvenanceLabel,
  type WebSkillDiagnostic,
  type WebSkillFileDocument,
  type WebSkillFileEntry,
  type WebSkillInventory,
  type WebSkillResource,
} from "../../shared/contracts.js";
import { api } from "../api.js";

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function SkillDiagnostics({
  diagnostics,
}: {
  diagnostics: WebSkillDiagnostic[];
}) {
  const { t } = useTranslation();
  if (diagnostics.length === 0) return null;
  return (
    <ul aria-label={t("skillValidationWarnings")} className="skillDiagnostics">
      {diagnostics.map((diagnostic) => (
        <li
          key={[
            diagnostic.severity,
            diagnostic.path,
            diagnostic.message,
            diagnostic.skillId,
          ].join("\0")}
        >
          <Text
            color={diagnostic.severity === "error" ? "red" : "amber"}
            highContrast
            size="2"
          >
            {diagnostic.path ? `${diagnostic.path}: ` : ""}
            {diagnostic.message}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function fileKindLabel(
  file: Pick<WebSkillFileEntry, "kind">,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (file.kind) {
    case "text":
      return t("skillFileText");
    case "binary":
      return t("skillFileBinary");
    case "too_large":
      return t("skillFileTooLarge");
    case "unavailable":
      return t("skillFileUnavailable");
  }
}

export function SkillsPage({ refresh = 0 }: { refresh?: number }) {
  const { t } = useTranslation();
  const [inventory, setInventory] = useState<WebSkillInventory>();
  const [selectedId, setSelectedId] = useState<string>();
  const [document, setDocument] = useState<WebSkillFileDocument>();
  const [loadingFile, setLoadingFile] = useState<string>();
  const [error, setError] = useState<string>();
  const inventoryRequest = useRef(0);
  const fileRequest = useRef(0);
  const observedRefresh = useRef(refresh);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const loadInventory = useCallback(async () => {
    const request = ++inventoryRequest.current;
    fileRequest.current += 1;
    setInventory(undefined);
    setDocument(undefined);
    setLoadingFile(undefined);
    setError(undefined);
    try {
      const result = await api<WebSkillInventory>("/api/skill-inventory");
      if (request !== inventoryRequest.current) return;
      setInventory(result);
      const current = selectedIdRef.current;
      if (current && !result.skills.some(({ id }) => id === current)) {
        selectedIdRef.current = undefined;
        setSelectedId(undefined);
      }
    } catch {
      if (request !== inventoryRequest.current) return;
      setError(t("skillsLoadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (observedRefresh.current === refresh) return;
    observedRefresh.current = refresh;
    void loadInventory();
  }, [loadInventory, refresh]);

  const loadFile = async (skill: WebSkillResource, file: WebSkillFileEntry) => {
    if (file.kind !== "text") return;
    const request = ++fileRequest.current;
    setLoadingFile(file.path);
    setDocument(undefined);
    setError(undefined);
    try {
      const result = await api<WebSkillFileDocument>(
        `/api/skills/${encodeURIComponent(skill.id)}/files?path=${encodeURIComponent(file.path)}`,
      );
      if (request !== fileRequest.current) return;
      setDocument(result);
    } catch {
      if (request !== fileRequest.current) return;
      setError(t("skillFileLoadFailed"));
    } finally {
      if (request === fileRequest.current) setLoadingFile(undefined);
    }
  };

  const selectSkill = (skill: WebSkillResource) => {
    fileRequest.current += 1;
    selectedIdRef.current = skill.id;
    setSelectedId(skill.id);
    setDocument(undefined);
    setLoadingFile(undefined);
    setError(undefined);
  };

  const selected = inventory?.skills.find(({ id }) => id === selectedId);
  const globalDiagnostics =
    inventory?.diagnostics.filter(({ skillId }) => !skillId) ?? [];
  const selectedDiagnostics = selected
    ? (inventory?.diagnostics.filter(
        ({ skillId }) => skillId === selected.id,
      ) ?? [])
    : [];

  return (
    <section className="pageColumn" aria-labelledby="skills-page-title">
      <div>
        <Heading id="skills-page-title" size="6">
          {t("skills")}
        </Heading>
        <Text as="p" color="gray" size="2">
          {t("skillsDescription")}
        </Text>
      </div>

      {inventory?.projectTrust.required && !inventory.projectTrust.trusted ? (
        <Text as="p" className="inlineNotice" role="status" size="2">
          {t("skillsProjectTrustRequired")}
        </Text>
      ) : null}
      <SkillDiagnostics diagnostics={globalDiagnostics} />
      {error ? (
        <div>
          <Text as="p" className="inlineNotice" color="red" role="alert">
            {error}
          </Text>
          {!inventory ? (
            <Button highContrast onClick={() => void loadInventory()}>
              {t("tryAgain")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!inventory && !error ? <Text color="gray">{t("loading")}</Text> : null}
      {inventory?.skills.length === 0 ? (
        <Text color="gray">{t("noSkills")}</Text>
      ) : null}

      {inventory?.skills.map((skill) => {
        const warningCount = inventory.diagnostics.filter(
          ({ skillId }) => skillId === skill.id,
        ).length;
        return (
          <article className="listRow skillRow" key={skill.id}>
            <div className="skillSummary">
              <Text weight="medium">{skill.name}</Text>
              <Text as="p" color="gray" size="1">
                {resourceProvenanceLabel(skill.provenance)} · {skill.source}
              </Text>
              <Text as="p" className="skillPath" color="gray" size="1">
                {skill.path}
              </Text>
              <Text as="p" color="gray" size="2">
                {skill.description}
              </Text>
              {warningCount > 0 ? (
                <Text as="p" color="amber" highContrast size="1">
                  {t("skillWarningCount", { count: warningCount })}
                </Text>
              ) : null}
            </div>
            <Button
              aria-label={t("viewSkill", { name: skill.name })}
              highContrast
              onClick={() => selectSkill(skill)}
              variant="ghost"
            >
              {t("view")}
            </Button>
          </article>
        );
      })}

      {selected ? (
        <section className="skillViewer" aria-labelledby="skill-viewer-title">
          <div>
            <Heading id="skill-viewer-title" size="4">
              {selected.name}
            </Heading>
            <Text as="p" color="gray" size="2">
              {selected.description}
            </Text>
          </div>
          <div className="skillMetadata">
            <Text as="p" size="2">
              {resourceProvenanceLabel(selected.provenance)} · {selected.source}
            </Text>
            <Text as="p" color="gray" size="1">
              {t("skillEntryFile")}: {selected.path}
            </Text>
          </div>
          <SkillDiagnostics diagnostics={selectedDiagnostics} />
          <div>
            <Heading size="3">{t("skillFiles")}</Heading>
            {selected.filesTruncated ? (
              <Text as="p" color="amber" highContrast size="1">
                {t("skillFilesTruncated")}
              </Text>
            ) : null}
          </div>
          <div className="skillFileList">
            {selected.files.map((file) => (
              <div className="skillFileRow" key={file.path}>
                <div>
                  <Text weight={file.entry ? "bold" : "regular"}>
                    {file.path}
                  </Text>
                  <Text as="p" color="gray" size="1">
                    {fileKindLabel(file, t)} · {formatBytes(file.size)}
                    {file.entry ? ` · ${t("skillEntry")}` : ""}
                  </Text>
                </div>
                {file.kind === "text" ? (
                  <Button
                    aria-label={t("viewSkillFile", { path: file.path })}
                    disabled={Boolean(loadingFile)}
                    highContrast
                    onClick={() => void loadFile(selected, file)}
                    variant="soft"
                  >
                    {loadingFile === file.path ? t("loading") : t("view")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {document ? (
            <section
              className="skillDocument"
              aria-labelledby="skill-document-title"
            >
              <Heading id="skill-document-title" size="3">
                {document.path}
              </Heading>
              <Text as="p" color="gray" size="1">
                {fileKindLabel(document, t)} · {formatBytes(document.size)}
              </Text>
              {document.kind === "text" ? (
                <pre>{document.content ?? ""}</pre>
              ) : null}
            </section>
          ) : null}
          <Flex gap="2">
            <Button
              highContrast
              onClick={() => {
                fileRequest.current += 1;
                selectedIdRef.current = undefined;
                setSelectedId(undefined);
                setDocument(undefined);
                setError(undefined);
              }}
              variant="soft"
            >
              {t("close")}
            </Button>
          </Flex>
        </section>
      ) : null}
    </section>
  );
}
