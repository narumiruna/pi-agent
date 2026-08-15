import { loader } from "@monaco-editor/react";
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget";
import "monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/caretOperations/browser/caretOperations";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/editor/contrib/dnd/browser/dnd";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/fontZoom/browser/fontZoom";
import "monaco-editor/editor/contrib/format/browser/formatActions";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/indentation/browser/indentation";
import "monaco-editor/editor/contrib/lineSelection/browser/lineSelection";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/editor/contrib/readOnlyMessage/browser/contribution";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode";
import "monaco-editor/editor/contrib/tokenization/browser/tokenization";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations";
import "monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/features/find/register";
import "monaco-editor/language/css/monaco.contribution";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import "monaco-editor/language/html/monaco.contribution";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import "monaco-editor/language/json/monaco.contribution";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import "monaco-editor/language/typescript/monaco.contribution";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/dockerfile/register";
import "monaco-editor/languages/definitions/go/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/ini/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/less/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/rust/register";
import "monaco-editor/languages/definitions/scss/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/yaml/register";
import { workerKindForLabel } from "./config.js";

const WORKERS = {
  css: CssWorker,
  editor: EditorWorker,
  html: HtmlWorker,
  json: JsonWorker,
  typescript: TypeScriptWorker,
} as const;

export function createMonacoWorker(label: string): Worker {
  const WorkerConstructor = WORKERS[workerKindForLabel(label)];
  return new WorkerConstructor();
}

interface MonacoEnvironmentGlobal {
  MonacoEnvironment?: {
    getWorker(moduleId: string, label: string): Worker;
  };
}

(self as MonacoEnvironmentGlobal).MonacoEnvironment = {
  getWorker: (_moduleId, label) => createMonacoWorker(label),
};

loader.config({ monaco });

export { monaco };
