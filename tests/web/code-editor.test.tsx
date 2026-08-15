// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CodeDiffEditor,
  CodeEditor,
} from "../../src/web/components/CodeEditor.js";
import {
  DEFAULT_EDITOR_SETTINGS,
  EDITOR_SETTINGS_KEY,
  languageForPath,
  lineEndingFor,
  loadEditorSettings,
  parseEditorSettings,
  saveEditorSettings,
  workerKindForLabel,
  workspaceModelUri,
} from "../../src/web/editor/config.js";
import { setLanguage } from "../../src/web/i18n.js";

interface MockComponentProps {
  [key: string]: unknown;
  onMount?: (editor: unknown) => void;
}

const harness = vi.hoisted(() => ({
  editorProps: undefined as MockComponentProps | undefined,
  diffProps: undefined as MockComponentProps | undefined,
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: MockComponentProps) => {
    harness.editorProps = props;
    return <div data-testid="mock-monaco" />;
  },
  DiffEditor: (props: MockComponentProps) => {
    harness.diffProps = props;
    return <div data-testid="mock-monaco-diff" />;
  },
}));

vi.mock("../../src/web/editor/monaco.js", () => ({
  monaco: {
    KeyCode: { KeyS: 49 },
    KeyMod: { CtrlCmd: 2048 },
  },
}));

function setNarrow(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(max-width: 720px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderEditor(
  overrides: Partial<ComponentProps<typeof CodeEditor>> = {},
) {
  const props: ComponentProps<typeof CodeEditor> = {
    appearance: "light",
    ariaLabel: "Contents of src/index.ts",
    path: "src/index.ts",
    pending: false,
    readOnly: false,
    settings: DEFAULT_EDITOR_SETTINGS,
    value: "const value = 1;\n",
    onChange: vi.fn(),
    onSave: vi.fn(),
    onSettingsChange: vi.fn(),
    ...overrides,
  };
  return {
    props,
    view: render(
      <Theme>
        <CodeEditor {...props} />
      </Theme>,
    ),
  };
}

beforeEach(async () => {
  await setLanguage("en");
  setNarrow(false);
  harness.editorProps = undefined;
  harness.diffProps = undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("editor configuration", () => {
  test.each([
    ["src/index.js", "javascript"],
    ["src/view.jsx", "javascript"],
    ["src/index.ts", "typescript"],
    ["src/view.tsx", "typescript"],
    ["package.json", "json"],
    ["README.md", "markdown"],
    ["compose.yaml", "yaml"],
    ["COMPOSE.YML", "yaml"],
    ["types/component.D.TS", "typescript"],
    ["public/index.html", "html"],
    ["src/style.scss", "scss"],
    ["script.py", "python"],
    ["src/main.rs", "rust"],
    ["cmd/main.go", "go"],
    ["bin/setup.sh", "shell"],
    ["Dockerfile.dev", "dockerfile"],
    ["schema.sql", "sql"],
    ["image.svg", "xml"],
    ["settings.toml", "ini"],
    ["Justfile", "plaintext"],
  ])("maps %s to %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  test("parses bounded versioned settings and survives broken storage", () => {
    const valid = {
      ...DEFAULT_EDITOR_SETTINGS,
      fontSize: 18,
      tabSize: 4,
      wordWrap: true,
      minimap: false,
      whitespace: "all",
      mode: "plain",
    } as const;
    expect(parseEditorSettings(JSON.stringify(valid))).toEqual(valid);
    expect(parseEditorSettings("not-json")).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(
      parseEditorSettings(JSON.stringify({ ...valid, version: 2 })),
    ).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(
      parseEditorSettings(
        JSON.stringify({
          ...valid,
          fontSize: 200,
          tabSize: 3,
          whitespace: "invalid",
          mode: "invalid",
        }),
      ),
    ).toEqual({
      ...valid,
      fontSize: DEFAULT_EDITOR_SETTINGS.fontSize,
      tabSize: DEFAULT_EDITOR_SETTINGS.tabSize,
      whitespace: DEFAULT_EDITOR_SETTINGS.whitespace,
      mode: DEFAULT_EDITOR_SETTINGS.mode,
    });

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveEditorSettings(valid, storage);
    expect(values.has(EDITOR_SETTINGS_KEY)).toBe(true);
    expect(loadEditorSettings(storage)).toEqual(valid);
    expect(
      loadEditorSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(() =>
      saveEditorSettings(valid, {
        setItem: () => {
          throw new Error("full");
        },
      }),
    ).not.toThrow();
  });

  test("creates safe synthetic model URIs and routes worker labels", () => {
    expect(workspaceModelUri("src/空 白.ts")).toBe(
      "pi-workspace://workspace/src/%E7%A9%BA%20%E7%99%BD.ts?view=editor",
    );
    expect(workspaceModelUri("src/a#b?.ts")).toBe(
      "pi-workspace://workspace/src/a%23b%3F.ts?view=editor",
    );
    expect(workspaceModelUri("src/index.ts", "conflict-original")).not.toBe(
      workspaceModelUri("src/index.ts", "conflict-modified"),
    );
    expect(() => workspaceModelUri("../secret")).toThrow();
    expect(() => workspaceModelUri("/absolute")).toThrow();
    expect(workspaceModelUri("src/index.ts")).not.toContain(process.cwd());
    expect(workerKindForLabel("json")).toBe("json");
    expect(workerKindForLabel("scss")).toBe("css");
    expect(workerKindForLabel("handlebars")).toBe("html");
    expect(workerKindForLabel("javascript")).toBe("typescript");
    expect(workerKindForLabel("python")).toBe("editor");
    expect(lineEndingFor("a\r\nb")).toBe("CRLF");
    expect(lineEndingFor("a\nb")).toBe("LF");
  });
});

describe("CodeEditor", () => {
  test("configures Monaco, saves with the current callback, and disposes resources", async () => {
    const firstSave = vi.fn();
    const user = userEvent.setup();
    const { props, view } = renderEditor({ onSave: firstSave });
    expect(screen.getByTestId("mock-monaco")).toBeVisible();
    expect(harness.editorProps).toMatchObject({
      keepCurrentModel: false,
      language: "typescript",
      path: "pi-workspace://workspace/src/index.ts?view=editor",
      saveViewState: false,
      theme: "light",
      value: props.value,
    });
    expect(harness.editorProps?.options).toMatchObject({
      accessibilitySupport: "auto",
      ariaLabel: props.ariaLabel,
      automaticLayout: true,
      folding: true,
      fontSize: 14,
      minimap: { enabled: true },
      readOnly: false,
      tabFocusMode: false,
      tabSize: 2,
      wordWrap: "off",
    });
    await user.click(
      screen.getByRole("button", { name: "Tab inserts indentation" }),
    );
    expect(harness.editorProps?.options).toMatchObject({ tabFocusMode: true });

    const disposeAction = vi.fn();
    const disposeCursor = vi.fn();
    let action: { run: () => void } | undefined;
    let cursorListener:
      | ((event: { position: { lineNumber: number; column: number } }) => void)
      | undefined;
    const instance = {
      addAction: vi.fn((value) => {
        action = value;
        return { dispose: disposeAction };
      }),
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      onDidChangeCursorPosition: vi.fn((listener) => {
        cursorListener = listener;
        return { dispose: disposeCursor };
      }),
    };
    act(() => harness.editorProps?.onMount?.(instance));
    act(() => action?.run());
    expect(firstSave).toHaveBeenCalledOnce();

    const currentSave = vi.fn();
    view.rerender(
      <Theme>
        <CodeEditor {...props} pending onSave={currentSave} />
      </Theme>,
    );
    act(() => action?.run());
    expect(currentSave).not.toHaveBeenCalled();
    view.rerender(
      <Theme>
        <CodeEditor {...props} readOnly onSave={currentSave} />
      </Theme>,
    );
    act(() => action?.run());
    expect(currentSave).not.toHaveBeenCalled();
    act(() => cursorListener?.({ position: { lineNumber: 4, column: 7 } }));
    expect(screen.getByText("Ln 4, Col 7")).toBeVisible();

    view.unmount();
    expect(disposeAction).toHaveBeenCalledOnce();
    expect(disposeCursor).toHaveBeenCalledOnce();
  });

  test("uses the native fallback on narrow screens and preserves controlled edits", async () => {
    setNarrow(true);
    const onChange = vi.fn();
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onChange, onSave });

    expect(screen.queryByTestId("mock-monaco")).not.toBeInTheDocument();
    const editor = screen.getByLabelText("Contents of src/index.ts");
    await user.type(editor, " changed");
    expect(onChange).toHaveBeenCalled();
    await user.keyboard("{Control>}s{/Control}");
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByText(/plain editor is used/i)).toBeVisible();
  });

  test("falls back without losing the draft when Monaco never mounts", async () => {
    vi.useFakeTimers();
    renderEditor({ value: "unsaved draft" });
    expect(screen.getByTestId("mock-monaco")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByLabelText("Contents of src/index.ts")).toHaveValue(
      "unsaved draft",
    );
    expect(screen.getByText(/could not start/i)).toBeVisible();
  });

  test("exposes labelled native settings controls", async () => {
    const onSettingsChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onSettingsChange });
    await user.click(screen.getByRole("button", { name: "Editor settings" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Font size" }),
      "18",
    );
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_EDITOR_SETTINGS,
      fontSize: 18,
    });
    expect(screen.getByRole("combobox", { name: "Tab size" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Whitespace" })).toBeVisible();
  });

  test("switches appearance and persists a plain-mode preference through its callback", async () => {
    const onSettingsChange = vi.fn();
    const user = userEvent.setup();
    const { props, view } = renderEditor({ onSettingsChange });
    view.rerender(
      <Theme>
        <CodeEditor {...props} appearance="dark" />
      </Theme>,
    );
    expect(harness.editorProps?.theme).toBe("vs-dark");

    await user.click(screen.getByRole("button", { name: "Use plain editor" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_EDITOR_SETTINGS,
      mode: "plain",
    });
  });
});

describe("CodeDiffEditor", () => {
  test("labels distinct models, captures modified content, and disposes its listener", () => {
    const onModifiedChange = vi.fn();
    const view = render(
      <Theme>
        <CodeDiffEditor
          appearance="dark"
          modified="local"
          modifiedLabel="Your editable draft"
          original="disk"
          originalLabel="Latest disk version"
          path="src/index.ts"
          settings={DEFAULT_EDITOR_SETTINGS}
          onModifiedChange={onModifiedChange}
        />
      </Theme>,
    );
    expect(screen.getByTestId("mock-monaco-diff")).toBeVisible();
    expect(harness.diffProps).toMatchObject({
      keepCurrentModifiedModel: false,
      keepCurrentOriginalModel: false,
      language: "typescript",
      modified: "local",
      original: "disk",
      theme: "vs-dark",
    });
    expect(harness.diffProps?.modifiedModelPath).not.toBe(
      harness.diffProps?.originalModelPath,
    );
    expect(harness.diffProps?.options).toMatchObject({
      modifiedAriaLabel: "Your editable draft",
      originalAriaLabel: "Latest disk version",
      originalEditable: false,
      readOnly: false,
    });

    const dispose = vi.fn();
    let listener: (() => void) | undefined;
    const originalEditor = { updateOptions: vi.fn() };
    const modifiedEditor = {
      getValue: () => "merged",
      updateOptions: vi.fn(),
      onDidChangeModelContent: (value: () => void) => {
        listener = value;
        return { dispose };
      },
    };
    act(() =>
      harness.diffProps?.onMount?.({
        getModifiedEditor: () => modifiedEditor,
        getOriginalEditor: () => originalEditor,
      }),
    );
    expect(originalEditor.updateOptions).toHaveBeenCalledWith({
      ariaLabel: "Latest disk version",
    });
    expect(modifiedEditor.updateOptions).toHaveBeenCalledWith({
      ariaLabel: "Your editable draft",
    });
    act(() => listener?.());
    expect(onModifiedChange).toHaveBeenCalledWith("merged");
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  test("falls back to labelled native merge fields when the diff does not mount", async () => {
    vi.useFakeTimers();
    render(
      <Theme>
        <CodeDiffEditor
          appearance="light"
          modified="local"
          modifiedLabel="Your editable draft"
          original="disk"
          originalLabel="Latest disk version"
          path="src/index.ts"
          settings={DEFAULT_EDITOR_SETTINGS}
          onModifiedChange={vi.fn()}
        />
      </Theme>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByLabelText("Latest disk version")).toHaveValue("disk");
    expect(screen.getByLabelText("Your editable draft")).toHaveValue("local");
  });
});
