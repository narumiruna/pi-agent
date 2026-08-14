import type {
  ExtensionUiSnapshot,
  ExtensionWidget,
} from "../../shared/contracts.js";
import type { EventHub } from "../agent/events.js";

const MAX_STATUS_COUNT = 20;
const MAX_WIDGET_COUNT = 10;
const MAX_WIDGET_LINES = 20;
const MAX_TEXT_LENGTH = 4_000;
const MAX_TITLE_LENGTH = 200;
const MAX_UPDATES_PER_WINDOW = 120;
const UPDATE_WINDOW_MS = 10_000;

export function sanitizeExtensionText(
  value: string,
  maxLength = MAX_TEXT_LENGTH,
): string {
  let result = "";
  for (let index = 0; index < value.length && result.length < maxLength; ) {
    const code = value.charCodeAt(index);
    if (code === 0x9b) {
      index += 1;
      while (index < value.length) {
        const current = value.charCodeAt(index++);
        if (current >= 0x40 && current <= 0x7e) break;
      }
      continue;
    }
    if ([0x90, 0x9d, 0x9e, 0x9f].includes(code)) {
      index += 1;
      while (
        index < value.length &&
        value.charCodeAt(index) !== 0x07 &&
        value.charCodeAt(index) !== 0x9c
      )
        index += 1;
      index += Number(index < value.length);
      continue;
    }
    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5b) {
        index += 2;
        while (index < value.length) {
          const current = value.charCodeAt(index++);
          if (current >= 0x40 && current <= 0x7e) break;
        }
        continue;
      }
      if ([0x5d, 0x50, 0x5e, 0x5f].includes(next)) {
        index += 2;
        while (index < value.length) {
          if (value.charCodeAt(index) === 0x07) {
            index += 1;
            break;
          }
          if (
            value.charCodeAt(index) === 0x1b &&
            value.charCodeAt(index + 1) === 0x5c
          ) {
            index += 2;
            break;
          }
          index += 1;
        }
        continue;
      }
      index += Math.min(2, value.length - index);
      continue;
    }
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      index += 1;
      continue;
    }
    const character = String.fromCodePoint(value.codePointAt(index) ?? code);
    if (result.length + character.length > maxLength) break;
    result += character;
    index += character.length;
  }
  return result;
}

export class WebExtensionState {
  private sessionId = "";
  private readonly statuses = new Map<string, string>();
  private readonly widgets = new Map<string, ExtensionWidget>();
  private title: string | undefined;
  private composer = "";
  private workingMessage: string | undefined;
  private workingVisible = true;
  private workingIndicator: string | undefined;
  private hiddenThinkingLabel: string | undefined;
  private toolsExpanded = false;
  private windowStartedAt = 0;
  private updatesInWindow = 0;

  constructor(private readonly events: EventHub) {}

  reset(sessionId: string): void {
    this.sessionId = sessionId;
    this.statuses.clear();
    this.widgets.clear();
    this.title = undefined;
    this.composer = "";
    this.workingMessage = undefined;
    this.workingVisible = true;
    this.workingIndicator = undefined;
    this.hiddenThinkingLabel = undefined;
    this.toolsExpanded = false;
    this.windowStartedAt = 0;
    this.updatesInWindow = 0;
    this.publish();
  }

  snapshot(): ExtensionUiSnapshot {
    return {
      sessionId: this.sessionId,
      statuses: [...this.statuses].map(([key, text]) => ({ key, text })),
      widgets: [...this.widgets.values()].map((widget) => ({
        ...widget,
        lines: [...widget.lines],
      })),
      ...(this.title ? { title: this.title } : {}),
      editorText: this.composer,
      ...(this.workingMessage ? { workingMessage: this.workingMessage } : {}),
      workingVisible: this.workingVisible,
      ...(this.workingIndicator
        ? { workingIndicator: this.workingIndicator }
        : {}),
      ...(this.hiddenThinkingLabel
        ? { hiddenThinkingLabel: this.hiddenThinkingLabel }
        : {}),
      toolsExpanded: this.toolsExpanded,
    };
  }

  setComposerFromClient(text: string): void {
    this.composer = text.slice(0, 100_000);
  }

  getComposer(): string {
    return this.composer;
  }

  setEditorText(text: string, mode: "append" | "replace"): void {
    if (!this.allowUpdate()) return;
    const available =
      mode === "append" ? 100_000 - this.composer.length : 100_000;
    const clean = sanitizeExtensionText(text, Math.max(0, available));
    this.composer = mode === "append" ? `${this.composer}${clean}` : clean;
    this.publish({ text: clean, mode });
  }

  setStatus(key: string, text: string | undefined): void {
    if (!this.allowUpdate()) return;
    const cleanKey = sanitizeExtensionText(key, 100).trim();
    if (!cleanKey) return;
    if (text === undefined) this.statuses.delete(cleanKey);
    else if (
      this.statuses.has(cleanKey) ||
      this.statuses.size < MAX_STATUS_COUNT
    )
      this.statuses.set(cleanKey, sanitizeExtensionText(text));
    this.publish();
  }

  setWidget(
    key: string,
    content: string[] | undefined,
    placement: "aboveEditor" | "belowEditor" = "aboveEditor",
  ): void {
    if (!this.allowUpdate()) return;
    const cleanKey = sanitizeExtensionText(key, 100).trim();
    if (!cleanKey) return;
    if (content === undefined) this.widgets.delete(cleanKey);
    else if (
      this.widgets.has(cleanKey) ||
      this.widgets.size < MAX_WIDGET_COUNT
    ) {
      const lines = content
        .slice(0, MAX_WIDGET_LINES)
        .map((line) => sanitizeExtensionText(line, 1_000));
      this.widgets.set(cleanKey, { key: cleanKey, lines, placement });
    }
    this.publish();
  }

  setTitle(value: string): void {
    if (!this.allowUpdate()) return;
    this.title =
      sanitizeExtensionText(value, MAX_TITLE_LENGTH).trim() || undefined;
    this.publish();
  }

  setWorkingMessage(value?: string): void {
    if (!this.allowUpdate()) return;
    this.workingMessage = value
      ? sanitizeExtensionText(value).trim() || undefined
      : undefined;
    this.publish();
  }

  setWorkingVisible(visible: boolean): void {
    if (!this.allowUpdate()) return;
    this.workingVisible = visible;
    this.publish();
  }

  setWorkingIndicator(frames?: string[]): void {
    if (!this.allowUpdate()) return;
    this.workingIndicator = frames?.[0]
      ? sanitizeExtensionText(frames[0], 20)
      : undefined;
    this.publish();
  }

  setHiddenThinkingLabel(value?: string): void {
    if (!this.allowUpdate()) return;
    this.hiddenThinkingLabel = value
      ? sanitizeExtensionText(value, 200).trim() || undefined
      : undefined;
    this.publish();
  }

  setToolsExpanded(expanded: boolean): void {
    if (!this.allowUpdate()) return;
    this.toolsExpanded = expanded;
    this.publish();
  }

  private allowUpdate(): boolean {
    const now = Date.now();
    if (now - this.windowStartedAt >= UPDATE_WINDOW_MS) {
      this.windowStartedAt = now;
      this.updatesInWindow = 0;
    }
    this.updatesInWindow += 1;
    return this.updatesInWindow <= MAX_UPDATES_PER_WINDOW;
  }

  private publish(editor?: { text: string; mode: "append" | "replace" }): void {
    this.events.publish("extension_ui", {
      snapshot: this.snapshot(),
      ...(editor ? { editor } : {}),
    });
  }
}
