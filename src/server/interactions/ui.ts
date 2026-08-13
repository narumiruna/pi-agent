import {
  type ExtensionUIContext,
  type ExtensionUIDialogOptions,
  Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { EventHub } from "../agent/events.js";
import type { InteractionBroker } from "./broker.js";

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
  theme: ExtensionUIContext["theme"],
): ExtensionUIContext {
  const unsupported = () => undefined;
  return {
    select: (
      title: string,
      options: string[],
      opts?: ExtensionUIDialogOptions,
    ) => broker.request("select", { title, options }, opts),
    confirm: async (
      title: string,
      message: string,
      opts?: ExtensionUIDialogOptions,
    ) => (await broker.request("confirm", { title, message }, opts)) === "true",
    input: (
      title: string,
      placeholder?: string,
      opts?: ExtensionUIDialogOptions,
    ) => broker.request("input", { title, placeholder }, opts),
    editor: (title: string, prefill?: string) =>
      broker.request("editor", { title, prefill }),
    notify: (message, type = "info") =>
      events.publish("notification", { message, type }),
    setStatus: (key, text) =>
      events.publish("notification", { statusKey: key, statusText: text }),
    setWidget: unsupported,
    setTitle: unsupported,
    setEditorText: (text) =>
      events.publish("interaction", { kind: "set_editor_text", text }),
    pasteToEditor: (text) =>
      events.publish("interaction", { kind: "set_editor_text", text }),
    getEditorText: () => "",
    onTerminalInput: () => unsupported,
    setWorkingMessage: unsupported,
    setWorkingVisible: unsupported,
    setWorkingIndicator: unsupported,
    setHiddenThinkingLabel: unsupported,
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
    getToolsExpanded: () => false,
    setToolsExpanded: unsupported,
  };
}
