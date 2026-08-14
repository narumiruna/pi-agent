# Pi TUI 功能與 Web 相容性研究

> 本文件記錄實作前的 `0.84.1` 研究快照，因此「現況」欄位代表研究當時的程式碼。
>
> 後續實作進度與驗證結果以 [`../../PLAN.md`](../../PLAN.md) 為準。

## 結論

`pi-tui` 是終端 UI 框架，不能直接在 React 瀏覽器裡執行。

`pi-agent` 不應把 `pi-tui` 或 ANSI 畫面塞進瀏覽器。

正確方向如下。

1. 保留 `AgentSession`、`SessionManager`、extensions、tools 等 Pi 原生行為。
2. 使用 React、Radix 與 DOM 實作對應的 Web UI。
3. 優先補齊 Pi 已提供的 headless API，而不是重新發明 session、queue 或 compaction。
4. Extension 的語意型 UI 可以支援，但任意 `ctx.ui.custom()` TUI 元件無法自動轉成 Web 元件。

研究基準是目前已安裝的版本。

- `@earendil-works/pi-coding-agent@0.84.1`
- `@earendil-works/pi-tui@0.84.1`
- `pi-tui` 目前只是 `pi-coding-agent` 的巢狀相依，不是 `pi-agent` 的直接 dependency。

## 一、`pi-tui` 本身的功能

### 1. Renderer 與畫面管理

| 功能 | `pi-tui` 行為 | 用在 `pi-agent` |
| --- | --- | --- |
| `TuiMainScreen` | 在主 terminal buffer 差異更新並保留 scrollback | 不直接適用，React 已處理 DOM 更新 |
| `TuiAltScreen` | 提供全螢幕 viewport、固定輸入區與應用程式控制捲動 | 概念適用，但 Web 已天然是固定 viewport |
| Differential rendering | 只輸出有變動的 terminal 行 | 不需要，React reconciliation 已處理 |
| Synchronized output | 使用 CSI 2026 原子更新以避免閃爍 | 瀏覽器不需要 |
| Render throttling | 合併短時間內的 render request | React batching 可取代 |
| Full redraw recovery | terminal resize 或內容縮短時重畫 | CSS layout 可取代 |
| Main／fullscreen 切換 | regular 與 fullscreen renderer 可切換 | Web 可用 responsive layout，不需要對應設定 |

判斷是不要移植 renderer。

### 2. Component 系統

所有元件遵守以下介面。

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

| 功能 | 用在 `pi-agent` |
| --- | --- |
| `render(width)` | 不能直接轉成 React，因為輸出是帶 ANSI 的 terminal 字串 |
| `handleInput()` | Web 應使用 React keyboard 與 form events |
| `invalidate()` | React state 與 props 已提供相同生命週期 |
| Render cache | React memoization 可取代 |
| Theme invalidation | Web 使用 CSS variables 或 React Theme |
| 每行不得超過 terminal width | DOM 自動換行，不需要這個限制 |

判斷是概念可參考，但不能直接重用。

### 3. 內建元件

`pi-tui` 公開以下元件。

- `Text`
- `TruncatedText`
- `Box`
- `Container`
- `Spacer`
- `VStack`
- `HStack`
- `ScrollView`
- `Input`
- `Editor`
- `Markdown`
- `Image`
- `Loader`
- `CancellableLoader`
- `SelectList`
- `SettingsList`

逐項評估如下。

| 元件 | 功能 | `pi-agent` 現況與建議 |
| --- | --- | --- |
| `Text` | 多行文字與 word wrap | React 或 Radix `Text` 可取代 |
| `TruncatedText` | 單行截斷 | CSS `text-overflow: ellipsis` 已在對話列表使用 |
| `Box` | padding、背景色與子元件 | CSS 與 Radix 元件可取代 |
| `Container` | 垂直排列子元件 | React children 可取代 |
| `Spacer` | 空行 | CSS `gap` 或 `margin` 可取代 |
| `VStack` | 垂直 flex layout | CSS Grid 或 Flex 可取代 |
| `HStack` | 水平 flex layout | CSS Grid 或 Flex 可取代 |
| `ScrollView` | follow-end、scrollbar 與 overscroll chain | `ChatPage` 已有 `ScrollArea`，但應補上使用者捲離底部時不要強制拉回的行為 |
| `Input` | 單行輸入、水平捲動、undo 與 kill ring | 瀏覽器 input 已有大部分功能 |
| `Editor` | 多行輸入、history、autocomplete、大型貼上與 word navigation | Web 目前只有基本 `TextArea`，部分功能值得補上 |
| `Markdown` | GFM、表格、程式碼、LaTeX 與 syntax highlighting | Web 已有 `react-markdown` 與 GFM，但缺 syntax highlighting、LaTeX 與 Mermaid |
| `Image` | Kitty 或 iTerm2 inline image | Web 已直接顯示圖片，功能更完整 |
| `Loader` | 動畫 spinner | Radix `Spinner` 已可取代 |
| `CancellableLoader` | Escape 與 `AbortSignal` | Web 已有 Stop，但 extension operation 尚未完整映射 |
| `SelectList` | 鍵盤選單、description 與 scroll | Radix Dialog 或 RadioGroup 可取代 |
| `SettingsList` | 搜尋、切換值與 submenu | `SettingsPage` 已部分具備 |

### 4. Editor 功能

`pi-tui` Editor 實際包含以下能力。

- 多行輸入。
- Unicode grapheme-aware cursor。
- CJK 寬度處理。
- Word wrap。
- 垂直捲動。
- Prompt history。
- Undo stack。
- Emacs kill ring。
- Yank 與 yank-pop。
- Word navigation。
- Jump-to-character。
- Bracketed paste。
- 大型貼上折疊成 `[paste #n ...]`。
- Slash command autocomplete。
- `@file` fuzzy autocomplete。
- Path autocomplete。
- Async autocomplete cancellation。
- Autocomplete debounce。
- Custom autocomplete provider。
- Custom editor replacement。
- IME cursor positioning。

#### 在 `pi-agent` 的適用性

| 功能 | 現況 | 建議 |
| --- | --- | --- |
| 多行輸入 | ✅ Shift+Enter 可換行 | 保留 |
| Browser native undo | ✅ | 不重做 |
| IME | ✅ 瀏覽器原生 | 不使用 `CURSOR_MARKER` |
| Prompt history | ❌ | 可加入上下鍵或歷史按鈕 |
| Slash autocomplete | ◐ `/api/commands` 已存在，但 composer 沒有使用 | 高優先 |
| `@file` autocomplete | ❌ | 高價值，但需要受 workspace 限制的後端搜尋 API |
| Path completion | ❌ | 可和 `@file` 一起實作 |
| Large paste marker | ❌ | 中優先，可避免 composer 被巨量內容塞滿 |
| Kill ring | ❌ | 瀏覽器已有剪貼簿與 undo，不值得重做 |
| Jump-to-character | ❌ | 終端導向功能，不建議 |
| Custom editor | ❌ | 任意 TUI editor 無法轉成 Web，不建議 |
| External editor | ❌ | 瀏覽器 sandbox 無法可靠啟動本機 editor，不建議 |

### 5. Autocomplete 與 fuzzy search

`CombinedAutocompleteProvider` 支援以下能力。

- `/command` 搜尋。
- Command argument completion。
- `@file` fuzzy search。
- `~/`、`./`、`../` 與絕對路徑。
- 含空白路徑的引號處理。
- 目錄優先。
- `fd` 搜尋。
- 遵守 `.gitignore`。
- 使用 `AbortSignal` 取消舊搜尋。
- 疊加 extension autocomplete provider。

這些產品行為高度適用，但應重新用 Web 元件呈現。

第一階段可以直接使用現有 `/api/commands`。

- 輸入 `/` 時顯示 extension commands、templates 與 skills。
- 顯示 command description 與來源。
- 使用 Enter 或 Tab 套用。

第二階段再加入 workspace file search。

- 僅允許搜尋 `WORKSPACE` 內的檔案。
- 避免顯示 `.env`、credential、agent auth 等敏感路徑。
- 回傳相對路徑，不回傳主機絕對路徑。
- 限制結果筆數與搜尋時間。

不建議直接 import 巢狀的 `pi-tui` autocomplete，因為它使用 `child_process`、`fs` 與 terminal API，不適合 browser bundle。

### 6. Markdown 與 LaTeX

`pi-tui` Markdown 支援以下能力。

- Heading。
- Bold、italic、strikethrough 與 underline。
- Lists 與 nested lists。
- Tables。
- Code block。
- Syntax highlighting callback。
- Blockquote。
- Link 與 OSC 8 hyperlink。
- HTML 顯示為文字。
- Inline 與 display LaTeX。
- Unicode fraction、matrix、operator、subscript 與 superscript。
- Streaming 時避免 code fence 閃爍。
- Width-aware table fallback。
- Markdown transformer extensions。

`ChatPage.tsx` 已使用以下 renderer。

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>
```

目前已支援基本 Markdown 與 GFM。

目前仍缺少以下能力。

- Syntax highlighting。
- LaTeX。
- Mermaid。
- Extension Markdown transformer。
- Thinking block Markdown。
- Streaming code block 穩定處理。
- 明確的 link security policy。

建議依以下順序處理。

1. 補 syntax highlighting。
2. 補 thinking block。
3. 補 Mermaid。
4. 有需求時再補數學公式。

不要把 terminal LaTeX Unicode renderer 直接拿到瀏覽器。

瀏覽器應使用專門的 Web math renderer，並先檢查 dependency 安全與 bundle 大小。

### 7. 圖片

`pi-tui` 支援以下圖片能力。

- PNG。
- JPEG。
- GIF。
- WebP。
- Kitty graphics protocol。
- iTerm2 inline image。
- 圖片尺寸解析。
- 保持比例。
- Terminal 不支援時顯示 fallback。
- Kitty 圖片刪除與 viewport crop。
- OSC 8 file hyperlink。

`pi-agent` 目前已支援以下能力。

- PNG、JPEG、GIF 與 WebP。
- 貼上圖片。
- 上傳圖片。
- 最多四張。
- 總大小限制。
- 純圖片訊息。
- Transcript 圖片顯示。
- Steering 附圖。

仍可補充以下能力。

- Drag-and-drop。
- 點擊放大。
- 圖片下載。
- 圖片尺寸或檔名資訊。
- Assistant 或 tool 回傳圖片的顯示。

Web 已比 terminal image protocol 更適合圖片呈現，因此不需要引用 `pi-tui`。

### 8. Overlay 與 focus

`pi-tui` overlay 支援以下能力。

- 九種 anchor。
- 絕對位置。
- 百分比位置。
- `width`、`minWidth` 與 `maxHeight`。
- Margin 與 offset。
- Responsive visibility。
- Overlay stacking。
- Focus routing。
- Non-capturing overlay。
- Hide 與 show。
- Programmatic focus。
- 即時動畫。
- 多個輸入 overlay。

Radix Dialog 已在 `pi-agent` 提供以下能力。

- Modal。
- Focus trap。
- Portal。
- Escape close。
- Accessibility semantics。
- Mobile layout。

一般 dialog、model picker 與 extension interaction 應繼續使用 Radix。

Side panel、toast 與 status panel 可以使用 React 元件新增。

不要嘗試把任意 TUI overlay 字串轉成 HTML。

不要以 ANSI-to-HTML 當成正式 extension UI API。

### 9. Keyboard 與 keybindings

`pi-tui` 支援以下能力。

- Ctrl、Shift、Alt 與 Super 組合。
- Kitty keyboard protocol。
- Press、repeat 與 release。
- Function keys。
- Configurable keybinding manager。
- Conflict detection。
- Emacs 與 Vim mapping。
- Terminal input normalization。

| 功能 | 判斷 |
| --- | --- |
| Browser keyboard shortcuts | 可做 |
| Kitty protocol | 不適用 |
| Raw terminal sequence parser | 不適用 |
| User-configurable shortcuts | 可做，但不是高優先 |
| Shortcut conflict detection | 只在未來允許自訂快捷鍵時需要 |
| Vim custom editor | 不建議作為核心功能 |
| Mobile | 必須保留可點擊 UI，不能只依賴快捷鍵 |

適合優先加入以下快捷操作。

- 使用 Escape 停止執行。
- 使用 Ctrl/Cmd+K 開啟 command palette。
- 快速切換 model 或 thinking。
- 顯示快捷鍵說明。

不應覆寫瀏覽器的 Ctrl+X、Ctrl+C 與 Ctrl+V 基本行為。

### 10. Terminal 專用能力

以下功能不適合移植。

- `ProcessTerminal` raw mode。
- `StdinBuffer` terminal escape buffering。
- Bracketed paste protocol。
- Kitty keyboard negotiation。
- `modifyOtherKeys`。
- OSC 11 背景色查詢。
- Terminal truecolor 偵測。
- CSI synchronized output。
- Terminal cursor hide 與 show。
- Main 與 alternate screen。
- Kitty 與 iTerm2 graphics encoding。
- OSC 52 clipboard。
- Terminal mouse SGR parser。
- Terminal text selection。
- `PI_TUI_WRITE_LOG` ANSI stream log。

瀏覽器已有對應的 DOM、Clipboard API、CSS media query、DevTools 與 selection API。

## 二、Pi 互動 TUI 的產品功能對照

這些不是單純的 `pi-tui` 元件，而是 Pi 建立在其上的實際產品功能。

### 1. Chat 與 transcript

| 功能 | `pi-agent` 現況 | 可行性 |
| --- | --- | --- |
| User 與 assistant 訊息 | ✅ | 已有 |
| Streaming text | ✅ | 已有 |
| Markdown | ◐ | 缺 highlighting、LaTeX 與 Mermaid |
| Thinking block | ❌ | 高度可行 |
| Thinking collapse | ❌ | 高度可行 |
| Tool call 與 result 對應 | ◐ | 現在主要是 JSON 與分離的 result |
| Tool streaming update | ❌ | Pi event 已有，但 Web 尚未發布 |
| Read tool preview | ❌ | 可依 tool details 實作 |
| Bash streaming output | ❌ | 可依 `tool_execution_update` 實作 |
| Edit diff | ❌ | 高價值，Pi result details 已有 diff |
| Tool global expand/collapse | ❌ | 可做 |
| Tool images | ❌ | 可做 |
| Custom messages | ❌ | 目前 transcript projection 會略過 |
| Custom entries | ❌ | 目前 transcript projection 會略過 |
| Compaction summary | ❌ | 可做 |
| Branch summary | ❌ | 可做 |
| Skill invocation display | ❌ | 可做 |
| Notifications | ◐ | 只有簡單訊息 |
| Retry status | ❌ | Pi event 已有 |
| Compaction status | ❌ | Pi event 已有 |
| Cache miss notice | ❌ | 低優先 |

最值得優先補上的是 thinking、tool streaming、edit diff 與 retry 或 compaction status。

### 2. Composer 與 message queue

| 功能 | `pi-agent` 現況 | 可行性 |
| --- | --- | --- |
| 多行輸入 | ✅ | 已有 |
| 傳送 | ✅ | 已有 |
| Stop | ✅ | 已有 |
| Steering | ✅ 本地工作樹已實作 | 使用原生 `streamingBehavior: "steer"` |
| Follow-up | ❌ | `AgentSession.followUp()` 已有 |
| Queue 顯示 | ❌ | `queue_update` event 已有 |
| Queue 類型標示 | ❌ | 可區分 steering 與 follow-up |
| Dequeue 回 composer | ❌ | `clearQueue()` 已有 |
| Steering delivery mode | ❌ | `setSteeringMode()` 已有 |
| Follow-up delivery mode | ❌ | `setFollowUpMode()` 已有 |
| Slash autocomplete | ❌ | `/api/commands` 已有 |
| `@file` autocomplete | ❌ | 需要安全的 workspace 搜尋 API |
| Prompt history | ❌ | 可做 |
| 圖片貼上與上傳 | ✅ | 已有 |
| 圖片拖放 | ❌ | 容易補上 |
| Large paste collapse | ❌ | 中優先 |
| `!command` 與 `!!command` | ❌ | 技術上可行，但安全風險高 |
| External editor | ❌ | 不建議 |

### 3. Session 功能

| 功能 | `pi-agent` 現況 | 可行性 |
| --- | --- | --- |
| New session | ✅ | 已有 |
| Session list | ✅ | 已有 |
| Switch session | ✅ | 已有 |
| Search sessions | ❌ | 容易補上 |
| Sort sessions | ❌ | 容易補上 |
| Named-only filter | ❌ | 容易補上 |
| Rename session | ◐ 後端 API 已有 | UI 尚未提供 |
| Delete session | ◐ 後端 API 已有 | UI 尚未提供 |
| Session tree | ❌ | `SessionManager.getTree()` 已有 |
| Navigate tree | ❌ | `AgentSession.navigateTree()` 已有 |
| Tree filters | ❌ | Web 可做 |
| Labels 或 bookmarks | ❌ | Pi 原生 session entry 支援 |
| Fork | ❌ | `AgentSessionRuntime.fork()` 已有 |
| Clone | ❌ | `fork(..., { position: "at" })` 可用 |
| Branch summarization | ❌ | Pi 原生支援 |
| Automatic compaction | ◐ 內部有，但 UI 不可見 | 應發布事件與狀態 |
| Manual compaction | ❌ | `AgentSession.compact()` 已有 |
| Session token stats | ❌ | `getSessionStats()` 已有 |
| Context usage | ❌ | `getContextUsage()` 已有 |
| Export HTML | ❌ | `exportToHtml()` 已有 |
| Export JSONL | ❌ | `exportToJsonl()` 已有 |
| Import JSONL | ❌ | Runtime 已有 |
| Share gist | ❌ | 可做，但涉及外部 credential |
| Copy last assistant message | ❌ | 建議提供按鈕，不覆寫 Ctrl+X |

Session tree、fork、clone、compact 與 stats 都能直接使用 Pi API，不需要建立平行 session 模型。

### 4. Model 與 settings

| 功能 | `pi-agent` 現況 | 可行性 |
| --- | --- | --- |
| Provider login 與 logout | ✅ | 已有 |
| Model picker | ✅ | 已有搜尋與 provider filter |
| Model cycle | ❌ | `cycleModel()` 已有 |
| Scoped models | ❌ | Pi 原生支援 |
| Thinking level | ✅ | 已有 |
| Thinking cycle | ❌ | `cycleThinkingLevel()` 已有 |
| Active tools 顯示 | ✅ | 已有 |
| Active tools 切換 | ❌ | `setActiveToolsByName()` 已有 |
| Auto-compaction setting | ❌ | 原生 API 已有 |
| Auto-retry setting | ❌ | 原生 API 已有 |
| Queue modes | ❌ | 原生 API 已有 |
| Image settings | ❌ | Web 可使用自己的限制與顯示設定 |
| Pi terminal theme | ❌ | 不應直接搬移，應映射成 CSS theme |
| Dark 與 light | ✅ | 使用系統 preference |
| Project trust UI | ❌ | 目前 runtime 固定 `projectTrusted: false` |
| Reload resources | ◐ service 有 `reload()`，但沒有一般 UI | 可以加入 |
| Diagnostics | ◐ `/api/diagnostics` 已有 | Web 沒有頁面 |
| llama.cpp 管理 | ❌ | 可行但範圍較大 |

## 三、Extension UI 相容性

這是目前最大的功能落差。

`pi-agent` 使用以下方式綁定 extensions。

```ts
session.bindExtensions({
  mode: "rpc",
  uiContext: createWebExtensionUi(...),
});
```

RPC mode 是正確選擇。

不能改成 TUI mode，因為 Web 沒有真正的 terminal TUI。

### 現有支援狀態

| Extension UI API | 現況 | 問題 |
| --- | --- | --- |
| `select()` | ✅ | 基本可用 |
| `confirm()` | ✅ | 基本可用 |
| `input()` | ✅ | 基本可用 |
| `editor()` | ✅ | 基本多行 editor |
| Dialog timeout | ◐ | Server 會 timeout，但 Web 沒有倒數顯示 |
| `notify()` | ◐ | 沒有完整保留 info、warning 與 error 樣式 |
| `setStatus()` | ❌ 實際上當成通知使用 | 應改成 keyed persistent status |
| `setWidget()` | ❌ | 現在是 no-op |
| `setTitle()` | ❌ | 現在是 no-op |
| `setEditorText()` | ❌ | Server 有送事件，但 `App.tsx` 沒有套用到 draft |
| `pasteToEditor()` | ❌ | 與 `setEditorText()` 相同 |
| `getEditorText()` | ❌ | 固定回傳空字串 |
| `setWorkingMessage()` | ❌ | no-op |
| `setWorkingVisible()` | ❌ | no-op |
| `setWorkingIndicator()` | ❌ | no-op |
| `setHiddenThinkingLabel()` | ❌ | no-op |
| `addAutocompleteProvider()` | ❌ | no-op |
| `setFooter()` | ❌ | no-op |
| `setHeader()` | ❌ | no-op |
| `custom()` | ❌ | 固定回傳 `undefined` |
| Custom overlay | ❌ | 依賴 `custom()` |
| `setEditorComponent()` | ❌ | no-op |
| Theme API | ❌ | terminal ANSI theme 不適合 Web |
| Tool expanded state | ❌ | 固定為 `false` |
| Raw terminal input | ❌ | Web 不適用 |

### 可以合理補上的部分

建議補齊 Pi RPC 已定義的以下語意型 UI。

- `select()`。
- `confirm()`。
- `input()`。
- `editor()`。
- `notify()`。
- `setStatus()`。
- `setWidget()`，但只支援字串陣列。
- `setTitle()`。
- `set_editor_text`。

這些都有正式 RPC 語意，不算建立平行 abstraction。

### 不應承諾相容的部分

以下 API 回傳真正的 TUI `Component`，無法通用地轉成 React。

- `ctx.ui.custom()`。
- `setFooter(componentFactory)`。
- `setHeader(componentFactory)`。
- `setEditorComponent(componentFactory)`。
- Component-based `setWidget()`。
- `registerMessageRenderer()`。
- `registerEntryRenderer()`。
- Tool `renderCall()` 與 `renderResult()`。

可以提供以下通用 fallback。

- Custom message 顯示 `content` 與 `details`。
- Custom entry 顯示 `type` 與 JSON data。
- Tool 顯示名稱、args、content 與 details。
- 不執行 extension 回傳的 TUI component。

## 四、現有 extension 範例在 `pi-agent` 的相容性

| Extension 類型 | Web 相容性 |
| --- | --- |
| Permission gate 使用 `confirm()` 或 `select()` | ✅ 可用 |
| Provider auth interaction | ✅ 已使用 |
| 純 lifecycle、tool 或 context extension | ✅ 大致可用 |
| `/preset name` 直接套用 preset | ✅ 應可用 |
| `/preset` TUI selector | ❌ `custom()` 不可用 |
| `/tools` | ❌ 明確限制 `ctx.mode === "tui"` |
| question 或 questionnaire tool | ❌ 明確拒絕 RPC mode |
| qna 或 handoff | ❌ 明確要求 TUI mode |
| Plan mode 核心 tool restriction | ◐ 可運作 |
| Plan mode status、widget 或 custom message | ❌ 或不可見 |
| Status line | ❌ 目前會退化成 notification，且可能包含 ANSI |
| Working indicator extension | ❌ |
| Custom footer 或 header | ❌ |
| Custom Vim editor | ❌ |
| Todo tool 核心狀態 | ✅ |
| Todo custom renderer 或 custom UI | ❌ |
| Custom message 或 entry renderer | ❌ |
| Snake、Doom 或 Space Invaders | ❌，且不值得列為產品優先項 |
| Interactive shell | ❌，且不適合從 Web 暴露 |

## 五、Pi 內建 command 對照

| Command | `pi-agent` 狀態 |
| --- | --- |
| `/login`、`/logout` | ✅ 有 Web UI |
| `/llama` | ❌ |
| `/model` | ✅ 有 Web UI |
| `/scoped-models` | ❌ |
| `/settings` | ◐ 只有部分設定 |
| `/resume` | ◐ 可以選 session，但沒有完整搜尋、排序與管理 |
| `/new` | ✅ |
| `/name` | ◐ 後端可 rename，但缺少 UI |
| `/session` | ❌ |
| `/tree` | ❌ |
| `/trust` | ❌ |
| `/fork` | ❌ |
| `/clone` | ❌ |
| `/compact` | ❌ |
| `/copy` | ❌ |
| `/export` | ❌ |
| `/import` | ❌ |
| `/share` | ❌ |
| `/reload` | ◐ service 有能力，但缺 API 與 UI |
| `/hotkeys` | ❌ |
| `/changelog` | ❌ |
| `/quit` | Web server 不適用 |

Pi 的 built-in TUI commands 不會自動經過 `session.prompt()` 執行，因此需要在 `pi-agent` 明確建立 Web API。

## 六、建議實作順序

### P0：補齊 extension RPC 語意

1. 正確實作 keyed `setStatus()`。
2. 支援 string-array `setWidget()`。
3. 支援 `setTitle()`。
4. 讓 `setEditorText()` 真正修改 composer draft。
5. 保留 notification type。
6. 移除或清理 extension 傳來的 ANSI escape sequence。
7. 對 widget 行數、字數與更新頻率設限。

這會讓許多不依賴 `custom()` 的 extension 立即變得更實用。

### P1：補齊執行事件

1. 發布 `thinking_delta`。
2. 發布 `tool_execution_update`。
3. 發布 `queue_update`。
4. 發布 retry events。
5. 發布 compaction events。
6. 發布 model 與 thinking change。
7. 以 `message_end` 作為完成訊息的 authoritative source。

目前 `PiService.bindSession()` 主要只處理 text delta 與 tool start 或 end，因此大量原生事件尚未送到 Web。

### P2：完整 message queue

1. Follow-up API。
2. Steering 與 follow-up queue 顯示。
3. Dequeue 回 composer。
4. Queue delivery mode 設定。
5. Steering 與 follow-up 的不同視覺標示。

這些能力都已存在於 `AgentSession`。

### P3：改善 transcript

1. Thinking block。
2. 合併 tool call 與 result。
3. Bash live output。
4. Edit diff。
5. Read、grep 與 find compact preview。
6. Retry 與 compaction status。
7. Session stats footer。

### P4：Autocomplete

1. `/commands` autocomplete。
2. Template、skill 與 extension source 標示。
3. Command argument completion。
4. 安全的 `@file` workspace 搜尋。
5. Prompt history。

### P5：Session power features

1. Session search、rename 與 delete。
2. Tree。
3. Labels。
4. Fork 與 clone。
5. Manual compact。
6. Stats。
7. Export 與 import。

## 七、不建議做的項目

不建議把以下能力加入 `pi-agent`。

- 在瀏覽器嵌入完整 terminal emulator，只為了執行 `pi-tui`。
- 將 ANSI 畫面轉成 HTML 作為 extension UI。
- 從 Web 開啟本機 external editor。
- 從 Web 暴露任意 interactive shell。
- 模擬 Kitty 或 iTerm2 graphics protocol。
- 支援 terminal-only custom editor。
- 為了 Snake 或 Doom 建立通用 TUI runtime。

這些做法會降低 accessibility、增加安全風險，並讓 Web UI 綁死在 terminal rendering model。

## 最終判斷

最值得移植的不是 `pi-tui` 程式碼，而是它背後的產品行為。

高價值且能直接依賴 Pi 原生 API 的項目如下。

1. Follow-up 與完整 queue。
2. Thinking 顯示。
3. Rich tool output 與 diff。
4. Retry 與 compaction 狀態。
5. Session stats。
6. Session tree、fork 與 clone。
7. Slash command 與 `@file` autocomplete。
8. Extension status、widget、title 與 editor prefill。

任意 `ctx.ui.custom()` TUI 相容性不適合在目前架構中追求。
