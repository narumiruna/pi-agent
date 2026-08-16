import {
  Button,
  Flex,
  Heading,
  Select,
  Tabs,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isValidPromptName,
  resourceProvenanceLabel,
  type WebProjectTrust,
  type WebPromptInventory,
  type WebPromptResource,
  type WebPromptWriteScope,
} from "../../shared/contracts.js";
import { ApiError, api, mutation } from "../api.js";

interface Feedback {
  kind: "error" | "success" | "warning";
  message: string;
}

function MutationFeedback({ feedback }: { feedback?: Feedback }) {
  if (!feedback) return null;
  return (
    <Text
      as="p"
      className="inlineNotice"
      color={
        feedback.kind === "error"
          ? "red"
          : feedback.kind === "warning"
            ? "amber"
            : "green"
      }
      highContrast
      role={feedback.kind === "error" ? "alert" : "status"}
      size="2"
    >
      {feedback.message}
    </Text>
  );
}

function DocumentEditor({
  kind,
  label,
  description,
}: {
  kind: "append" | "system";
  label: string;
  description: string;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const load = useCallback(async () => {
    setContent(undefined);
    setFeedback(undefined);
    try {
      const result = await api<{ content: string }>(`/api/documents/${kind}`);
      setContent(result.content);
    } catch {
      setFeedback({ kind: "error", message: t("promptDocumentLoadFailed") });
    }
  }, [kind, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (content === undefined || pending) return;
    setPending(true);
    setFeedback(undefined);
    try {
      await api(`/api/documents/${kind}`, mutation("PUT", { content }));
      setFeedback({ kind: "success", message: t("promptDocumentSaved") });
    } catch {
      setFeedback({ kind: "error", message: t("promptDocumentSaveFailed") });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="editorBlock" aria-labelledby={`${kind}-prompt-title`}>
      <div>
        <Heading id={`${kind}-prompt-title`} size="4">
          {label}
        </Heading>
        <Text as="p" color="gray" size="2">
          {description}
        </Text>
      </div>
      <TextArea
        aria-label={label}
        disabled={content === undefined || pending}
        onChange={(event) => setContent(event.target.value)}
        rows={14}
        value={content ?? ""}
      />
      <MutationFeedback feedback={feedback} />
      <Flex gap="2" wrap="wrap">
        <Button
          disabled={content === undefined || pending}
          highContrast
          onClick={() => void save()}
        >
          {pending ? t("saving") : t("save")}
        </Button>
        {content === undefined && feedback?.kind === "error" ? (
          <Button highContrast onClick={() => void load()} variant="soft">
            {t("tryAgain")}
          </Button>
        ) : null}
      </Flex>
    </section>
  );
}

export function PromptsPage({ refresh = 0 }: { refresh?: number }) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<WebPromptResource[]>();
  const [projectTrust, setProjectTrust] = useState<WebProjectTrust>();
  const [templateName, setTemplateName] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [templateScope, setTemplateScope] =
    useState<WebPromptWriteScope>("user");
  const [selected, setSelected] = useState<WebPromptResource>();
  const [pending, setPending] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const discoveryRequest = useRef(0);
  const selectedRef = useRef(selected);
  const templateContentRef = useRef(templateContent);
  selectedRef.current = selected;
  templateContentRef.current = templateContent;

  const invalidateDiscoveryPermissions = useCallback(() => {
    setProjectTrust(undefined);
    setTemplateScope("user");
    const current = selectedRef.current;
    if (!current) return;
    const unavailable = { ...current, editable: false, deletable: false };
    selectedRef.current = unavailable;
    setSelected(unavailable);
  }, []);

  const loadTemplates = useCallback(
    async (selectedId?: string, preserveDraft = false) => {
      const request = ++discoveryRequest.current;
      setTemplates(undefined);
      setFeedback(undefined);
      try {
        const { prompts: resources, projectTrust: trust } =
          await api<WebPromptInventory>("/api/prompt-inventory");
        if (request !== discoveryRequest.current) return;
        setTemplates(resources);
        setProjectTrust(trust);
        if (!trust.trusted) setTemplateScope("user");
        if (selectedId) {
          const current = selectedRef.current;
          if (current?.id !== selectedId) return;
          const refreshed = resources.find(
            (resource) => resource.id === selectedId,
          );
          const keepDraft =
            preserveDraft &&
            refreshed?.editable === true &&
            templateContentRef.current !== current.content;
          if (refreshed) {
            selectedRef.current = refreshed;
            setSelected(refreshed);
            setTemplateName(refreshed.name);
            if (!keepDraft) setTemplateContent(refreshed.content);
            if (
              refreshed.provenance.scope === "user" ||
              refreshed.provenance.scope === "project"
            )
              setTemplateScope(refreshed.provenance.scope);
          } else {
            selectedRef.current = undefined;
            setSelected(undefined);
            setTemplateName("");
            setTemplateContent("");
            setTemplateScope("user");
          }
        }
      } catch {
        if (request !== discoveryRequest.current) return;
        invalidateDiscoveryPermissions();
        setFeedback({ kind: "error", message: t("promptTemplatesLoadFailed") });
      }
    },
    [invalidateDiscoveryPermissions, t],
  );

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const observedRefresh = useRef(refresh);
  useEffect(() => {
    if (observedRefresh.current === refresh) return;
    observedRefresh.current = refresh;
    void loadTemplates(selected?.id, true);
  }, [loadTemplates, refresh, selected?.id]);

  const clearEditor = () => {
    selectedRef.current = undefined;
    setSelected(undefined);
    setTemplateName("");
    setTemplateContent("");
    setTemplateScope("user");
  };

  const refreshDiscovery = async (): Promise<
    WebPromptResource[] | undefined
  > => {
    const request = ++discoveryRequest.current;
    try {
      const { prompts: resources, projectTrust: trust } =
        await api<WebPromptInventory>("/api/prompt-inventory");
      if (request !== discoveryRequest.current) return undefined;
      setTemplates(resources);
      setProjectTrust(trust);
      if (!trust.trusted) setTemplateScope("user");
      return resources;
    } catch (error) {
      if (request !== discoveryRequest.current) return undefined;
      invalidateDiscoveryPermissions();
      throw error;
    }
  };

  const reconcileEditor = (resources: WebPromptResource[]) => {
    const current = selectedRef.current;
    if (!current) return;
    const refreshed = resources.find(
      (candidate) => candidate.id === current.id,
    );
    if (!refreshed) {
      clearEditor();
      return;
    }
    const keepDraft =
      refreshed.editable && templateContentRef.current !== current.content;
    selectedRef.current = refreshed;
    setSelected(refreshed);
    setTemplateName(refreshed.name);
    if (!keepDraft) setTemplateContent(refreshed.content);
    if (
      refreshed.provenance.scope === "user" ||
      refreshed.provenance.scope === "project"
    )
      setTemplateScope(refreshed.provenance.scope);
  };

  const recoverStaleMutation = async (error: unknown) => {
    if (!(error instanceof ApiError) || ![403, 404, 409].includes(error.status))
      return;
    try {
      const resources = await refreshDiscovery();
      if (resources) reconcileEditor(resources);
    } catch {
      // Preserve the mutation error when recovery also fails.
    }
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (
      (!selected && !isValidPromptName(name)) ||
      pending ||
      (selected && !selected.editable)
    )
      return;
    setPending("save");
    setFeedback(undefined);
    try {
      try {
        if (selected) {
          await api(
            `/api/prompts/${encodeURIComponent(selected.id)}`,
            mutation("PUT", { content: templateContent }),
          );
        } else {
          await api(
            "/api/prompts",
            mutation("POST", {
              name,
              content: templateContent,
              scope: templateScope,
            }),
          );
        }
      } catch (error) {
        await recoverStaleMutation(error);
        setFeedback({
          kind: "error",
          message: t("promptTemplateSaveFailed"),
        });
        return;
      }
      clearEditor();
      try {
        await refreshDiscovery();
        setFeedback({ kind: "success", message: t("promptTemplateSaved") });
      } catch {
        setFeedback({
          kind: "warning",
          message: t("promptTemplateSavedRefreshFailed"),
        });
      }
    } finally {
      setPending(undefined);
    }
  };

  const deleteTemplate = async (template: WebPromptResource) => {
    if (pending || !template.deletable) return;
    setPending(`delete:${template.id}`);
    setFeedback(undefined);
    try {
      try {
        await api(
          `/api/prompts/${encodeURIComponent(template.id)}`,
          mutation("DELETE"),
        );
      } catch (error) {
        await recoverStaleMutation(error);
        setFeedback({
          kind: "error",
          message: t("promptTemplateDeleteFailed"),
        });
        return;
      }
      setTemplates((current) =>
        current?.filter((candidate) => candidate.id !== template.id),
      );
      if (selected?.id === template.id) clearEditor();
      try {
        const resources = await refreshDiscovery();
        if (resources) reconcileEditor(resources);
        setFeedback({ kind: "success", message: t("promptTemplateDeleted") });
      } catch {
        setFeedback({
          kind: "warning",
          message: t("promptTemplateDeletedRefreshFailed"),
        });
      }
    } finally {
      setPending(undefined);
    }
  };

  const selectTemplate = (template: WebPromptResource) => {
    selectedRef.current = template;
    setSelected(template);
    setTemplateName(template.name);
    setTemplateContent(template.content);
    if (
      template.provenance.scope === "user" ||
      template.provenance.scope === "project"
    )
      setTemplateScope(template.provenance.scope);
    setFeedback(undefined);
  };

  return (
    <section className="pageColumn" aria-labelledby="prompts-page-title">
      <div>
        <Heading id="prompts-page-title" size="6">
          {t("prompts")}
        </Heading>
        <Text as="p" color="gray" size="2">
          {t("promptsDescription")}
        </Text>
      </div>
      <Tabs.Root defaultValue="system">
        <Tabs.List aria-label={t("prompts")}>
          <Tabs.Trigger value="system">{t("systemPrompts")}</Tabs.Trigger>
          <Tabs.Trigger value="templates">{t("templates")}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className="tabContent" value="system">
          <DocumentEditor
            description={t("systemPromptDescription")}
            kind="system"
            label={t("systemPrompt")}
          />
          <DocumentEditor
            description={t("appendPromptDescription")}
            kind="append"
            label={t("appendPrompt")}
          />
        </Tabs.Content>
        <Tabs.Content className="tabContent" value="templates">
          <section
            className="editorBlock"
            aria-labelledby="template-editor-title"
          >
            <Heading id="template-editor-title" size="4">
              {selected
                ? selected.editable
                  ? t("editPromptTemplate", { name: selected.name })
                  : t("viewPromptTemplate", { name: selected.name })
                : t("addTemplate")}
            </Heading>
            {!selected ? (
              <div className="promptScopeField">
                <Text id="prompt-scope-label" size="2" weight="medium">
                  {t("promptScope")}
                </Text>
                <Select.Root
                  onValueChange={(value) =>
                    setTemplateScope(value as WebPromptWriteScope)
                  }
                  value={templateScope}
                >
                  <Select.Trigger aria-labelledby="prompt-scope-label" />
                  <Select.Content>
                    <Select.Item value="user">
                      {t("promptScopeUser")}
                    </Select.Item>
                    <Select.Item
                      disabled={!projectTrust?.trusted}
                      value="project"
                    >
                      {t("promptScopeProject")}
                    </Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
            ) : null}
            {!selected && !projectTrust?.trusted ? (
              <Text as="p" color="gray" size="1">
                {t("projectPromptTrustRequired")}
              </Text>
            ) : null}
            {selected ? (
              <div className="promptResourceMetadata">
                <Text as="p" size="2">
                  {resourceProvenanceLabel(selected.provenance)} ·{" "}
                  {selected.editable ? t("editable") : t("readOnly")}
                </Text>
                <Text as="p" color="gray" size="1">
                  {t("promptSource")}: {selected.source}
                </Text>
                <Text as="p" color="gray" size="1">
                  {t("promptPath")}: {selected.path}
                </Text>
                {selected.argumentHint ? (
                  <Text as="p" color="gray" size="1">
                    {t("promptArgumentHint")}: {selected.argumentHint}
                  </Text>
                ) : null}
              </div>
            ) : null}
            <TextField.Root
              aria-label={t("promptTemplateName")}
              disabled={Boolean(selected) || Boolean(pending)}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="daily-review"
              value={templateName}
            />
            {!selected ? (
              <Text as="p" color="gray" size="1">
                {t("promptNameRequirement")}
              </Text>
            ) : null}
            <TextArea
              aria-label={t("promptTemplateContent")}
              disabled={Boolean(pending)}
              onChange={(event) => setTemplateContent(event.target.value)}
              readOnly={Boolean(selected && !selected.editable)}
              rows={10}
              value={templateContent}
            />
            {selected && !selected.editable ? (
              <Text as="p" className="inlineNotice" role="status" size="2">
                {selected.contentTruncated
                  ? t("promptContentTruncated")
                  : t("promptReadOnlyDescription")}
              </Text>
            ) : null}
            <Flex gap="2" wrap="wrap">
              {!selected || selected.editable ? (
                <Button
                  disabled={
                    Boolean(pending) ||
                    (!selected && !isValidPromptName(templateName.trim()))
                  }
                  highContrast
                  onClick={() => void saveTemplate()}
                >
                  {pending === "save" ? t("saving") : t("save")}
                </Button>
              ) : null}
              {selected ? (
                <Button
                  disabled={Boolean(pending)}
                  highContrast
                  onClick={clearEditor}
                  variant="soft"
                >
                  {selected.editable ? t("cancel") : t("close")}
                </Button>
              ) : null}
            </Flex>
          </section>
          <MutationFeedback feedback={feedback} />
          {feedback?.kind === "warning" ? (
            <Button
              highContrast
              onClick={() => void loadTemplates(selected?.id)}
              variant="soft"
            >
              {t("tryAgain")}
            </Button>
          ) : null}
          {templates === undefined && feedback?.kind !== "error" ? (
            <Text color="gray">{t("loading")}</Text>
          ) : null}
          {templates === undefined && feedback?.kind === "error" ? (
            <Button
              highContrast
              onClick={() => void loadTemplates(selected?.id)}
              variant="soft"
            >
              {t("tryAgain")}
            </Button>
          ) : null}
          {templates?.length === 0 ? (
            <Text color="gray">{t("noPromptTemplates")}</Text>
          ) : null}
          {templates?.map((template) => (
            <article className="listRow promptTemplateRow" key={template.id}>
              <div className="promptTemplateSummary">
                <Text weight="medium">/{template.name}</Text>
                <Text as="p" color="gray" size="1">
                  {resourceProvenanceLabel(template.provenance)} ·{" "}
                  {template.editable ? t("editable") : t("readOnly")}
                </Text>
                <Text as="p" color="gray" size="1">
                  {t("promptSource")}: {template.source}
                </Text>
                <Text
                  as="p"
                  className="promptResourcePath"
                  color="gray"
                  size="1"
                >
                  {template.path}
                </Text>
                {template.description ? (
                  <Text as="p" color="gray" size="2">
                    {template.description}
                  </Text>
                ) : null}
              </div>
              <Flex gap="2" wrap="wrap">
                <Button
                  aria-label={
                    template.editable
                      ? t("editPromptTemplate", { name: template.name })
                      : t("viewPromptTemplate", { name: template.name })
                  }
                  disabled={Boolean(pending)}
                  highContrast
                  onClick={() => selectTemplate(template)}
                  variant="ghost"
                >
                  {template.editable ? t("edit") : t("view")}
                </Button>
                {template.deletable ? (
                  <Button
                    aria-label={t("deletePromptTemplate", {
                      name: template.name,
                    })}
                    color="red"
                    disabled={Boolean(pending)}
                    highContrast
                    onClick={() => void deleteTemplate(template)}
                    variant="ghost"
                  >
                    {pending === `delete:${template.id}`
                      ? t("deleting")
                      : t("delete")}
                  </Button>
                ) : null}
              </Flex>
            </article>
          ))}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
