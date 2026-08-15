import Editor, { DiffEditor } from "@monaco-editor/react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CodeIcon,
  GearIcon,
  ReaderIcon,
  TextIcon,
} from "@radix-ui/react-icons";
import { Button, Flex, Spinner, Text, TextArea } from "@radix-ui/themes";
import type { editor } from "monaco-editor";
import {
  Component,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  type EditorAppearance,
  type EditorSettings,
  languageForPath,
  languageLabel,
  lineEndingFor,
  workspaceModelUri,
} from "../editor/config.js";
import { monaco } from "../editor/monaco.js";
import { DialogPortal } from "./DialogPortal.js";

const NARROW_EDITOR_QUERY = "(max-width: 720px)";
const MONACO_LOAD_TIMEOUT_MS = 10_000;

interface ErrorBoundaryProps extends PropsWithChildren {
  fallback: ReactNode;
  onError: () => void;
  resetKey: string;
}

interface ErrorBoundaryState {
  failed: boolean;
}

class EditorErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function useNarrowEditor(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.(NARROW_EDITOR_QUERY).matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.(NARROW_EDITOR_QUERY);
    if (!query) return;
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  return narrow;
}

interface PlainEditorProps {
  ariaLabel: string;
  pending: boolean;
  readOnly: boolean;
  settings: EditorSettings;
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  onSave: () => void;
}

function PlainEditor({
  ariaLabel,
  pending,
  readOnly,
  settings,
  value,
  onChange,
  onCursorChange,
  onSave,
}: PlainEditorProps) {
  return (
    <TextArea
      className="filesTextEditor"
      aria-label={ariaLabel}
      readOnly={readOnly}
      rows={24}
      style={{ fontSize: settings.fontSize, tabSize: settings.tabSize }}
      value={value}
      wrap={settings.wordWrap ? "soft" : "off"}
      onChange={(event) => onChange(event.target.value)}
      onSelect={(event) => {
        const beforeCursor = event.currentTarget.value.slice(
          0,
          event.currentTarget.selectionStart,
        );
        const lines = beforeCursor.split("\n");
        onCursorChange?.(lines.length, (lines.at(-1)?.length ?? 0) + 1);
      }}
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s" &&
          !pending &&
          !readOnly
        ) {
          event.preventDefault();
          onSave();
        }
      }}
    />
  );
}

interface MonacoSurfaceProps extends PlainEditorProps {
  appearance: EditorAppearance;
  path: string;
  tabFocusMode: boolean;
  saveLabel: string;
  onCursorChange: (line: number, column: number) => void;
  onFailure: () => void;
  onSave: () => void;
}

function MonacoSurface({
  appearance,
  ariaLabel,
  path,
  pending,
  readOnly,
  settings,
  tabFocusMode,
  value,
  saveLabel,
  onChange,
  onCursorChange,
  onFailure,
  onSave,
}: MonacoSurfaceProps) {
  const { t } = useTranslation();
  const resources = useRef<Array<{ dispose(): void }>>([]);
  const mounted = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveRef = useRef(onSave);
  const pendingRef = useRef(pending);
  const readOnlyRef = useRef(readOnly);
  const saveLabelRef = useRef(saveLabel);

  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onSaveRef.current = onSave;
  pendingRef.current = pending;
  readOnlyRef.current = readOnly;
  saveLabelRef.current = saveLabel;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!mounted.current) onFailure();
    }, MONACO_LOAD_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
      for (const resource of resources.current) resource.dispose();
      resources.current = [];
    };
  }, [onFailure]);

  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      accessibilitySupport: "auto",
      ariaLabel,
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      detectIndentation: false,
      domReadOnly: readOnly,
      fixedOverflowWidgets: true,
      folding: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: settings.fontSize,
      insertSpaces: true,
      links: false,
      minimap: { enabled: settings.minimap },
      multiCursorModifier: "alt",
      padding: { bottom: 12, top: 12 },
      readOnly,
      renderLineHighlight: "all",
      renderWhitespace: settings.whitespace,
      scrollBeyondLastLine: false,
      tabFocusMode,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap ? "on" : "off",
    }),
    [ariaLabel, readOnly, settings, tabFocusMode],
  );

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    mounted.current = true;
    for (const resource of resources.current) resource.dispose();
    resources.current = [
      instance.addAction({
        id: "pi-agent.files.save",
        label: saveLabelRef.current,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          if (!pendingRef.current && !readOnlyRef.current) onSaveRef.current();
        },
      }),
      instance.onDidChangeCursorPosition(({ position }) => {
        onCursorChangeRef.current(position.lineNumber, position.column);
      }),
    ];
    const position = instance.getPosition();
    if (position)
      onCursorChangeRef.current(position.lineNumber, position.column);
  }, []);

  const handleChange = useCallback((next: string | undefined) => {
    onChangeRef.current(next ?? "");
  }, []);

  return (
    <Editor
      className="filesMonacoEditor"
      height="430px"
      keepCurrentModel={false}
      language={languageForPath(path)}
      loading={
        <div className="filesEditorLoading" role="status">
          <Spinner size="1" /> {t("filesEditorLoading")}
        </div>
      }
      options={options}
      path={workspaceModelUri(path)}
      saveViewState={false}
      theme={appearance === "dark" ? "vs-dark" : "light"}
      value={value}
      wrapperProps={{ "data-testid": "monaco-editor" }}
      onChange={handleChange}
      onMount={handleMount}
    />
  );
}

interface EditorSettingsDialogProps {
  open: boolean;
  settings: EditorSettings;
  onOpenChange: (open: boolean) => void;
  onSettingsChange: (settings: EditorSettings) => void;
}

function EditorSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSettingsChange,
}: EditorSettingsDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const update = <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key],
  ) => onSettingsChange({ ...settings, [key]: value });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content className="dialogContent editorSettingsDialog">
          <Dialog.Title className="dialogTitle">
            {t("filesEditorSettings")}
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text as="p" color="gray">
              {t("filesEditorSettingsDescription")}
            </Text>
          </Dialog.Description>
          <div className="editorSettingsGrid">
            <div className="editorSettingRow">
              <Text as="label" htmlFor={`${id}-mode`} weight="medium">
                {t("filesEditorMode")}
              </Text>
              <select
                className="editorSettingsSelect"
                id={`${id}-mode`}
                value={settings.mode}
                onChange={(event) =>
                  update("mode", event.target.value as "monaco" | "plain")
                }
              >
                <option value="monaco">{t("filesMonacoMode")}</option>
                <option value="plain">{t("filesPlainMode")}</option>
              </select>
            </div>
            <div className="editorSettingRow">
              <Text as="label" htmlFor={`${id}-font-size`} weight="medium">
                {t("filesEditorFontSize")}
              </Text>
              <select
                className="editorSettingsSelect"
                id={`${id}-font-size`}
                value={settings.fontSize}
                onChange={(event) =>
                  update(
                    "fontSize",
                    Number(event.target.value) as EditorSettings["fontSize"],
                  )
                }
              >
                {[12, 14, 16, 18, 20].map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </div>
            <div className="editorSettingRow">
              <Text as="label" htmlFor={`${id}-tab-size`} weight="medium">
                {t("filesEditorTabSize")}
              </Text>
              <select
                className="editorSettingsSelect"
                id={`${id}-tab-size`}
                value={settings.tabSize}
                onChange={(event) =>
                  update(
                    "tabSize",
                    Number(event.target.value) as EditorSettings["tabSize"],
                  )
                }
              >
                {[2, 4, 8].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="editorSettingRow">
              <Text as="label" htmlFor={`${id}-word-wrap`} weight="medium">
                {t("filesEditorWordWrap")}
              </Text>
              <select
                className="editorSettingsSelect"
                id={`${id}-word-wrap`}
                value={settings.wordWrap ? "enabled" : "disabled"}
                onChange={(event) =>
                  update("wordWrap", event.target.value === "enabled")
                }
              >
                <option value="enabled">{t("enabled")}</option>
                <option value="disabled">{t("disabled")}</option>
              </select>
            </div>
            <div className="editorSettingRow">
              <Text as="label" htmlFor={`${id}-minimap`} weight="medium">
                {t("filesEditorMinimap")}
              </Text>
              <select
                className="editorSettingsSelect"
                id={`${id}-minimap`}
                value={settings.minimap ? "enabled" : "disabled"}
                onChange={(event) =>
                  update("minimap", event.target.value === "enabled")
                }
              >
                <option value="enabled">{t("enabled")}</option>
                <option value="disabled">{t("disabled")}</option>
              </select>
            </div>
            <div className="editorSettingRow">
              <Text as="label" htmlFor={`${id}-whitespace`} weight="medium">
                {t("filesEditorWhitespace")}
              </Text>
              <select
                className="editorSettingsSelect"
                id={`${id}-whitespace`}
                value={settings.whitespace}
                onChange={(event) =>
                  update(
                    "whitespace",
                    event.target.value as EditorSettings["whitespace"],
                  )
                }
              >
                <option value="none">{t("filesWhitespaceNone")}</option>
                <option value="selection">
                  {t("filesWhitespaceSelection")}
                </option>
                <option value="all">{t("filesWhitespaceAll")}</option>
              </select>
            </div>
          </div>
          <Flex className="dialogActions" justify="end">
            <Dialog.Close asChild>
              <Button highContrast>{t("done")}</Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </DialogPortal>
    </Dialog.Root>
  );
}

export interface CodeEditorProps {
  appearance: EditorAppearance;
  ariaLabel: string;
  path: string;
  pending: boolean;
  readOnly: boolean;
  settings: EditorSettings;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onSettingsChange: (settings: EditorSettings) => void;
}

export function CodeEditor({
  appearance,
  ariaLabel,
  path,
  pending,
  readOnly,
  settings,
  value,
  onChange,
  onSave,
  onSettingsChange,
}: CodeEditorProps) {
  const { t } = useTranslation();
  const narrow = useNarrowEditor();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tabMovesFocus, setTabMovesFocus] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const language = languageForPath(path);
  const plain = narrow || settings.mode === "plain" || runtimeFailed;
  const handleRuntimeFailure = useCallback(() => setRuntimeFailed(true), []);

  const fallback = (
    <PlainEditor
      ariaLabel={ariaLabel}
      pending={pending}
      readOnly={readOnly}
      settings={settings}
      value={value}
      onChange={onChange}
      onCursorChange={(line, column) => setCursor({ line, column })}
      onSave={onSave}
    />
  );

  return (
    <div
      className="codeEditorPanel"
      data-editor-language={language}
      data-editor-mode={plain ? "plain" : "monaco"}
    >
      <div className="codeEditorToolbar">
        <Text size="1" color="gray">
          {plain && narrow
            ? t("filesMobileEditorNotice")
            : t("filesEditorHelp")}
        </Text>
        <Flex gap="2" wrap="wrap">
          {!plain && (
            <Button
              aria-pressed={tabMovesFocus}
              highContrast
              size="1"
              type="button"
              variant="soft"
              onClick={() => setTabMovesFocus((value) => !value)}
            >
              {tabMovesFocus ? t("filesTabMovesFocus") : t("filesTabInserts")}
            </Button>
          )}
          {!narrow && (
            <Button
              highContrast
              size="1"
              type="button"
              variant="soft"
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  mode: settings.mode === "monaco" ? "plain" : "monaco",
                })
              }
            >
              {settings.mode === "monaco" ? <TextIcon /> : <CodeIcon />}
              {settings.mode === "monaco"
                ? t("filesUsePlainEditor")
                : t("filesUseCodeEditor")}
            </Button>
          )}
          <Button
            highContrast
            size="1"
            type="button"
            variant="soft"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon /> {t("filesEditorSettings")}
          </Button>
        </Flex>
      </div>

      {runtimeFailed && !narrow && settings.mode === "monaco" && (
        <div className="filesNotice" role="status">
          <span>{t("filesEditorFallback")}</span>
          <Button
            highContrast
            size="1"
            type="button"
            variant="soft"
            onClick={() => {
              setRuntimeFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            {t("tryAgain")}
          </Button>
        </div>
      )}

      {plain ? (
        fallback
      ) : (
        <EditorErrorBoundary
          fallback={fallback}
          onError={handleRuntimeFailure}
          resetKey={`${path}:${retry}`}
        >
          <MonacoSurface
            key={`${path}:${retry}`}
            appearance={appearance}
            ariaLabel={ariaLabel}
            path={path}
            pending={pending}
            readOnly={readOnly}
            saveLabel={t("save")}
            settings={settings}
            tabFocusMode={tabMovesFocus}
            value={value}
            onChange={onChange}
            onCursorChange={(line, column) => setCursor({ line, column })}
            onFailure={handleRuntimeFailure}
            onSave={onSave}
          />
        </EditorErrorBoundary>
      )}

      <fieldset className="codeEditorStatus">
        <legend className="srOnly">{t("filesEditorStatus")}</legend>
        <span>{languageLabel(language)}</span>
        <span>UTF-8</span>
        <span>{lineEndingFor(value)}</span>
        <span>{t("filesCursorPosition", cursor)}</span>
        {!plain && (
          <span>
            <ReaderIcon aria-hidden="true" /> {t("filesTabFocusHint")}
          </span>
        )}
      </fieldset>

      <EditorSettingsDialog
        open={settingsOpen}
        settings={settings}
        onOpenChange={setSettingsOpen}
        onSettingsChange={onSettingsChange}
      />
    </div>
  );
}

interface CodeDiffEditorProps {
  appearance: EditorAppearance;
  modified: string;
  modifiedLabel: string;
  original: string;
  originalLabel: string;
  path: string;
  settings: EditorSettings;
  onModifiedChange: (value: string) => void;
}

function PlainDiffEditor({
  modified,
  modifiedLabel,
  original,
  originalLabel,
  onModifiedChange,
}: Pick<
  CodeDiffEditorProps,
  | "modified"
  | "modifiedLabel"
  | "original"
  | "originalLabel"
  | "onModifiedChange"
>) {
  const id = useId();
  const originalId = `${id}-original`;
  const modifiedId = `${id}-modified`;
  return (
    <div className="plainDiffEditor">
      <div>
        <Text as="label" htmlFor={originalId} weight="medium">
          {originalLabel}
        </Text>
        <TextArea id={originalId} readOnly rows={12} value={original} />
      </div>
      <div>
        <Text as="label" htmlFor={modifiedId} weight="medium">
          {modifiedLabel}
        </Text>
        <TextArea
          id={modifiedId}
          rows={12}
          value={modified}
          onChange={(event) => onModifiedChange(event.target.value)}
        />
      </div>
    </div>
  );
}

interface MonacoDiffSurfaceProps extends CodeDiffEditorProps {
  onFailure: () => void;
}

function MonacoDiffSurface({
  appearance,
  modified,
  modifiedLabel,
  original,
  originalLabel,
  path,
  settings,
  onFailure,
  onModifiedChange,
}: MonacoDiffSurfaceProps) {
  const { t } = useTranslation();
  const mounted = useRef(false);
  const resource = useRef<{ dispose(): void }>();
  const onModifiedChangeRef = useRef(onModifiedChange);
  onModifiedChangeRef.current = onModifiedChange;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!mounted.current) onFailure();
    }, MONACO_LOAD_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
      resource.current?.dispose();
      resource.current = undefined;
    };
  }, [onFailure]);

  const options = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      accessibilitySupport: "auto",
      automaticLayout: true,
      diffAlgorithm: "advanced",
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: settings.fontSize,
      minimap: { enabled: settings.minimap },
      modifiedAriaLabel: modifiedLabel,
      originalAriaLabel: originalLabel,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: true,
      renderWhitespace: settings.whitespace,
      scrollBeyondLastLine: false,
      tabFocusMode: true,
      tabSize: settings.tabSize,
      useInlineViewWhenSpaceIsLimited: true,
      wordWrap: settings.wordWrap ? "on" : "off",
    }),
    [modifiedLabel, originalLabel, settings],
  );

  const handleMount = useCallback(
    (instance: editor.IStandaloneDiffEditor) => {
      mounted.current = true;
      resource.current?.dispose();
      instance.getOriginalEditor().updateOptions({ ariaLabel: originalLabel });
      const modifiedEditor = instance.getModifiedEditor();
      modifiedEditor.updateOptions({ ariaLabel: modifiedLabel });
      resource.current = modifiedEditor.onDidChangeModelContent(() =>
        onModifiedChangeRef.current(modifiedEditor.getValue()),
      );
    },
    [modifiedLabel, originalLabel],
  );

  return (
    <DiffEditor
      height="min(62vh, 680px)"
      keepCurrentModifiedModel={false}
      keepCurrentOriginalModel={false}
      language={languageForPath(path)}
      loading={
        <div className="filesEditorLoading" role="status">
          <Spinner size="1" /> {t("filesDiffLoading")}
        </div>
      }
      modified={modified}
      modifiedModelPath={workspaceModelUri(path, "conflict-modified")}
      options={options}
      original={original}
      originalModelPath={workspaceModelUri(path, "conflict-original")}
      theme={appearance === "dark" ? "vs-dark" : "light"}
      onMount={handleMount}
    />
  );
}

export function CodeDiffEditor(props: CodeDiffEditorProps) {
  const narrow = useNarrowEditor();
  const [failed, setFailed] = useState(false);
  const handleFailure = useCallback(() => setFailed(true), []);
  const plain = narrow || props.settings.mode === "plain" || failed;
  const fallback = <PlainDiffEditor {...props} />;

  if (plain) return fallback;
  return (
    <EditorErrorBoundary
      fallback={fallback}
      onError={handleFailure}
      resetKey={props.path}
    >
      <MonacoDiffSurface {...props} onFailure={handleFailure} />
    </EditorErrorBoundary>
  );
}
