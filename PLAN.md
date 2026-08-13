# 極簡 Pi Web Agent 實作計畫

## Summary

把目前的 TypeScript template 改造成單一擁有者、自架、可遠端登入的 Web agent。

主要操作面是 **Pi SDK Web chat**，不是 PTY／Web terminal。

Agent 核心直接使用 `@earendil-works/pi-coding-agent` 的 `AgentSessionRuntime`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`、`SettingsManager` 與 `DefaultPackageManager`。

後端使用 Hono，前端使用 React、Vite 與 Radix UI，應用程式碼維持純 TypeScript／TSX。

## Architecture

- 單一 Node.js 24 process 同時提供 Hono API、SSE、靜態前端、Pi runtime 與 heartbeat scheduler。
- `/app/.pi/agent` 是 Pi 原生 `agentDir` 與唯一可寫來源。
- `/app/.pi/agent` 可不掛載、掛 named volume，或直接 bind mount `./data/pi/agent`／主機 `~/.pi/agent`。
- `/app/data` 是獨立 Web 狀態 volume；SQLite 預設位於 `/app/data/app.db`。
- PostgreSQL 由 `DATABASE_URL=postgresql://...` 切換；Pi JSONL sessions 仍留在 `/app/.pi/agent`。
- `/workspace` 是 Pi tools 的固定 cwd，可選擇性掛載工作目錄。
- 僅允許一個 app replica／一個 agent runtime 寫入同一個 agentDir；啟動鎖阻止第二個 writer。
- 一次只執行一個 agent run；一般對話執行中回覆 `409 agent_busy`，到期 heartbeat 延後至 idle 後執行一次。

## Tech Stack

- Backend：Hono、`@hono/node-server`、`@hono/oidc-auth`、`@hono/typebox-validator`。
- Agent：`@earendil-works/pi-coding-agent` 及其 Pi core packages。
- Frontend：React、Vite、Radix Themes、Colors、Icons 與必要 Primitives。
- Streaming：Hono SSE；不加入 WebSocket、`node-pty` 或 xterm.js。
- Persistence：`node:sqlite` 與 `postgres`，透過小型 typed repository interface 共用行為，不加入 ORM。
- MCP：官方 `@modelcontextprotocol/sdk`。
- Validation：TypeBox。
- Markdown：`react-markdown` 與 `remark-gfm`，不允許 raw HTML。
- i18n：`i18next`、`react-i18next`，內建 `en` 與 `zh-TW` 靜態字典。
- Quality：Biome、TypeScript strict、Vitest、Testing Library。

## Behavior and Public Interfaces

### Authentication

- 正式模式只允許標準 OIDC Authorization Code + PKCE 登入，並以 Pocket ID 作為相容性目標。
- 必填設定為 `APP_ORIGIN`、`OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`，以及至少一個 `OIDC_OWNER_SUB` 或 `OIDC_OWNER_EMAIL`。
- 若同時設定 subject 與 email，兩者都必須符合；email 比對要求已驗證的 `email_verified` claim。
- 缺少 OIDC 設定時 fail closed；只有明確設定 `AUTH_MODE=disabled` 才能無驗證啟動，並持續顯示安全警告。
- OIDC token 驗證後不長期保存；應用建立 24 小時固定期限的隨機 server-side session，資料庫只存 token hash。
- Cookie 使用 HttpOnly、SameSite=Lax、Secure，mutation API 另驗證 `Origin`。
- 公開端點僅包含 `/health/live`、`/health/ready` 與 OIDC login/callback；其餘 `/api/*` 與 SSE 都需登入。

### Pi sessions and chat

- Pi JSONL 是對話唯一真實來源，保留原生 tree、compaction、usage、model change 與 extension state。
- Web API 使用 opaque session id，不接受任意檔案路徑。
- 支援列出、新增、開啟、重新命名及刪除非作用中對話；第一版不提供 tree、fork、clone 或匯入。
- `POST /api/conversations/:id/messages` 接受文字並回傳 run id；`GET /api/events` 以 typed SSE 傳送 message delta、tool lifecycle、run status、interaction 與 package progress。
- 斷線重連後以前次 event id 補送短期 ring buffer，並重新抓取 Pi JSONL transcript 作為權威狀態。
- Chat 執行中 composer 停用並顯示 Stop；第一版不開放 steer/follow-up queue 或圖片附件。
- model、thinking level、provider credential login/logout 都由 Web UI 操作，底層使用 `ModelRuntime` 與 `SettingsManager`，憑證寫回 `/app/.pi/agent/auth.json`。
- Provider OAuth／API-key prompt 與 extension UI 共用一個 typed interaction broker。

### Tools and extensions

- `AGENT_TOOLS` 預設為 `read,grep,find,ls`；`bash,edit,write` 只能由 Compose／環境設定明確加入，Web UI 只顯示目前 allowlist，不直接切換。
- mounted global agentDir 視為 trusted；workspace-local dynamic resources 預設不載入，避免未確認的 `.pi/extensions` 在啟動時執行。
- Extension 支援 tools、events、commands，以及 Web 版 `select`、`confirm`、`input`、`editor`、`notify`、`status`。
- TUI custom components、widgets、footer/header、raw terminal input 與 shortcuts 明確不支援並安全 no-op。
- Extension／skill 新增走 Pi PackageManager，支援 npm、git 與容器內本機 package source；不提供瀏覽器原始 TypeScript 編輯器。
- 安裝、更新、移除 package 前顯示「可執行任意程式碼」警告，操作中串流 progress，完成後只在 agent idle 時 reload。

### Prompts and MCP

- Web UI 可編輯 `SYSTEM.md`、`APPEND_SYSTEM.md` 與 `/app/.pi/agent/prompts/*.md`。
- 名稱限制為安全 slug，所有寫入採 temp file + atomic rename，禁止路徑跳脫。
- MCP 使用 `/app/.pi/agent/mcp.json` 的 `mcpServers` 結構。
- 支援 stdio 與 Streamable HTTP，不支援 legacy SSE。
- stdio 使用 executable + args，不經 shell；HTTP 只接受 `http:`／`https:` URL。
- MCP tools 以 `mcp__<server>__<tool>` 命名避免衝突；第一版只橋接 tools，不橋接 MCP prompts/resources。
- MCP 連線失敗只產生診斷，不阻止其他資源與 agent 啟動；儲存後在 idle 狀態 reload。
- API 回傳 MCP config 時遮蔽 env/header secret，更新可保留原值而不回傳明文。

### Heartbeat

- `/app/.pi/agent/HEARTBEAT.md` 是唯一 heartbeat 設定來源。
- 格式為 YAML frontmatter 加 Markdown body：`enabled` 預設 `true`，`every` 預設 `30m`，允許 `m`／`h`／`d`，範圍 1 分鐘至 7 天。
- 檔案不存在、body 空白、frontmatter 無效或 `enabled: false` 時不排程，UI 顯示具體診斷。
- Heartbeat 使用隱藏的專用 persistent Pi JSONL session，不污染一般對話。
- 首次啟動等待一個完整 interval；已有歷史且逾期時只補執行一次，不回補多次。
- 不重疊、不自動重試；失敗留待下一個 interval，並可從 UI 手動執行或停止。
- response 恰為 `HEARTBEAT_OK` 時標記為 quiet success；其他內容標記為 attention。
- 資料庫只存 run 狀態、時間、錯誤與短摘要，完整內容仍在 heartbeat JSONL。
- 第一版不提供 cron、任務依賴、webhook、通知 channel 或多 routine。

### UI direction

- 桌面使用窄 sidebar + 單一中央 workspace；手機以 Radix Dialog 顯示 sidebar。
- Chat 是預設頁；Heartbeat、Library、Settings 是次要頁面。
- 不使用 dashboard card grid、漸層或多個競爭 CTA。
- Palette：cool canvas `#F5F7F7`、surface `#FFFFFF`、ink `#172126`、muted `#657279`、line `#DCE2E3`、mineral teal `#28717A`、danger `#C34747`，並提供對應 dark tokens。
- 字體使用 IBM Plex Sans 搭配系統 CJK fallback；技術值使用 IBM Plex Mono。
- 唯一視覺 signature 是 sidebar 上的 heartbeat pulse rail；只在狀態改變時短暫動作，遵守 `prefers-reduced-motion`。
- 所有 icon-only control 都有 tooltip、accessible name、可見 focus；錯誤與狀態不只靠顏色。
- 語言依瀏覽器偏好選 `zh-TW` 或 `en`，使用者選擇存於 localStorage；server 回傳穩定 error code 與 params，由前端翻譯。

## Non-Goals

- 多使用者、註冊、角色與分享。
- 多 app replica 或水平擴充。
- PTY、Web terminal、直接 shell UI。
- Telegram／Discord／Slack 等 channel、voice、browser automation。
- Hermes 式 self-learning、自動建立 skill、cron scheduler 或工作流。
- 自製 message/session database 取代 Pi JSONL。
- 完整相容 Pi TUI extension components。

## Plan

- [ ] 先以 failing tests 固定 config、path、duration、owner claim 與 API error contracts，再重整單一 npm package 的 server/web/shared 結構與 scripts；以 `npm run ci` 驗證 TypeScript、Biome 與基礎測試，並把 `MEMORY.md` 正規化為 `GOTCHA`／`TASTE` 兩節。
- [ ] 建立環境設定與 typed storage interface，實作 `node:sqlite`、PostgreSQL adapters、dialect migrations、web sessions、heartbeat runs 與 runtime lock；以暫存 SQLite 測試及 PostgreSQL compose contract tests 驗證相同行為。
- [ ] 以 TDD 實作 Pocket ID 相容 OIDC、owner allowlist、server-side cookie session、logout、expiry、Origin/CSRF 與 fail-closed startup；以 mock OIDC issuer 驗證 state、nonce、PKCE、錯誤 claim 與未登入保護。
- [ ] 建立單一 Pi `AgentSessionRuntime` service、session switching、JSONL transcript projection、global run coordinator、SSE event mapper、abort、model/thinking 控制及 provider interaction broker；以 fake agent adapter 驗證 streaming、重連、busy、abort、reload 與 session 切換。
- [ ] 實作基本 ExtensionUIContext Web bridge 與 slash command registry；以測試 extension 驗證 confirm/input/notify/status、取消、timeout，以及 TUI-only API 的降級行為。
- [ ] 實作 System/Append/Templates 編輯、Pi PackageManager 操作、resource diagnostics、atomic write 與 idle-only reload；以 temp agentDir 與 fake package source 驗證路徑安全、進度、失敗復原及 mounted defaults discovery。
- [ ] 實作 MCP config repository、stdio/Streamable HTTP clients、tool schema/result bridge、secret redaction 與 session shutdown cleanup；以本機測試 MCP servers 驗證 discovery、call、timeout、collision、reload 與部分 server 故障。
- [ ] 先用 fake clock 與 fake Pi session 寫 heartbeat 排程規格，再實作 frontmatter parser、專用 session、defer/no-overlap/no-catch-up、manual run、`HEARTBEAT_OK` 分類與 run history。
- [ ] 依上述 Radix 視覺系統實作 OIDC login、responsive app shell、conversation chat、tool rows、interaction dialogs、Heartbeat、Library、Providers/Settings 與 en/zh-TW；以 Testing Library 驗證 keyboard、focus、modal recovery、language switching、empty/error/loading states與 mobile reflow。
- [ ] 建立 Node 24 multi-stage Dockerfile、SQLite compose、PostgreSQL override compose、non-root runtime、healthcheck 與 volume/UID 文件；以 image build、兩種 database smoke test、可選 agentDir bind mount 與 graceful SIGTERM 驗證。
- [ ] 更新 README 與 `.env.example`，記錄 Pocket ID client 設定、兩個 volumes、`AGENT_TOOLS`、MCP schema、HEARTBEAT.md、package RCE 警告、跨 OS 掛載限制、備份與單 replica 限制；以全新目錄逐步執行文件確認可重現。

## Risks and Recovery

- 掛載真實主機 `~/.pi/agent` 會暴露並回寫 credentials、sessions 與 extensions；文件預設推薦專屬 `./data/pi/agent`。
- macOS／不同架構的已安裝 npm/git package 可能不能在 Linux 容器重用；保留 package source 設定並在容器內重裝。
- Extensions、skills、MCP 與 Pi packages 都在 app/container 權限內執行；OIDC 不是 sandbox，僅 Docker volume 與工具 allowlist 形成邊界。
- DB migration 在啟動時交易式執行；失敗即保持 not-ready 並拒絕啟動，不修改 Pi JSONL。
- Package/resource reload 失敗時保留原檔或原 runtime，顯示診斷，避免半載入狀態。

## Assumptions and Defaults

- 第一版只有一位 OIDC owner，但可從多個裝置登入。
- 正式部署由反向代理提供 HTTPS，`APP_ORIGIN` 是唯一可信 public origin。
- Compose 預設建立獨立 `pi-agent` 與 `app-data` named volumes；Docker run 可選擇不掛或 bind mount。
- 應用程式碼全部是 TypeScript／TSX；SQLite 使用 Node 內建 `node:sqlite`，不加入自製原生 addon。
- 既有 agentDir 內容視為擁有者主動信任的全域 Pi 設定。
- UI 可瀏覽多個 session，但同一時間只允許一個 Pi run。

## Completion Checklist

- [ ] `npm run ci` 全綠，且測試包含 auth、SQLite/PostgreSQL contract、Pi event mapping、MCP、heartbeat、resource safety 與雙語 UI。
- [ ] SQLite 與 PostgreSQL compose 都能完成 OIDC login、建立對話、串流回覆、重啟續聊與 logout。
- [ ] `./data/pi/agent:/app/.pi/agent` bind mount 能載入既有 SYSTEM、prompts、skills、extensions、packages、models/auth 與 sessions，且 UI 修改可回寫。
- [ ] Pocket ID 實機驗證通過 login、owner rejection、expired session 與 logout。
- [ ] stdio 與 Streamable HTTP MCP 均能載入、呼叫、失敗隔離與 reload。
- [ ] HEARTBEAT.md 能排程、defer、手動執行、重啟後單次補跑，且不污染一般 conversation。
- [ ] keyboard-only、reduced motion、窄 viewport、en/zh-TW 與主要 empty/loading/error states 完成可用性檢查。
- [ ] Docker image 以 non-root 啟動，healthcheck 正常，缺少 OIDC 時 fail closed，且 graceful shutdown 會停止 agent、MCP 與 scheduler。
