import {
  type ExtensionUIContext,
  type ExtensionUIDialogOptions,
  Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { EventHub } from "../agent/events.js";
import type { InteractionBroker } from "./broker.js";
import { sanitizeExtensionText, type WebExtensionState } from "./web-state.js";

const THEME_COLORS: ThemeColor[] = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "userMessageText",
  "customMessageText",
  "customMessageLabel",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
];

export function createHeadlessTheme(): ExtensionUIContext["theme"] {
  const foreground = Object.fromEntries(
    THEME_COLORS.map((name) => [name, "#dce2e3"]),
  ) as Record<ThemeColor, string>;
  return new Theme(
    foreground,
    {
      selectedBg: "#263438",
      userMessageBg: "#263438",
      customMessageBg: "#263438",
      toolPendingBg: "#263438",
      toolSuccessBg: "#203634",
      toolErrorBg: "#3a2527",
      scrollbarThumb: "#657279",
    },
    "truecolor",
    { name: "web-headless" },
  );
}

export function createWebExtensionUi(
  broker: InteractionBroker,
  events: EventHub,
  state: WebExtensionState,
  theme: ExtensionUIContext["theme"],
): ExtensionUIContext {
  const unsupported = () => undefined;
  return {
    select: (
      title: string,
      options: string[],
      opts?: ExtensionUIDialogOptions,
    ) =>
      broker.request(
        "select",
        {
          title: sanitizeExtensionText(title),
          options: options
            .slice(0, 100)
            .map((option) => sanitizeExtensionText(option, 1_000)),
        },
        opts,
      ),
    confirm: async (
      title: string,
      message: string,
      opts?: ExtensionUIDialogOptions,
    ) =>
      (await broker.request(
        "confirm",
        {
          title: sanitizeExtensionText(title),
          message: sanitizeExtensionText(message, 20_000),
        },
        opts,
      )) === "true",
    input: (
      title: string,
      placeholder?: string,
      opts?: ExtensionUIDialogOptions,
    ) =>
      broker.request(
        "input",
        {
          title: sanitizeExtensionText(title),
          ...(placeholder
            ? { placeholder: sanitizeExtensionText(placeholder) }
            : {}),
        },
        opts,
      ),
    editor: (title: string, prefill?: string) =>
      broker.request("editor", {
        title: sanitizeExtensionText(title),
        ...(prefill
          ? { prefill: sanitizeExtensionText(prefill, 100_000) }
          : {}),
      }),
    notify: (message, type = "info") =>
      events.publish("notification", {
        message: sanitizeExtensionText(message),
        type,
      }),
    setStatus: (key, text) => state.setStatus(key, text),
    setWidget: (key, content, options) => {
      if (content === undefined || Array.isArray(content))
        state.setWidget(key, content, options?.placement);
    },
    setTitle: (title) => state.setTitle(title),
    setEditorText: (text) => state.setEditorText(text, "replace"),
    pasteToEditor: (text) => state.setEditorText(text, "append"),
    getEditorText: () => state.getComposer(),
    onTerminalInput: () => unsupported,
    setWorkingMessage: (message) => state.setWorkingMessage(message),
    setWorkingVisible: (visible) => state.setWorkingVisible(visible),
    setWorkingIndicator: (options) =>
      state.setWorkingIndicator(options?.frames),
    setHiddenThinkingLabel: (label) => state.setHiddenThinkingLabel(label),
    setFooter: unsupported,
    setHeader: unsupported,
    custom: async () => undefined as never,
    addAutocompleteProvider: unsupported,
    setEditorComponent: unsupported,
    getEditorComponent: unsupported,
    theme,
    getAllThemes: () => [],
    getTheme: unsupported,
    setTheme: () => ({
      success: false,
      error: "Themes are not available in the web UI",
    }),
    getToolsExpanded: () => state.snapshot().toolsExpanded,
    setToolsExpanded: (expanded) => state.setToolsExpanded(expanded),
  };
}
