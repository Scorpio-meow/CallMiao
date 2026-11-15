# 更新紀錄

本專案的所有重要變更都記錄在這裡。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循[語意化版本](https://semver.org/lang/zh-TW/)。

## [未發佈]

### 變更

- 文件重新整理：README 改為精簡的入門說明，詳細內容拆到 `docs/` 下的設定、API、架構與部署指南；`SECURITY-UPDATE.md` 改為 `SECURITY.md`，更新紀錄移到本檔案。
- 修正文件與實際行為不符之處：Node.js 需求改為 22 以上、建立管理員改用 Bun 指令、大廳看板功能描述、`POST /api/agents` 的欄位與 `/api/logout` 的認證需求。

## [2.0.0] - 2026-11-15

這個版本整合了一次全面的安全稽核與修補，並將專案更名為**叫號喵（CallMiao）**。升級前請先閱讀破壞性變更並更新 `.env`。

### 破壞性變更

**環境變數**：以下變數缺少時伺服器會拒絕啟動。

| 變數 | 適用 |
|------|------|
| `SESSION_SECRET`、`TZ`、`DB_DIR` | 所有環境 |
| `SERVICE_TYPES`、`SERVICE_NAME_<代碼>`、`SERVICE_DESC_<代碼>` | 所有環境 |
| `MAX_WAITING_PER_SERVICE`、`MAX_WAITING_PER_CLIENT`、`KIOSK_IPS`（可留空） | 所有環境 |
| `PUBLIC_ORIGIN`、`ALLOWED_ORIGINS`、`TRUST_PROXY` | 正式環境 |

原本放在 `./db` 的資料，請設定 `DB_DIR=db`。

**API**

- `GET /api/qrcode?text=` 改為 `GET /api/qrcode/:ticketId`，只為既有票券產生 QR Code。
- 移除 `GET /api/tickets/waiting`；等候順序改由 `/api/overview` 與 `queue:update` 的 `waiting` 欄位提供。
- `/api/config` 只回傳 `services`。
- `callNext` 與 `callSpecific` 不再接受 `counter` 參數，櫃台號一律取自登入帳號；未指派櫃台的帳號無法叫號。
- `/api/csrf` 需要登入。
- 已叫號或服務中的票只能由所屬櫃台或管理員操作，其他櫃員回 `403`。
- `transfer` 的 `toCounter` 只能搭配 `keepStatus: true`，且必須是啟用帳號被指派的櫃台號。
- 無效的服務代碼回 `400`；不合法的票券狀態轉換與私訊對象重名回 `409`。
- 被拒絕的跨站請求回 `403`（原本為 `500`）。

**行為**

- 升級後所有既有 Session 失效，櫃員需要重新登入。
- 部署當天第一次讀寫佇列時，前一天以前未結束的票會被改為 `canceled`（`result` 為 `expired`）。
- 本機其他連接埠的前端（例如 `http://localhost:5173`）須列入 `ALLOWED_ORIGINS`。

### 新增

- 每個來源網路的等候票上限 `MAX_WAITING_PER_CLIENT`（IPv6 以 `/56` 計算），以及不受此限的 `KIOSK_IPS`。
- 每個服務別的等候票上限 `MAX_WAITING_PER_SERVICE`。
- 服務別名稱與說明改由 `.env` 設定，取號機、櫃員工作台與轉櫃選項都依此產生。
- 取號頁可被 `ALLOWED_ORIGINS` 內的網站以 iframe 嵌入；`widget.js` 會從自己所在的網域載入取號頁。
- 推播 `queue:update` 帶上各服務的等候順序，票券頁與櫃員工作台不必每次推播都查詢 API。
- 管理後台的帳號編輯改為預填對話框，只送出有變更的欄位，並加入搜尋與狀態標籤。
- 整合測試（`bun test`）。
- `tickets` 資料表新增索引。
- `DB_DIR` 可自訂資料庫位置。

### 變更

- 專案更名為叫號喵（CallMiao）。
- 在 Bun 底下改用內建的 `bun:sqlite` 與自訂的 Session Store；`better-sqlite3` 改為選用相依，`bun install` 不再因為它而失敗。
- CSRF 防護改為綁定 Session 的 Token，移除 `csurf` 與 `cookie-parser`。
- 驗證碼一律以 PNG 輸出；bcrypt 改用非同步版本。
- 「一天」以 `TZ` 的午夜為準，票號每日重新編號與跨日作廢都不再跟著伺服器主機的時區。
- 修改自己的密碼必須輸入目前的密碼。
- 顯示名稱不可與其他帳號的姓名或帳號重複。
- 前端頁面的行內腳本全部移到外部檔案，CSP 改為 `script-src 'self'`。

### 修正

- 櫃員工作台選取的票不再被推播換成自己櫃台的票；取消與結束的確認視窗會顯示號碼，按取消即放棄動作。
- 前一天未結束的已叫號與服務中票券，會與等候票一起自動作廢。
- 伺服器自己的網址自動放行，不必列入 `ALLOWED_ORIGINS`。
- 登入時不再刪除密碼前後的空白。
- `history` 的 `limit` 只接受正整數並限制在 1–500，負數不再代表不限筆數。
- 已完成或已取消的票不能再被叫號、服務、結束、取消或轉櫃。
- 櫃員登出時改用新的 CSRF Token，並確認登出成功。

### 移除

- 未使用的前端工具 `auth-checker.js`、`input-validator.js`、`url-manager.js`，以及相依套件 `connect-sqlite3`、`dayjs`。
- 指向已刪除腳本的 npm scripts。

### 安全性

- `/api/agents` 的讀取補上管理員驗證；管理員權限每次請求都重新查資料庫，降級或停用立即生效。
- `/api/agent/ticket/:id` 補上登入驗證；公開 API 與 `call:made` 不再帶出備註與來源資訊。
- 登入時確認帳號啟用、驗證碼只能使用一次，並重新產生 Session ID 防止 Session 固定攻擊。
- 驗證碼改用 `Map` 儲存並要求字串 Token，無法再用物件原型的屬性名稱繞過。
- 新增 `sessionVersion`：改密碼、重設密碼或停用帳號會撤銷該帳號的所有 Session。
- 櫃員訊息投遞前重新驗證收件人的 Session，只送給已登入的櫃員，寄件人由伺服器填入。
- Socket.IO 共用 Session，並在握手時檢查 `Origin`。
- 大廳看板、櫃員歷史與取號機改用 `textContent`，修補儲存型 XSS。
- 登入後的跳轉只允許同源路徑。
- 只有 `/kiosk/` 可被 `ALLOWED_ORIGINS` 嵌入，其他頁面維持同源限制。
- 停止追蹤誤 commit 的資料庫與 Cookie 檔案，`.gitignore` 補上 `.env.*`、`*.db*`、`*.sqlite*`、`*.log`。

## [1.2.0] - 2025-11-27

### 新增

- CSRF Token 驗證，保護所有管理與狀態變更的 API。
- 依端點分級的速率限制。
- `url-manager.js` 網址白名單與協定檢查，防止未授權的跳轉。

### 變更

- 前端畫面改用安全的 DOM API 與 `textContent` 建立，移除 `innerHTML` 拼接。

### 安全性

- 以 `overrides` 將間接相依的 `cookie` 固定在 `0.7.0`，修補解析漏洞。

## [1.1.0] - 2025-10-01

### 新增

- CORS 來源檢查，開發環境自動支援 localhost 與 DevTunnel，並記錄被拒絕的請求。
- 正式環境啟動時檢查必要設定，防止未設定金鑰就上線。
- 前端輸入驗證工具 `input-validator.js`。

### 變更

- 統一伺服器錯誤格式，正式環境不回傳堆疊資訊。

### 安全性

- `.gitignore` 排除 `.env` 與資料庫檔案。

## [1.0.0] - 2025-08-15

### 新增

- 排隊取號、叫號、重叫、過號與完成服務的完整流程。
- Socket.IO 即時同步大廳看板。
- SQLite 資料庫與自動初始化。
- 圖形驗證碼與 QR Code。
