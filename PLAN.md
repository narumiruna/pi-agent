# 極簡 Pi Web Agent 實作計畫

## Summary

把 TypeScript starter 完成為單一擁有者、自架、可遠端登入的 Pi Web agent。

主要操作面是 Pi SDK Web chat。

Web terminal、channel、workflow、cron 與多使用者不在第一版範圍。

## Architecture

- 單一 Node.js 24 process 提供 Hono API、SSE、React 靜態前端、Pi runtime 與 heartbeat scheduler。
- `/app/.pi/agent` 是完整且可寫的原生 Pi agent directory。
- `/app/data` 儲存 Web session 與 heartbeat summary，預設使用 `/app/data/app.db`。
- `DATABASE_URL=postgresql://...` 切換 PostgreSQL；Pi JSONL sessions 仍在 agent directory。
- `/workspace` 是 Pi tools 的固定 cwd。
- runtime lock 阻止兩個 process 同時寫同一 agent directory。
- global run coordinator 保證 chat 與 heartbeat 不重疊。

## Security decisions

- 正式模式使用標準 OIDC Authorization Code + PKCE，並以 Pocket ID 為相容目標。
- 第一次完成已驗證 OIDC 登入的 identity 會原子綁定為唯一 administrator；Pocket ID client 必須先限制允許登入的使用者或群組。
- 缺少 OIDC 設定時 fail closed；只有明確的 `AUTH_MODE=disabled` 才可無驗證啟動。
- 應用只儲存 24 小時 session token 的 SHA-256 hash，不保留 OIDC token。
- session cookie 使用 HttpOnly、SameSite=Lax，非 localhost OIDC 部署強制 HTTPS。
- 所有 mutation API 驗證精確 `Origin`。
- `AGENT_TOOLS` 預設為 `read,grep,find,ls`。
- packages、extensions、skills 與 MCP 都視為可執行任意程式碼的 trusted dependencies。
- API 不回傳 `auth.json`、provider auth implementation、custom model headers 或 MCP 明文 secrets。

## Behavior

### Pi sessions and chat

- Pi JSONL 是對話唯一真實來源。
- Web API 使用 opaque session id，不接受檔案路徑。
- 支援列出、新增、開啟、重新命名及刪除非作用中對話。
- message API 回傳 run id，SSE 傳送 message delta、tool lifecycle、run status、interaction 與 package progress。
- SSE 使用 bounded replay buffer 與 stale cursor reset。
- Chat 執行中拒絕第二個 run，並可 abort。
- model、thinking level 與 provider credential flow 直接使用 Pi runtime APIs。

### Extensions and resources

- Web extension bridge 支援 select、confirm、input、editor、notify、status 與安全取消。
- TUI-only custom components、widgets、header/footer、theme switching 與 terminal input 安全降級。
- Web UI 可編輯 `SYSTEM.md`、`APPEND_SYSTEM.md` 與 `prompts/*.md`。
- resource names 使用安全 slug，寫入採同 directory temp file + atomic rename，並拒絕 symlink target。
- Pi PackageManager 支援 npm、git、URL 與 container relative/absolute path 的 install、update、remove。

### MCP

- `/app/.pi/agent/mcp.json` 支援 stdio 與 Streamable HTTP，不支援 legacy SSE。
- stdio 使用 executable + args，不經 shell。
- MCP tools 命名為 `mcp__<server>__<tool>`。
- 一個 server 失敗不阻止其他 server 或 agent 啟動。
- API 遮蔽 env/header secrets，masked update 保留既有值但拒絕不存在的 masked value。

### Heartbeat

- `HEARTBEAT.md` 是唯一設定來源。
- frontmatter 支援 `enabled` 與 `every`，範圍為 `1m` 到 `7d`。
- Heartbeat 使用專用 persistent Pi JSONL session。
- 首次啟動等待完整 interval，重啟逾期只補跑一次。
- 到期時等待 chat idle，manual run 在 busy 時回覆 conflict，不重疊且不自動重試。
- response 完全等於 `HEARTBEAT_OK` 才是 quiet。
- DB 只保存 run 狀態、時間、錯誤與 500 字元內摘要。

### UI

- 桌面使用窄 sidebar 與單一 workspace，手機 sidebar 使用 Radix Dialog。
- 頁面包含 Chat、Heartbeat、Library 與 Settings。
- 不使用 dashboard card grid 或漸層。
- 使用 Radix Themes、Colors、Icons、IBM Plex Sans 與 IBM Plex Mono。
- 唯一視覺 signature 是 sidebar heartbeat pulse rail。
- icon-only controls 具有 tooltip、accessible name 與 visible focus。
- 支援 `en`、`zh-TW`、localStorage language preference 與 reduced motion。

## Execution status

- [x] 建立 server、web、shared TypeScript 結構與 build/test/check scripts。
- [x] 實作 SQLite、PostgreSQL storage contracts、migrations 與 runtime lock。
- [x] 實作 Pocket ID-compatible OIDC、PKCE、first-login administrator claim、server-side sessions、logout、expiry、Origin protection 與 fail-closed config。
- [x] 實作 Pi `AgentSessionRuntime`、native session discovery、transcript projection、global run coordinator、SSE、abort、model/thinking 與 provider interaction broker。
- [x] 實作 ExtensionUIContext Web bridge 與 TUI-only graceful degradation。
- [x] 實作 System/Append/Templates editor、Pi PackageManager 操作、diagnostics、safe paths、atomic writes 與 idle reload。
- [x] 實作 MCP config、stdio/HTTP clients、tool bridge、secret masking、collision diagnostics、failure isolation 與 cleanup。
- [x] 實作 heartbeat parser、persistent session、scheduler、defer、manual run、classification 與 run history。
- [x] 實作 responsive Radix UI、Chat、Heartbeat、Library、Settings、interaction dialogs 與 en/zh-TW。
- [x] 建立 Node 24 multi-stage Dockerfile、non-root runtime、SQLite Compose、PostgreSQL override、healthcheck 與 bind-mount documentation。
- [x] 擴充 `justfile` 的 dev、CI、Docker、Compose 與兩種 smoke recipes。
- [x] 更新 README、`.env.example`、MCP/Heartbeat examples 與 GitHub Actions CI。
- [x] 完成 correctness、security、resource cleanup、container startup 與 scope review。

## Verification evidence

- [x] `npm run ci` 通過。
- [x] Unit/integration suite 涵蓋 auth、signed ID token、SQLite、optional PostgreSQL contract、Pi event mapping、interaction cancellation、MCP、heartbeat、resource safety 與雙語 UI。
- [x] `TEST_POSTGRES_URL` storage contract 在 PostgreSQL 17 container 通過。
- [x] `docker build` 通過，image 以 UID/GID `10001` 啟動並達到 healthy。
- [x] SQLite `just smoke` 通過。
- [x] PostgreSQL `just postgres-smoke` 通過。
- [x] 缺少 OIDC 設定時 container fail closed。
- [x] agent directory bind mount 可讀取 SYSTEM/templates、native JSONL sessions 與 local Pi package prompt，並由 API 原子回寫。
- [x] container 內 local Pi package 的 install、reload、update 與 remove lifecycle 通過。
- [x] 未知 server route 不會被 SPA fallback 偽裝為成功。
- [x] `just --list` 列出完整且有說明的 recipes。

## External acceptance still requiring deployment credentials

- [ ] 以實際 Pocket ID client 驗證 browser login、owner rejection 與 logout。
- [ ] 以實際 model provider credential 驗證 model response streaming 與 provider OAuth/API-key flow。
- [ ] 以部署方的既有完整 Pi directory 驗證其 private skills、extensions、packages、auth、models 與 sessions。

## Operational limits

- 一個 agent directory 只允許一個 application process。
- 不支援 horizontal scaling。
- OIDC 是 authentication boundary，不是 Pi、package、extension、skill 或 MCP sandbox。
- 掛載主機 `~/.pi/agent` 會授權 container 讀寫 credentials、sessions 與 executable resources。
- 跨 OS 或架構的 package 可能需在 Linux container 內重裝。

## Pi TUI 功能研究與 Web 採用計畫

### 研究範圍與原則

- 本次研究以已安裝的 `@earendil-works/pi-coding-agent@0.84.1` 與其內含的 `@earendil-works/pi-tui@0.84.1` 為準。
- `pi-tui` 是終端機渲染元件庫，不是可直接掛載到 React DOM 的 Web 元件庫。
- Pi 的互動模式建立在 `pi-tui` 上，但 session、queue、compaction、model 與 export 等能力來自 Pi core APIs。
- Web 應沿用 Pi core 的狀態與行為，再以 React、Radix Themes 與瀏覽器原生能力重作介面。
- 不新增平行的 session、queue、model、tool、extension 或 package abstraction。
- 不以終端模擬器、ANSI-to-HTML 或遠端 TUI 畫面串流作為主要整合方式。

### 採用標記

- `直接沿用` 代表可在 server 直接呼叫 Pi core API，且不需要複製內部狀態機。
- `Web 重作` 代表保留功能語意，但以 React 與 DOM 實作呈現和輸入。
- `部分採用` 代表只支援安全且可序列化的子集合。
- `不採用` 代表該能力只對實體終端有意義，或不適合瀏覽器安全模型。

### `pi-tui` 底層元件與基礎設施

- [不採用] `TuiMainScreen` 與 `TuiAltScreen` 負責主畫面和 alternate screen buffer，Web 已由瀏覽器頁面與路由管理畫面。
- [不採用] 差分渲染、同步輸出、游標定位與 terminal resize 是 ANSI 終端最佳化，React DOM 已提供自己的 reconciliation 與 layout。
- [不採用] `Terminal` 與 `ProcessTerminal` 封裝 stdin、stdout 與終端生命週期，browser client 不應取得 server process 的 raw terminal。
- [Web 重作] `Component`、`Container`、invalidate 與 disposal 提供元件生命週期概念，Web 對應 React component、state、effect 與 cleanup。
- [Web 重作] focus、`Focusable` 與 `CURSOR_MARKER` 解決終端游標和 IME 問題，Web 應使用原生 focus、textarea composition events 與可見 focus ring。
- [Web 重作] overlay、anchor、margin、stacking、responsive sizing 與 focus restore 對應 Radix Dialog、Popover、Dropdown Menu 與 browser viewport positioning。
- [Web 重作] `Text`、`TruncatedText`、`Box`、`Container`、`Spacer`、`VStack`、`HStack` 與 `ScrollView` 對應語意化 HTML、CSS flex/grid、overflow 與 sticky regions。
- [不採用] ANSI-aware wrapping、terminal column slicing、CJK cell width 與 `visibleWidth` 不應成為 Web layout 基礎。
- [部分採用] `stripTerminalSequences` 的語意可用於清理 extension 文字，但應在專案內建立小型且受測的序列化邊界，而不是直接依賴 transitive `pi-tui`。
- [Web 重作] `Input` 的單行輸入能力對應 Radix/TextField 或原生 input。
- [Web 重作] `Editor` 的多行編輯、換行、貼上與提交能力對應受控 textarea，並保留 browser IME、selection 與 clipboard 行為。
- [Web 重作] `Markdown` 可對應現有 transcript renderer，但必須禁止不受信任 HTML 並限制危險連結協定。
- [部分採用] `renderLatex` 可在有實際模型輸出需求時加入 Web LaTeX renderer，目前不增加依賴。
- [Web 重作] `Image`、尺寸偵測與 fallback 的使用者需求已由 Web image attachment、MIME 驗證、preview 與一般 `<img>` 呈現處理。
- [不採用] Kitty、iTerm2、GIF terminal protocol、cell dimensions 與 terminal image deletion 對瀏覽器沒有用途。
- [Web 重作] OSC 8 hyperlink 對應安全的 `<a>`，外部連結必須使用安全協定與適當的 `rel`。
- [Web 重作] `Loader` 與 `CancellableLoader` 對應 Spinner、明確進度文案與 abort control。
- [Web 重作] `SelectList` 對應可搜尋、可用鍵盤操作且有 focus management 的 Web selector。
- [Web 重作] `SettingsList` 對應 Settings 頁面中的表單、selector 與可驗證欄位。
- [Web 重作] slash command、檔案路徑、combined autocomplete 與 fuzzy filtering 可沿用互動模型，但資料來源和 UI 應由 Web API 與 React 實作。
- [不採用] Kitty keyboard protocol、escape sequence parser、key release/repeat 與 raw key matching 不應傳到 Web。
- [Web 重作] 可設定 keybindings 可在有明確需求時用 browser `KeyboardEvent` 實作，並避免覆蓋作業系統和輔助技術慣例。
- [不採用] `StdinBuffer`、bracketed paste parsing 與 terminal input buffering 已由 browser input events 處理。
- [部分採用] terminal foreground/background color detection 的目標可由 `prefers-color-scheme` 取代，現有 Web 已跟隨系統明暗模式。
- [不採用] terminal capability detection、truecolor negotiation 與 ANSI theme escape sequences 不應進入 Web protocol。

### Pi 互動模式功能對照

以下「現況」記錄規劃開始前的基準，完成狀態以後方 P0 至 P5 checklist 為準。

- [已支援] 文字 prompt、assistant text delta、abort、conversation list 與 native Pi JSONL transcript 已可在 Web 使用。
- [已支援] 圖片 attachment 已以 Pi image content 傳入 prompt，並由 Web 提供選取與 preview。
- [已支援] steering 使用原生 `prompt(..., { streamingBehavior: "steer" })`，執行中可把新訊息送入目前 run。
- [部分支援] tool call 目前只有開始與結束事件，缺少執行中 update、結構化參數、diff、完整輸出與展開狀態。
- [未支援] assistant thinking block、thinking delta、隱藏標籤與展開狀態尚未映射到 Web transcript。
- [未支援] follow-up queue 尚未使用原生 `followUp()`、queue getters、`clearQueue()` 與 `queue_update`。
- [未支援] steering 和 follow-up 的 delivery mode 尚未提供 `setSteeringMode()` 與 `setFollowUpMode()` 設定 UI。
- [部分支援] model picker 與 thinking level 已使用 Pi runtime API，但缺少 TUI 的快速 cycle、目前狀態提示與可用性說明。
- [未支援] active tools 切換尚未提供 Web UI，未來應直接使用 Pi 的 active tool APIs。
- [未支援] slash command menu 與 autocomplete 尚未消費既有 `/api/commands` 資料。
- [未支援] `@file` workspace autocomplete、檔案預覽與安全範圍驗證尚未提供。
- [已支援] select、confirm、input 與 multi-line editor extension dialogs 已透過 interaction broker 呈現。
- [部分支援] extension `notify()` 目前只有單一通知呈現，尚未完整區分 info、warning 與 error。
- [錯誤語意] extension `setStatus(key, text)` 目前被當成暫時通知，應改成 keyed、可更新、可清除的持續狀態。
- [未完成] extension `setEditorText()` 與 `pasteToEditor()` 已送出 SSE event，但 `App.tsx` 尚未把它寫入 chat composer。
- [未支援] extension `getEditorText()` 固定回傳空字串，server 也沒有可靠的同步 composer snapshot。
- [未支援] extension string widget、title、working message、working visibility、working indicator 與 hidden-thinking label 尚未映射到 Web。
- [不採用] extension component widget、custom header、custom footer、custom editor 與 custom message renderer 回傳的是 terminal `Component`，無法通用轉換成 React。
- [不採用] extension `custom()` 在 RPC/headless 模式本來就無法承載任意 TUI component，Web 維持安全降級。
- [不採用] extension `onTerminalInput()` 不應把 browser raw keyboard stream 傳給 server-side extension。
- [不採用] extension theme object 與 terminal color theme 不直接控制 Web theme，Web 應維持自己的 accessible design tokens。
- [部分支援] tool expanded preference 可成為 Web local preference，但不需要模擬 TUI component state。
- [未支援] session stats 與 context usage 尚未使用原生 `getSessionStats()` 和 `getContextUsage()` 呈現。
- [未支援] manual compaction 尚未使用原生 `compact()`，也沒有顯示 compaction lifecycle 和 summary。
- [未支援] session tree、branch navigation 與回到任一節點尚未使用 `getTree()` 和 `navigateTree()`。
- [未支援] fork 與 clone 尚未使用 Pi runtime `fork()` 和指定 position 的 native session 操作。
- [未支援] transcript HTML/JSONL export 與 native session import 尚未暴露為 Web 操作。
- [不採用] TUI external editor 流程依賴本機 terminal 和 `$EDITOR`，遠端 browser 不應啟動 server 端互動式 editor。
- [不採用] arbitrary interactive shell 會混淆 chat tools 與 terminal trust boundary，不納入一般 Web chat。
- [不採用] snake、overlay QA demo 等範例只用於驗證 TUI framework，不是產品功能。

### 現有事件橋接缺口

以下缺口記錄規劃開始前的基準，已完成的事件 contract 與 bridge 以後方 checklist 為準。

- `EventHub` 目前只定義 interaction、message delta、notification、package progress、provider auth、run status 與 tool status。
- `PiService` 目前主要發布 text delta、tool start、tool end 與 run lifecycle。
- Web protocol 尚未表示 thinking delta、tool update、queue update、retry、compaction、model change、thinking change、status map 與 widget update。
- 新事件必須包含 session 或 run identity，避免切換對話時把舊事件套到錯誤畫面。
- SSE replay 必須維持 bounded buffer 與 stale cursor reset，不另建第二條即時通道。
- transcript 重載後必須能從 Pi JSONL 還原完成狀態，SSE 只負責即時增量而不是新的真實來源。

### 實作優先順序

#### P0：補齊安全且可序列化的 Extension UI 語意

- [x] 讓 `setEditorText()` 和 `pasteToEditor()` 實際更新目前 composer，並明確定義執行中、切換對話與未聚焦時的行為。
- [x] 將 `setStatus()` 改為依 key 儲存的狀態列資料，並在 text 為 undefined 時清除該 key。
- [x] 保留 `notify()` 的 info、warning 和 error 類型，並提供 screen-reader 可感知的呈現。
- [x] 支援 `setTitle()` 更新安全的 browser document title，並在清除或 session 切換時恢復預設值。
- [x] 只支援 `setWidget()` 的 `string[]` overload，並拒絕或安全忽略 terminal component factory overload。
- [x] 為 extension 文字移除 terminal control sequences，限制單筆大小、總量與更新頻率。
- [x] 明確記錄 `custom()`、raw terminal input、custom component renderer 與 custom editor 在 Web 不支援。

#### P1：完成 Pi event 到 Web event 的映射

- [x] 加入 thinking start、delta 和 end，並在 transcript 中提供可存取的折疊區塊。
- [x] 加入 tool execution update、結構化參數、安全截斷輸出、diff 與 success/error 狀態。
- [x] 加入 queue update、retry、compaction、model change 與 thinking-level change events。
- [x] 將事件 contract 放在 `src/shared/`，讓 server publisher 與 Web consumer 共用 discriminated union。
- [x] 為未知事件、重複事件、跨 session 事件、SSE replay 與 reconnect 增加測試。

#### P2：完成 follow-up 與 queue 工作流

- [x] 以 `followUp()` 實作下一輪訊息，不以自製陣列模擬 Pi queue。
- [x] 顯示 steering queue 與 follow-up queue，並允許使用者清除尚未送達的項目。
- [x] 提供 steering 和 follow-up delivery mode 設定，設定值直接寫入 Pi session runtime。
- [x] 清楚區分立即 steering、目前 response 結束後 follow-up 與新 conversation prompt。
- [x] 在 abort、error、conversation switch 與 reconnect 後從 native queue state 重新同步。

#### P3：改善 transcript 與執行狀態

- [x] 呈現 thinking、tool updates、tool diff、長輸出折疊與執行耗時。
- [x] 使用 `getSessionStats()` 與 `getContextUsage()` 顯示 model、tokens、cost、context 與 session 大小。
- [x] 提供 working message、loader visibility 與 hidden-thinking label 的安全 Web 子集合。
- [x] 將 extension keyed status 與 Pi runtime status 放在固定狀態區，不再混用 toast。
- [x] 保留 reduced motion、keyboard navigation、visible focus 與 mobile layout。

#### P4：加入 command 與 workspace autocomplete

- [x] composer 輸入 `/` 時顯示 `/api/commands` 的 native command、prompt template 與 extension command。
- [x] 使用簡單 fuzzy match 排序 command，並支援鍵盤選取、Escape 關閉與 pointer 操作。
- [x] composer 輸入 `@` 時只搜尋設定的 `WORKSPACE` 範圍，且 server 必須拒絕 traversal 和 symlink escape。
- [x] 對大型 workspace 使用結果上限、debounce、取消與最小查詢長度，避免無界掃描。
- [x] 插入 command 或 path 時只修改 composer text，不在 browser 執行 shell 或解析任意 extension component。

#### P5：加入 native session 進階操作

- [x] 使用 `getTree()` 顯示 branch tree，並用 `navigateTree()` 回到選定節點。
- [x] 使用 Pi runtime `fork()` 建立 branch，並以 native position clone 建立新 session。
- [x] 使用 `compact()` 提供 manual compaction、進度、結果與失敗恢復。
- [x] 提供 HTML 和 JSONL export，下載檔名不得暴露 server 絕對路徑。
- [x] 提供受驗證的 native session import，並限制大小、格式與寫入位置。
- [x] 在 destructive navigation、fork、compact 與 import 前處理 active run 和 queue conflict。

### 實作結果

- Web extension bridge 現在保存可重播的 status、string widget、title、working state、tool expansion 與 editor snapshot。
- Event bridge 現在以 `src/shared/contracts.ts` 的 discriminated event map 傳送 thinking、message completion、tool update、queue、retry、compaction、model、thinking level 與 extension UI state。
- Composer 直接使用 Pi 的 steer、follow-up 與 queue APIs，重新連線時由 native session snapshot 恢復 running 與 queue 狀態。
- Transcript 現在合併 tool call/result、顯示 thinking、diff、tool image、custom message、branch summary、compaction summary 與 bounded live output。
- Workspace autocomplete 只走受限 server search，略過 symlink、secret-like path、VCS metadata、dependency output 與 private agent directories。
- Session panel 直接使用 Pi tree、navigation、fork、compact、stats、context、HTML/JSONL export 與 import APIs。
- JSONL import 限制為 5 MB、拒絕重複 session id、使用 opaque Web id，並強制套用部署的 `WORKSPACE`。
- `ctx.ui.custom()` 與其他 terminal component factories 仍維持明確且安全的 unsupported fallback。

### 暫不實作項目

- 不嵌入 xterm 類終端模擬器只為了執行 `pi-tui`。
- 不把 ANSI escape sequences 轉成任意 HTML。
- 不讓 extension 把 terminal `Component` factory 或任意 client code 傳到 browser 執行。
- 不模擬 Kitty 或 iTerm 圖片協定。
- 不提供 server-side `$EDITOR`、raw stdin 或 unrestricted interactive shell。
- 不為了 TUI 相容而複製 Pi core session、queue、model 或 tool state。

### 驗證要求

- [x] 每個行為變更都要在 matching server 或 Web test area 增加 Vitest coverage。
- [x] Extension bridge 測試必須涵蓋 keyed clear、文字清理、大小限制、unsupported overload 與 interaction cancellation。
- [x] Queue 測試必須涵蓋 steer、follow-up、clear、abort、error、reconnect 與 conversation isolation。
- [x] Transcript 測試必須確認 SSE 增量與 JSONL reload 會得到一致的最終畫面。
- [x] Autocomplete 測試必須涵蓋 keyboard、IME、mobile、empty result、large result 與 workspace escape。
- [x] Session 操作測試必須確認 opaque id、安全路徑、active run conflict 與原始 JSONL 不被破壞。
- [x] UI 必須通過 keyboard-only、screen-reader labels、visible focus、reduced motion 與窄螢幕檢查。
- [x] 完成每個階段後執行 `npm run check`、`npm test` 與 `npm run build`。
- [x] server 或 production runtime 行為改變時另執行 `npm run ci` 與 `docker build -t pi-agent:local .`。

### Pi TUI 實作驗證證據

- [x] `npm run ci` 通過，包含 Biome、E2E TypeScript、Vitest 與 production build。
- [x] SQLite Vitest 178 個測試通過；設定 `TEST_POSTGRES_URL` 後 183 個測試全數通過，覆蓋 extension state、event projection、queue、workspace containment、session transfer、transcript、heartbeat diagnostics、React interactions、storage contract 與 failure recovery。
- [x] SQLite 與 PostgreSQL 各自執行 `npm run test:e2e`，兩次皆有 14 個 browser tests 通過，包含 OIDC、streaming、steering、reload、conversation isolation、accessibility 與 390px mobile autocomplete。
- [x] `docker build -t pi-agent:local .` 通過。
- [x] 實際 Pocket ID、實際 model provider 與部署方 private Pi directory 仍屬前方列出的外部 acceptance 項目。
