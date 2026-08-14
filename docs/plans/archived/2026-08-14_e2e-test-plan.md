## Goal

建立一套以 Playwright 撰寫的純 TypeScript E2E 測試，驗證使用者從登入、選擇模型、對話、Heartbeat 到資源編輯的核心流程，並在 SQLite 與 PostgreSQL 上執行相同的瀏覽器情境。

成功條件是測試使用真實 production build、Hono API、Pi runtime、SSE、原生 Pi 檔案與資料庫，只在 Pocket ID 與模型供應商邊界使用本機 deterministic mock。

## Context

目前 Vitest 已涵蓋伺服器契約、React 狀態、OIDC 驗證、SQLite/PostgreSQL storage contract、Pi service、Heartbeat、MCP 與資源安全。

目前 Docker smoke test 只驗證 image 能啟動並通過 readiness。

目前沒有真實瀏覽器測試跨越 React、HTTP、SSE、Pi session、檔案與資料庫，因此模型列不可點擊、初始對話不可用、登入 redirect 中斷等整合問題可能漏過。

E2E 不應呼叫真實 Pocket ID、OpenAI 或其他付費服務，避免 CI 依賴秘密、配額、網路與第三方可用性。

## Architecture

- 使用 `@playwright/test`，第一階段只執行 Chromium desktop 與 Chromium mobile emulation。
- 使用 production Web build 與真實 Node/Hono server，不以 Vite dev server 或 browser route mocking 代替後端。
- 使用 `tests/e2e/support/server.ts` 建立隔離 runtime directory、啟動 mock OIDC、mock OpenAI-compatible provider，再啟動應用程式。
- mock OIDC 使用 Hono 與現有 `jose`，實作 discovery、authorize、token、JWKS、authorization code、nonce 與 PKCE verifier 驗證。
- mock model provider 使用 Hono 實作 `/v1/chat/completions` SSE，依 request model 與最後一則 user message回傳 deterministic streaming response。
- E2E fixture 以 Pi 原生 `models.json` 設定兩個 `openai-completions` 模型，並以 `settings.json` 指定預設模型。
- 設定 `PI_OFFLINE=1`，所有必要網路請求只允許 localhost。
- 每次執行使用 `.local/e2e/` 下的全新 agent、data、workspace 與 browser state，不讀取使用者的 `.env`、`~/.pi/agent` 或既有資料。
- 因產品是一個 agent directory 對一個 process，Playwright 設定 `workers: 1` 且不平行執行會修改共享 runtime 的案例。
- selector 優先使用 role、accessible name、label 與可見文字，不以 CSS implementation detail 或大量 `data-testid` 綁定測試。
- 預設保留 failure screenshot、trace 與 video，不建立容易受字型與平台影響的全頁 visual snapshot baseline。

## Test Matrix

| Suite | Priority | Required behavior |
| --- | --- | --- |
| OIDC bootstrap | P0 | 未登入顯示 Pocket ID；完整 redirect 登入後第一位 verified identity 成為 owner；authenticated state 可供其他 suites 使用。 |
| OIDC boundaries | P0 | 第二個 `sub` 被拒絕；owner 可建立另一個 session；logout 只撤銷目前 session 並回到登入畫面。 |
| Chat | P0 | 初始 in-memory conversation 的 composer 可輸入；訊息經 API、Pi 與 SSE 顯示 streaming answer；reload 後 transcript 仍存在。 |
| Conversations | P0 | 新增對話後可立即輸入；切回舊對話時內容隔離且正確恢復。 |
| Model selection | P0 | 點擊整個模型列即可選取；取消不改變模型；確認後 current model 更新；下一則 mock response 證明 request 使用新 model id。 |
| Heartbeat | P0 | 儲存合法 `HEARTBEAT.md`、手動執行、收到 `HEARTBEAT_OK`、顯示 quiet run，reload 後 run history 仍存在。 |
| Library | P1 | 編輯並儲存 `SYSTEM.md`，重新載入頁面後內容仍存在；建立與刪除一個 prompt template。 |
| Recovery | P1 | mock provider 對下一次 request 回覆錯誤後，run 不會永久卡住，composer 可再次送出成功訊息。 |
| Mobile and accessibility | P1 | 390×844 viewport 可開關 Radix mobile navigation、完成模型選取與回到 Chat；主要頁面無水平 overflow；鍵盤可完成 dialog 流程。 |
| Automated accessibility | P1 | 以 `@axe-core/playwright` 掃描登入、Chat、Settings dialog 與 Heartbeat 的嚴重 WCAG 2A/2AA violations。 |

相同 P0/P1 suites 在 SQLite 與 PostgreSQL CI matrix 執行。

真實 Pocket ID、OpenAI Codex device code、ChatGPT 訂閱與付費 API key 僅保留為手動或 workflow-dispatch acceptance，不作為 pull request gate。

現有 Vitest 應繼續負責 Codex device-code dialog 的所有狀態、provider cancellation、secret redaction、destructive confirmation、path safety 與細部錯誤分支，避免 E2E 重複低層排列組合。

## Non-Goals

- 不測試第三方服務的 UI、可用性、配額或帳務。
- 不把 test-only route 或 mock behavior 加入 production server。
- 不在第一階段加入 Firefox、WebKit 或像素級 screenshot regression。
- 不以 E2E 取代現有 Vitest、storage contract 或 Docker smoke tests。
- 不安裝、執行或移除真實 Pi package、extension 或外部 MCP server。

## Assumptions

- Chromium 涵蓋目前單一擁有者自架 Web UI 的最低瀏覽器相容性需求。
- GitHub Actions 可接受 SQLite 與 PostgreSQL 兩個小型 E2E matrix jobs。
- Pi `openai-completions` provider 會持續遵循標準 Chat Completions SSE contract；fixture 會在升級 Pi packages 時及早偵測 contract drift。

## Plan

- [x] 安裝 `@playwright/test` 與 `@axe-core/playwright` dev dependencies，加入 `playwright.config.ts`、`test:e2e` script 與 `.local/e2e/` artifact paths；`npm exec playwright test -- --list` 已發現 setup、desktop、mobile 共 13 個 tests，且 `npm run check:e2e` 通過。
- [x] 建立 `tests/e2e/support/server.ts` 與 runtime fixture，安全清空且只重建 `.local/e2e/`，寫入兩個 mock models 與預設 model settings，並以 production build 啟動 app；setup run 通過 `/health/ready`，結束後 39110 不再接受連線，且隔離 fixture 檔案存在。
- [x] 建立完整 mock OIDC issuer，驗證 state passthrough、nonce、PKCE challenge/verifier、issuer、audience 與 identity selection；desktop auth run 的 5 個 tests 通過，包含 owner 登入、錯誤 verifier、第二 identity rejection 與獨立 logout session。
- [x] 建立 OpenAI-compatible streaming mock，驗證 request authorization、model id、最後一則 user message、正常 SSE、deterministic hold/release、一次性 failure 與 `HEARTBEAT_OK` response；真實 Pi chat focused run 的 4 個 tests 通過正常 streaming、captured request、reload、conversation isolation 與 failure retry。
- [x] 實作 OIDC setup 與 boundary specs，將 owner storage state 寫入 `.local/e2e/state/owner.json`，並確保第二身份與 logout 使用獨立 session；5 個 focused browser tests 已以登入畫面、callback status、cookie-backed `/api/session` 與 owner session survival 驗證。
- [x] 實作 Chat、conversation 與 model-selection specs，涵蓋初始 composer、streaming、reload persistence、對話隔離、整列選取、取消與確認；4 個 chat tests 與 1 個 settings test 通過，並以 transcript、current model 與 mock-captured model id 驗證。
- [x] 實作 Heartbeat 與 Library specs，涵蓋 `HEARTBEAT.md` quiet run history、`SYSTEM.md` persistence 與 template create/delete；兩個 focused runs 通過 reload 後 UI state、SQLite history 與隔離 runtime 檔案 assertions。
- [x] 實作 provider failure recovery、mobile navigation、keyboard dialog 操作、overflow assertion 與 axe scan；focused runs 已驗證 failed run 後成功 retry、390×844 navigation、radio focus/keyboard activation、無水平 overflow，以及登入、Chat、Settings dialog、Heartbeat 零 serious/critical violations。
- [x] 更新 `.github/workflows/ci.yaml` 增加獨立 E2E matrix job，使用 fresh PostgreSQL service、安裝 Chromium dependencies，分別以空 `DATABASE_URL` 與 dedicated PostgreSQL database 執行相同 suites；PR #6 的 `e2e (sqlite)` 與 `e2e (postgres)` checks 分別於 1m33s 與 1m32s 通過，`verify` 亦於 1m36s 通過。
- [x] 更新 `justfile` 與 `README.md`，提供 `just e2e`、artifact 位置、port override、SQLite 預設與 `E2E_DATABASE_URL` PostgreSQL 用法；`just --list`、`just e2e` 與對 fresh `pi_agent_e2e` database 的 `just e2e-postgres` 均已通過。
- [x] 執行 `npm run ci`、SQLite E2E、PostgreSQL E2E、`just smoke` 與 `just postgres-smoke`，再檢查測試無 arbitrary sleep、無真實 secrets、無外部 network、無 production test seam 與無使用者資料路徑；最終結果為 Vitest 134 passed/5 skipped、兩種 storage 各 13 E2E passed、兩種 smoke passed、production dependency audit 0 vulnerabilities，且 static-import、path、secret、network 與 lifecycle review 無未解 blocker。

## Risks

- Pi package 升級可能改變 OpenAI-compatible payload或 SSE expectations，因此 mock 應維持最小標準 contract，contract drift 應視為有價值的失敗而不是放寬 assertion。
- OIDC mock 若以全域可變 identity 控制，在平行執行時可能互相污染，因此 auth tests 必須單 worker，且每個 authorization code 固化簽發當下的 identity 與 nonce。
- Heartbeat、model 與 active conversation 是 process-global state，因此測試應建立唯一資料並避免依賴 spec file 排序。
- PostgreSQL E2E 必須使用 fresh database，否則既有 owner row 會使 first-login case失真。
- Mock provider只能證明本產品與標準 provider contract 的整合，不能取代定期的真實 Pocket ID 與 provider acceptance。
- E2E 可能揭露目前 UI 缺少明確 failure feedback；若需改 production behavior，應先增加最小 regression expectation，再以獨立 focused fix 處理。

## Rollback / Recovery

- 此方案不需要 production database migration或 runtime data migration。
- 若 E2E job不穩定，可暫時將該 job改為 non-required，但不可刪除 failure artifacts或放寬產品 assertion 來隱藏 race。
- 移除 Playwright config、E2E support files、dev dependencies 與 workflow job即可回復，不影響 production image與資料。

## Completion Checklist

- [x] Production build 的完整 owner journey 已由 Playwright 驗證，證據為 OIDC、model、chat、Heartbeat 與 Library suites 在 SQLite 與 PostgreSQL 各 13 tests 通過。
- [x] 初始對話與整列模型選取 regression 已由真實 browser interaction 驗證，且測試只透過可見 control 與公開 HTTP contract 操作產品。
- [x] SQLite 與 PostgreSQL parity 已由 PR #6 GitHub Actions 的 `e2e (sqlite)` 與 `e2e (postgres)` 兩個成功 checks 驗證。
- [x] 測試不接觸使用者 `.env`、`~/.pi/agent`、現有 database 或非 localhost network，證據為 `.local/e2e/` containment guards、`PI_OFFLINE=1`、dedicated database-name guard 與 final security review。
- [x] OIDC 與 model mocks 驗證 protocol-relevant input，而不只回傳固定成功 response，證據為 PKCE negative case、nonce/issuer/audience owner login、authorization/model/message capture、held SSE 與 one-shot failure recovery。
- [x] Mobile keyboard flow 與 serious/critical accessibility scan已通過，證據為 390×844 Playwright project、explicit keyboard activation、overflow assertion 與 axe scans。
- [x] Failure artifacts 可重現問題，證據為 Playwright `retain-on-failure` trace/video、failure screenshot、HTML report 及 CI `upload-artifact` configuration。
- [x] `npm run ci`、兩種 E2E、兩種 Docker smoke checks 全部通過，且 README 與 `just --list` 提供已實際驗證的本機命令。
