import {
  Button,
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
  type WebPromptTemplateDocument,
} from "../../shared/contracts.js";
import { api, mutation } from "../api.js";

interface Feedback {
  kind: "error" | "success";
  message: string;
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
          <Button onClick={() => void load()} variant="soft">
            {t("tryAgain")}
          </Button>
        ) : null}
      </Flex>
    </section>
  );
}

export function PromptsPage() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<WebPromptTemplateDocument[]>();
  const [templateName, setTemplateName] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [editingName, setEditingName] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();

  const loadTemplates = useCallback(async () => {
    setTemplates(undefined);
    setFeedback(undefined);
    try {
      setTemplates(await api<WebPromptTemplateDocument[]>("/api/templates"));
    } catch {
      setFeedback({ kind: "error", message: t("promptTemplatesLoadFailed") });
    }
  }, [t]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const clearEditor = () => {
    setEditingName(undefined);
    setTemplateName("");
    setTemplateContent("");
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name || !templateContent || pending) return;
    setPending("save");
    setFeedback(undefined);
    try {
      await api(
        `/api/templates/${encodeURIComponent(name)}`,
        mutation("PUT", { content: templateContent }),
      );
      setTemplates(await api<WebPromptTemplateDocument[]>("/api/templates"));
      clearEditor();
      setFeedback({ kind: "success", message: t("promptTemplateSaved") });
    } catch {
      setFeedback({ kind: "error", message: t("promptTemplateSaveFailed") });
    } finally {
      setPending(undefined);
    }
  };

  const deleteTemplate = async (name: string) => {
    if (pending) return;
    setPending(`delete:${name}`);
    setFeedback(undefined);
    try {
      await api(
        `/api/templates/${encodeURIComponent(name)}`,
        mutation("DELETE"),
      );
      setTemplates((current) =>
        current?.filter((template) => template.name !== name),
      );
      if (editingName === name) clearEditor();
      setFeedback({ kind: "success", message: t("promptTemplateDeleted") });
    } catch {
      setFeedback({ kind: "error", message: t("promptTemplateDeleteFailed") });
    } finally {
      setPending(undefined);
    }
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
              {editingName
                ? t("editPromptTemplate", { name: editingName })
                : t("addTemplate")}
            </Heading>
            <TextField.Root
              aria-label={t("promptTemplateName")}
              disabled={Boolean(editingName) || Boolean(pending)}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="daily-review"
              value={templateName}
            />
            <TextArea
              aria-label={t("promptTemplateContent")}
              disabled={Boolean(pending)}
              onChange={(event) => setTemplateContent(event.target.value)}
              rows={10}
              value={templateContent}
            />
            <Flex gap="2" wrap="wrap">
              <Button
                disabled={
                  Boolean(pending) || !templateName.trim() || !templateContent
                }
                highContrast
                onClick={() => void saveTemplate()}
              >
                {pending === "save" ? t("saving") : t("save")}
              </Button>
              {editingName ? (
                <Button
                  disabled={Boolean(pending)}
                  onClick={clearEditor}
                  variant="soft"
                >
                  {t("cancel")}
                </Button>
              ) : null}
            </Flex>
          </section>
          <MutationFeedback feedback={feedback} />
          {templates === undefined && feedback?.kind !== "error" ? (
            <Text color="gray">{t("loading")}</Text>
          ) : null}
          {templates === undefined && feedback?.kind === "error" ? (
            <Button onClick={() => void loadTemplates()} variant="soft">
              {t("tryAgain")}
            </Button>
          ) : null}
          {templates?.length === 0 ? (
            <Text color="gray">{t("noPromptTemplates")}</Text>
          ) : null}
          {templates?.map((template) => (
            <article className="listRow promptTemplateRow" key={template.name}>
              <div className="promptTemplateSummary">
                <Text weight="medium">/{template.name}</Text>
                <Text as="p" color="gray" size="1">
                  {resourceProvenanceLabel(template.provenance)}
                </Text>
                <Text as="p" color="gray" size="2">
                  {template.content.slice(0, 140)}
                </Text>
              </div>
              <Flex gap="2" wrap="wrap">
                <Button
                  aria-label={t("editPromptTemplate", {
                    name: template.name,
                  })}
                  disabled={Boolean(pending)}
                  onClick={() => {
                    setEditingName(template.name);
                    setTemplateName(template.name);
                    setTemplateContent(template.content);
                    setFeedback(undefined);
                  }}
                  variant="ghost"
                >
                  {t("edit")}
                </Button>
                <Button
                  aria-label={t("deletePromptTemplate", {
                    name: template.name,
                  })}
                  color="red"
                  disabled={Boolean(pending)}
                  onClick={() => void deleteTemplate(template.name)}
                  variant="ghost"
                >
                  {pending === `delete:${template.name}`
                    ? t("deleting")
                    : t("delete")}
                </Button>
              </Flex>
            </article>
          ))}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
