import {
  Button,
  Flex,
  Heading,
  Select,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isValidSkillDescription,
  isValidSkillName,
  resourceProvenanceLabel,
  type WebSkillDiagnostic,
  type WebSkillFileDocument,
  type WebSkillFileEntry,
  type WebSkillInventory,
  type WebSkillResource,
  type WebSkillSettings,
  type WebSkillWriteScope,
} from "../../shared/contracts.js";
import { api, mutation } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

interface Feedback {
  kind: "error" | "success";
  message: string;
}

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

function MutationFeedback({ feedback }: { feedback?: Feedback }) {
  if (!feedback) return null;
  return (
    <Text
      as="p"
      className="inlineNotice"
      color={feedback.kind === "error" ? "red" : "green"}
      highContrast
      role={feedback.kind === "error" ? "alert" : "status"}
      size="2"
    >
      {feedback.message}
    </Text>
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
  const [fileDocument, setFileDocument] = useState<WebSkillFileDocument>();
  const [draft, setDraft] = useState("");
  const [loadingFile, setLoadingFile] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [pending, setPending] = useState<
    "create" | "delete" | "save" | "settings"
  >();
  const [deleteTarget, setDeleteTarget] = useState<WebSkillResource>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<WebSkillWriteScope>("user");
  const inventoryRequest = useRef(0);
  const fileRequest = useRef(0);
  const observedRefresh = useRef(refresh);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const loadInventory = useCallback(async (): Promise<boolean> => {
    const request = ++inventoryRequest.current;
    fileRequest.current += 1;
    setInventory(undefined);
    setFileDocument(undefined);
    setDraft("");
    setLoadingFile(undefined);
    setLoadError(undefined);
    try {
      const result = await api<WebSkillInventory>("/api/skill-inventory");
      if (request !== inventoryRequest.current) return false;
      setInventory(result);
      if (!result.projectTrust.trusted) setScope("user");
      const current = selectedIdRef.current;
      if (current && !result.skills.some(({ id }) => id === current)) {
        selectedIdRef.current = undefined;
        setSelectedId(undefined);
      }
      return true;
    } catch {
      if (request !== inventoryRequest.current) return false;
      setLoadError(t("skillsLoadFailed"));
      return false;
    }
  }, [t]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (observedRefresh.current === refresh) return;
    observedRefresh.current = refresh;
    setFeedback(undefined);
    void loadInventory();
  }, [loadInventory, refresh]);

  const loadFile = async (skill: WebSkillResource, file: WebSkillFileEntry) => {
    if (file.kind !== "text") return;
    const request = ++fileRequest.current;
    setLoadingFile(file.path);
    setFileDocument(undefined);
    setDraft("");
    setLoadError(undefined);
    setFeedback(undefined);
    try {
      const result = await api<WebSkillFileDocument>(
        `/api/skills/${encodeURIComponent(skill.id)}/files?path=${encodeURIComponent(file.path)}`,
      );
      if (request !== fileRequest.current) return;
      setFileDocument(result);
      setDraft(result.content ?? "");
    } catch {
      if (request !== fileRequest.current) return;
      setLoadError(t("skillFileLoadFailed"));
    } finally {
      if (request === fileRequest.current) setLoadingFile(undefined);
    }
  };

  const selectSkill = (skill: WebSkillResource) => {
    fileRequest.current += 1;
    selectedIdRef.current = skill.id;
    setSelectedId(skill.id);
    setFileDocument(undefined);
    setDraft("");
    setLoadingFile(undefined);
    setLoadError(undefined);
    setFeedback(undefined);
  };

  const createSkill = async () => {
    const normalizedName = name.trim();
    if (
      pending ||
      !isValidSkillName(normalizedName) ||
      !isValidSkillDescription(description)
    ) {
      setFeedback({ kind: "error", message: t("skillMetadataInvalid") });
      return;
    }
    setPending("create");
    setFeedback(undefined);
    try {
      await api(
        "/api/skills",
        mutation("POST", {
          scope,
          name: normalizedName,
          description: description.trim(),
        }),
      );
      setName("");
      setDescription("");
      if (await loadInventory())
        setFeedback({ kind: "success", message: t("skillCreated") });
      else setFeedback({ kind: "error", message: t("skillsRefreshFailed") });
    } catch {
      setFeedback({ kind: "error", message: t("skillCreateFailed") });
    } finally {
      setPending(undefined);
    }
  };

  const updateCommands = async (enabled: boolean) => {
    if (pending) return;
    setPending("settings");
    setFeedback(undefined);
    try {
      await api<WebSkillSettings>(
        "/api/skill-settings",
        mutation("PUT", { enableSkillCommands: enabled }),
      );
      if (await loadInventory())
        setFeedback({ kind: "success", message: t("skillSettingsSaved") });
      else setFeedback({ kind: "error", message: t("skillsRefreshFailed") });
    } catch {
      setFeedback({ kind: "error", message: t("skillSettingsSaveFailed") });
    } finally {
      setPending(undefined);
    }
  };

  const selected = inventory?.skills.find(({ id }) => id === selectedId);
  const entryPath = selected?.files.find(({ entry }) => entry)?.path;
  const editableDocument = Boolean(
    selected?.editable &&
      fileDocument?.kind === "text" &&
      fileDocument.path === entryPath,
  );

  const saveSkill = async () => {
    if (!selected || !editableDocument || pending) return;
    setPending("save");
    setFeedback(undefined);
    try {
      await api(
        `/api/skills/${encodeURIComponent(selected.id)}`,
        mutation("PUT", { content: draft }),
      );
      if (await loadInventory())
        setFeedback({ kind: "success", message: t("skillSaved") });
      else setFeedback({ kind: "error", message: t("skillsRefreshFailed") });
    } catch {
      setFeedback({ kind: "error", message: t("skillSaveFailed") });
    } finally {
      setPending(undefined);
    }
  };

  const deleteSkill = async () => {
    if (!deleteTarget || pending) return;
    setPending("delete");
    setFeedback(undefined);
    try {
      await api(
        `/api/skills/${encodeURIComponent(deleteTarget.id)}`,
        mutation("DELETE"),
      );
      setDeleteTarget(undefined);
      if (await loadInventory())
        setFeedback({ kind: "success", message: t("skillDeleted") });
      else setFeedback({ kind: "error", message: t("skillsRefreshFailed") });
    } catch {
      setFeedback({ kind: "error", message: t("skillDeleteFailed") });
    } finally {
      setPending(undefined);
    }
  };

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
      <MutationFeedback feedback={feedback} />
      <SkillDiagnostics diagnostics={globalDiagnostics} />
      {loadError ? (
        <div>
          <Text as="p" className="inlineNotice" color="red" role="alert">
            {loadError}
          </Text>
          {!inventory ? (
            <Button highContrast onClick={() => void loadInventory()}>
              {t("tryAgain")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!inventory && !loadError ? (
        <Text color="gray">{t("loading")}</Text>
      ) : null}

      {inventory ? (
        <section
          className="skillManagement"
          aria-labelledby="skill-create-title"
        >
          <div className="skillSettingRow">
            <div>
              <Heading size="3">{t("skillCommandsTitle")}</Heading>
              <Text as="p" color="gray" size="2">
                {t("skillCommandsDescription")}
              </Text>
            </div>
            <Switch
              aria-label={t("skillCommandsTitle")}
              checked={inventory.skillCommandsEnabled}
              disabled={Boolean(pending)}
              onCheckedChange={(checked) => void updateCommands(checked)}
            />
          </div>

          <div className="skillCreateForm">
            <div>
              <Heading id="skill-create-title" size="3">
                {t("createSkillTitle")}
              </Heading>
              <Text as="p" color="gray" size="2">
                {t("createSkillDescription")}
              </Text>
            </div>
            <div className="skillField">
              <Text as="label" htmlFor="skill-name" size="2" weight="medium">
                {t("skillName")}
              </Text>
              <TextField.Root
                id="skill-name"
                disabled={Boolean(pending)}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="review-code"
                value={name}
              />
            </div>
            <div className="skillField">
              <Text
                as="label"
                htmlFor="skill-description"
                size="2"
                weight="medium"
              >
                {t("skillDescription")}
              </Text>
              <TextArea
                id="skill-description"
                disabled={Boolean(pending)}
                maxLength={1_024}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                value={description}
              />
            </div>
            <div className="skillScopeField">
              <Text id="skill-scope-label" as="span" size="2" weight="medium">
                {t("skillScope")}
              </Text>
              <Select.Root
                disabled={Boolean(pending)}
                onValueChange={(value) => setScope(value as WebSkillWriteScope)}
                value={scope}
              >
                <Select.Trigger aria-labelledby="skill-scope-label" />
                <Select.Content>
                  <Select.Item value="user">{t("skillScopeUser")}</Select.Item>
                  <Select.Item
                    disabled={!inventory.projectTrust.trusted}
                    value="project"
                  >
                    {t("skillScopeProject")}
                  </Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <Button
              disabled={Boolean(pending)}
              highContrast
              onClick={() => void createSkill()}
            >
              {pending === "create" ? t("saving") : t("createSkill")}
            </Button>
          </div>
        </section>
      ) : null}

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
              <Text as="p" color="gray" size="1">
                {skill.commandEnabled
                  ? t("skillCommandEnabled")
                  : t("skillCommandDisabled")}
                {" · "}
                {skill.modelInvocationEnabled
                  ? t("skillModelEnabled")
                  : t("skillModelDisabled")}
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
            {!selected.editable ? (
              <Text as="p" color="gray" size="1">
                {t("skillReadOnly")}
              </Text>
            ) : null}
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
                    disabled={Boolean(loadingFile || pending)}
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
          {fileDocument ? (
            <section
              className="skillDocument"
              aria-labelledby="skill-document-title"
            >
              <Heading id="skill-document-title" size="3">
                {fileDocument.path}
              </Heading>
              <Text as="p" color="gray" size="1">
                {fileKindLabel(fileDocument, t)} ·{" "}
                {formatBytes(fileDocument.size)}
              </Text>
              {fileDocument.kind === "text" ? (
                editableDocument ? (
                  <>
                    <TextArea
                      aria-label={t("skillDocumentContent")}
                      disabled={Boolean(pending)}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={18}
                      value={draft}
                    />
                    <Button
                      disabled={Boolean(pending)}
                      highContrast
                      onClick={() => void saveSkill()}
                    >
                      {pending === "save" ? t("saving") : t("save")}
                    </Button>
                  </>
                ) : (
                  <pre>{fileDocument.content ?? ""}</pre>
                )
              ) : null}
            </section>
          ) : null}
          <Flex gap="2" wrap="wrap">
            {selected.deletable ? (
              <Button
                color="red"
                disabled={Boolean(pending)}
                highContrast
                onClick={() => setDeleteTarget(selected)}
                variant="soft"
              >
                {t("delete")}
              </Button>
            ) : null}
            <Button
              highContrast
              onClick={() => {
                fileRequest.current += 1;
                selectedIdRef.current = undefined;
                setSelectedId(undefined);
                setFileDocument(undefined);
                setDraft("");
                setLoadError(undefined);
                setFeedback(undefined);
              }}
              variant="soft"
            >
              {t("close")}
            </Button>
          </Flex>
        </section>
      ) : null}

      <ConfirmDialog
        confirmLabel={pending === "delete" ? t("deleting") : t("delete")}
        description={t("deleteSkillDescription", {
          name: deleteTarget?.name ?? "",
        })}
        destructive
        open={Boolean(deleteTarget)}
        pending={pending === "delete"}
        title={t("deleteSkill", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => void deleteSkill()}
        onOpenChange={(open) => {
          if (!open && pending !== "delete") setDeleteTarget(undefined);
        }}
      />
    </section>
  );
}
