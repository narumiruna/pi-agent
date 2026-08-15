# Roadmap

## 目標

本 Roadmap 將 Web 左側導覽拆成更清楚的工作區與 Pi 資源入口。

本 Roadmap 也讓 production container 具備 Python、Rust 與 Go 的開發工具鏈。

所有功能必須沿用 Pi 原生 session、prompt、skill、extension、package、settings 與 resource loader 行為。

## 強制交付流程

Roadmap 中的每一個 milestone checkbox 都必須獨立完成以下流程。

1. 實作前建立一份專屬 plan，存放於 `docs/plans/YYYY-MM-DD_<topic>-plan.md`。
2. Plan 必須連結對應的 Roadmap milestone，並列出可驗證的完成條件、測試與風險。
3. 一份 plan 只能實作一個 Roadmap milestone，不得將多份 plan 合併到同一個 implementation branch 或 pull request。
4. 開始實作時，必須從最新且適當的 base branch 建立新的 focused branch，不得重用其他 plan 的 branch。
5. 每份 plan 必須開啟一個專屬 pull request，PR description 必須連結該 plan 與對應的 Roadmap milestone。
6. PR 必須執行 plan 與 repository 要求的 focused tests、`npm run ci`、E2E 或 Docker checks，且不得隱藏失敗或未驗證項目。
7. 必須逐項閱讀、分類並處理所有 PR review comments、submitted reviews 與 conversation threads。
8. 所有有效 feedback 都必須修正並加入必要的 regression coverage，非 actionable feedback 必須留下有證據的回覆。
9. PR threads 只能在修正完成且驗證通過後回覆或 resolve。
10. 只有在所有 required checks 通過、所有 feedback 都有明確結論且專屬 PR 合併後，才能勾選 Roadmap milestone 並封存 plan。

## 目標資訊架構

左側主要導覽預計依序提供以下入口。

1. `Chats`
2. `Files`
3. `Prompts`
4. `Skills`
5. `Extensions`
6. `Heartbeat`
7. `Settings`

`Chats` 會取代目前的「對話」入口，但仍使用既有 native Pi conversation API。

`Prompts`、`Skills` 與 `Extensions` 會逐步承接目前「資源庫」中的功能。

「資源庫」會在功能遷移期間保留，確認沒有功能遺失後才移除。

目前資源庫中的 MCP 設定預計移到 `Settings > Integrations`。

Pi package 仍是 prompt、skill 與 extension 的共同安裝來源，不建立第二套 package model。

## Phase 0：共用基礎與安全邊界

- [x] 定義 `Chats`、`Files`、`Prompts`、`Skills`、`Extensions`、`Heartbeat` 與 `Settings` 的 route contract。
- [x] 讓 desktop sidebar 與 mobile navigation 共用相同的導覽資料與權限判斷。
- [x] 所有 API 只回傳 Web 所需的 opaque ID、相對路徑與安全 metadata。
- [x] 所有 workspace 路徑都必須經過 `resolve`、`realpath`、containment 與 symlink escape 檢查。
- [x] 所有 Pi 資源都必須保留 `user`、`project`、`package` 與 `temporary` provenance。
- [x] Project-local skill 與 extension 只有在 Pi project trust 生效後才能載入或修改。
- [ ] Package、skill、extension 與 MCP 必須持續顯示 trusted-code 警告。
- [ ] 資源變更後使用 Pi 原生 reload flow，不直接修改 runtime 內部集合。

### Phase 0 驗收條件

- [ ] Keyboard、screen reader、visible focus、mobile drawer 與 reduced motion 都能操作所有新入口。
- [ ] 未授權路徑、symlink escape、oversized body、stale write 與 active-run conflict 都有 server tests。
- [ ] Navigation reload 後會回到有效頁面，失效 route 會安全返回 `Chats`。

## Phase 1：Chats

- [ ] 將目前「對話」重新命名為 `Chats`，並保留現有 conversation list 與 new-chat 操作。
- [ ] 沿用 `SessionManager` 與目前的 opaque conversation ID，不複製 JSONL session state。
- [ ] 加入 conversation 搜尋、named-only filter 與排序。
- [ ] 提供 rename、delete、fork、clone、tree、compact、import 與 export 的一致入口。
- [ ] 保留執行中 conversation isolation、queue restore 與 reconnect recovery。

### Phase 1 驗收條件

- [ ] 新舊 session、未持久化 session 與 forked session 都能正確切換。
- [ ] Search、rename、delete 與 fork 在 desktop 和 mobile 都有 E2E coverage。
- [ ] 原始 Pi JSONL 在 list、search、export 與 fork 操作後保持有效。

## Phase 2：Files

`Files` 只管理設定的 `WORKSPACE`，預設 container 路徑為 `/workspace`。

- [x] 提供 lazy directory tree、檔案搜尋與 breadcrumb navigation。
- [x] 提供文字檔預覽、建立、編輯、重新命名、下載與刪除。
- [x] 使用 atomic write，並以 revision 或 mtime 防止 stale browser 覆寫較新的檔案。
- [x] 對單檔讀取、目錄項目數、搜尋結果、檔案大小與請求時間設定上限。
- [x] Binary、超大檔案與不支援的 encoding 只提供 metadata 或下載，不載入 editor。
- [x] 預設隱藏 `.git`、dependency output、credential-like files 與 private Pi directories。
- [x] 不讓 browser 傳入 server absolute path，也不提供 unrestricted shell endpoint。
- [x] File picker 與 chat 的 `@file` autocomplete 共用同一個 workspace containment service。

### Phase 2 驗收條件

- [x] Traversal、symlink、case-sensitive path、Unicode path、binary file 與 concurrent write 都有 Vitest coverage。
- [x] 390px viewport 可以瀏覽、預覽與編輯檔案，且不產生水平頁面溢位。
- [x] Files API 永遠不回傳 host absolute path、credential content 或 agent authentication path。

## Phase 3：Prompts

- [ ] 將 `SYSTEM.md` 與 `APPEND_SYSTEM.md` editor 移到 `Prompts`。
- [ ] 將目前 `prompts/` template list、create、edit 與 delete 移到 `Prompts`。
- [ ] 顯示 prompt 的 scope、source、path、package provenance 與是否可編輯。
- [ ] Package 或 temporary prompt 預設為唯讀，避免直接修改 managed installation。
- [ ] User 與 trusted project prompt 使用 Pi 認可的位置與原生 resource discovery。
- [ ] 儲存後執行 native reload，並更新 `/command` autocomplete。
- [ ] 對 prompt name、frontmatter、內容大小與命名衝突顯示 validation diagnostics。

### Phase 3 驗收條件

- [ ] Prompt CRUD、reload、command invocation 與 collision diagnostics 有 server、Web 與 E2E coverage。
- [ ] Existing `SYSTEM.md`、`APPEND_SYSTEM.md` 與 prompt template 不需資料轉換。

## Phase 4：Skills

- [ ] 使用 Pi resource loader 列出 discovered skills，不另行掃描一套平行 catalog。
- [ ] 顯示 skill name、description、scope、source、package provenance、validation warning 與實際入口檔。
- [ ] 支援檢視 `SKILL.md`、references、scripts 與 assets，但 binary assets 只顯示 metadata。
- [ ] 支援建立 user skill，並產生符合 Agent Skills standard 的 `SKILL.md` 骨架。
- [ ] 支援編輯與刪除 user skill，以及 trusted project skill。
- [ ] Package-managed skill 維持唯讀，更新與移除必須走 Pi package manager。
- [ ] 支援 `/skill:name` 啟用狀態與 `enableSkillCommands` 設定。
- [ ] 顯示 missing description、invalid name、duplicate name 與 compatibility diagnostics。
- [ ] 明確警告 skill 可以指示模型執行程式，也可以包含 executable helper scripts。

### Phase 4 驗收條件

- [ ] Global、trusted project、package 與 settings-added skill 都會顯示正確 provenance。
- [ ] 新增或修改 skill 後，native reload 會更新 system prompt 與 `/skill:name` command。
- [ ] Untrusted project skill 不會被 Web 啟用或修改。

## Phase 5：Extensions

- [ ] 使用 Pi resource loader 與 extension diagnostics 顯示所有 loaded extensions。
- [ ] 顯示 scope、source、package provenance、loaded path、commands、tools 與 diagnostics。
- [ ] 支援建立與編輯 user extension 的 `.ts` 或 directory `index.ts`。
- [ ] Trusted project extension 可管理，但必須再次顯示 executable-code 警告。
- [ ] Package-managed extension 維持唯讀，install、update、filter 與 remove 必須走 Pi package manager。
- [ ] 使用 native settings 與 package filters 啟用或停用 extension resources。
- [ ] 儲存或切換 extension 後使用 Pi native reload lifecycle。
- [ ] Reload 必須等待 active run 結束，並顯示 `session_shutdown`、`session_start` 與 diagnostics 結果。
- [ ] Web 只支援已定義的 RPC-safe extension UI，不執行 terminal component factory 或任意 browser code。
- [ ] Extension source editor 不提供自動執行按鈕，避免把 typo 直接變成 production code execution。

### Phase 5 驗收條件

- [ ] Extension reload、syntax failure、runtime failure、duplicate command 與 tool provenance 有測試。
- [ ] Extension install、update、filter、disable 與 remove 後，Pi settings 仍是唯一真實來源。
- [ ] 所有 executable-code 操作都有明確確認，而且錯誤不會破壞目前可用 session。

## Phase 6：移除舊資源庫入口

- [ ] 確認 system prompts、templates、packages 與 MCP 都已遷移到明確的新入口。
- [ ] 將舊 `LibraryPage` route 轉向對應的新頁面。
- [ ] 移除重複 UI，但保留既有 native files、settings 與 API 相容期。
- [ ] 更新 README、screenshots、mobile navigation 與 accessibility tests。

## Phase 7：Docker 開發工具鏈

Production image 必須繼續以非 root UID `10001` 執行。

工具鏈版本必須以 Docker build arguments 或明確 image tags 固定，避免每次 build 得到不同版本。

### Python 與 uv

- [ ] 從官方 `ghcr.io/astral-sh/uv` image 複製固定版本的 `uv` 與 `uvx`，不使用未驗證的 curl pipe。
- [ ] 使用 `uv python install` 預裝固定 Python 版本。
- [ ] 將 managed Python、uv tools 與 cache 放在 `/app/toolchains`、`/app/home` 或其他 UID `10001` 可寫位置。
- [ ] 設定 `UV_PYTHON_INSTALL_DIR`、`UV_TOOL_DIR`、`UV_CACHE_DIR` 與 `PATH`。
- [ ] 驗證 `uv run python --version`、virtual environment、dependency sync 與 native wheel build。

### Rust 與 Cargo

- [ ] 使用固定 Rust toolchain 安裝 `rustc` 與 `cargo`。
- [ ] 使用官方 Rust image stage 或經 checksum 驗證的 rustup artifact，不使用浮動 shell installer。
- [ ] 設定可由 UID `10001` 寫入的 `RUSTUP_HOME`、`CARGO_HOME` 與 target cache。
- [ ] 安裝 native linker 所需的最小 `build-essential` 與 `pkg-config`。
- [ ] 驗證 `cargo new`、`cargo check`、`cargo test` 與 release build。

### Go

- [ ] 從固定版本的官方 `golang` image stage 複製 `/usr/local/go`。
- [ ] 設定 `GOCACHE`、`GOMODCACHE`、`GOPATH` 與 `PATH` 到 UID `10001` 可寫位置。
- [ ] 驗證 `go env`、`go mod init`、`go test ./...` 與 `go build`。

### 共用 runtime 要求

- [ ] 支援 Docker BuildKit 的 `TARGETARCH`，並在 amd64 與 arm64 驗證官方 artifact。
- [ ] 保留 Node.js 24、git、SSH、ripgrep、bash 與 CA certificates。
- [ ] 將 language caches 放在獨立可寫目錄，避免污染 `/workspace` 或 image read-only layers。
- [ ] 為 Python、Rust 與 Go dependency cache 提供可選 named volumes，而不是強制持久化。
- [ ] 設定合理的 image-size budget，並記錄每個 toolchain 增加的 compressed size。
- [ ] 執行 production image vulnerability scan，並記錄無法立即修復的 base-image CVE。
- [ ] Docker build 中加入版本 smoke checks，runtime E2E 再以 UID `10001` 編譯三個最小專案。

### Pi 工具權限

Docker image 內有 compiler 不代表 Pi 自動有權執行 compiler。

- [ ] 文件必須說明只有啟用 `bash` tool 時，Pi 才能執行 `uv`、`python`、`cargo`、`rustc` 與 `go`。
- [ ] `bash` 保持明確 opt-in，除非另一次 security review 決定修改 `AGENT_TOOLS` 預設值。
- [ ] `.env.example` 與 Compose 範例提供 code-execution profile，例如 `AGENT_TOOLS=read,grep,find,ls,write,edit,bash`。
- [ ] UI 必須清楚顯示目前 active tools，避免使用者誤以為 compiler 不可用或已被允許。

### Phase 7 驗收條件

- [ ] `docker build -t pi-agent:local .` 在 amd64 與 arm64 成功。
- [ ] Container 內 `node --version`、`uv --version`、`uv run python --version`、`rustc --version`、`cargo --version` 與 `go version` 全部成功。
- [ ] 非 root 使用者可以在 `/workspace` 建立並測試 Node.js、Python、Rust 與 Go 專案。
- [ ] 不啟用 `bash` 時，Pi 仍維持目前較小的 execution trust boundary。
- [ ] 啟用 `bash` 時，Pi 可以執行各語言的 formatter、test、build 與 package manager。

## 建議交付順序

1. 完成 navigation shell 與 `Chats` rename。
2. 完成 `Files`，先建立共用安全 workspace API。
3. 完成 `Prompts`，並驗證 native reload。
4. 完成唯讀 `Skills` 與 `Extensions` inventory。
5. 加入受信任來源的 Skills 與 Extensions 管理操作。
6. 遷移 MCP 與 package UI 後移除舊資源庫入口。
7. 最後加入並量測 Docker toolchains，避免 UI 工作被大型 image build 迴圈拖慢。

## 完成定義

- [ ] 所有新功能都有 matching server 與 Web Vitest coverage。
- [ ] Navigation、Files、Chats、Prompts、Skills 與 Extensions 都有 desktop 與 390px mobile E2E coverage。
- [ ] SQLite 與 PostgreSQL browser suites 都通過。
- [ ] `npm run ci` 與 production Docker build 都通過。
- [ ] README、`.env.example`、Compose、security boundary 與 backup guidance 已同步更新。
- [ ] 實作沒有建立平行的 Pi resource、session、package 或 settings state。
