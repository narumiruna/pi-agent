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
- 必須設定 owner subject、verified owner email，或兩者。
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
- [x] 實作 Pocket ID-compatible OIDC、PKCE、owner allowlist、server-side sessions、logout、expiry、Origin protection 與 fail-closed config。
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
