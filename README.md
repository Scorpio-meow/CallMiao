# 數位叫號嵌入式網頁模組

可嵌入既有網站或資訊站的取號 Widget、櫃員端（Agent）、大廳顯示（Lobby），搭配 REST API、WebSocket 即時通知、SQLite 輕量資料庫與 QR Code 取號/查詢。

內容包含：

- 客戶端（Kiosk / Widget）：取號與票券 QR
- 櫃員端（Agent）：登入、叫號、重叫、轉服務、完成、取消
- 大廳顯示（Lobby）：即時叫號顯示與事件播報
- 後端：Express REST API、Socket.IO、SQLite、Captcha（圖形驗證碼）與管理 API


## 快速開始（Windows PowerShell）

**重要**：首次啟動前請先完成安全配置！

### 🔒 安全配置（必須）

1) **設定環境變數**

```powershell
# 複製環境變數範本
Copy-Item .env.example.new .env

# 編輯 .env 檔案，設定您的配置
notepad .env
```

2) **執行安全檢查**

```powershell
npm run security-check
```

3) **建立管理員帳號**

```powershell
npm run create-admin
```

### 🚀 啟動系統

1) 安裝相依套件

```powershell
npm install
```

2) 建立 .env 並啟動（開發）

可參考 `.env.example` 建立 `.env` 檔：

```
PORT=3000
ALLOWED_ORIGINS=https://your-tunnel-id.devtunnels.ms/
NODE_ENV=development
```

然後啟動：

```powershell
npm run dev
```

3) 開啟以下頁面

- Kiosk：https://your-tunnel-id.devtunnels.ms/kiosk/index.html
- Agent：https://your-tunnel-id.devtunnels.ms/agent/index.html
- Lobby：https://your-tunnel-id.devtunnels.ms/lobby/index.html
- 管理頁：https://your-tunnel-id.devtunnels.ms/admin/agents.html

## 需求與相容性

- Node.js 16 以上（建議 18+）
- Windows / macOS / Linux 皆可
- 內建 SQLite（第一次啟動會建立 `db/queue.db`）


## 設定（.env／環境變數）

- PORT（選填，預設 3000）：HTTP 服務埠
- ALLOWED_ORIGINS（選填）：允許的前端網域清單，逗號分隔，例如：
  - `https://your-tunnel-id.devtunnels.ms/,http://127.0.0.1:3000`
- PUBLIC_ORIGIN（選填）：對外公開的網址（用於 QR 與公開連結）
- NODE_ENV（選填）：`production` 時請搭配更嚴格的 CORS/CSP 設定

（舊版以 AGENT_PIN 控制管理端已廢除，改採登入與角色權限。）


## 專案結構

- `server.js`：主伺服器（Express + Socket.IO）與所有 API 路由
- `public/`：前端靜態頁面
  - `login/`：登入頁（Captcha）
  - `agent/`：櫃員端操作頁
  - `kiosk/`：取號小工具（可用 iframe 嵌入）
  - `lobby/`：大廳顯示頁
  - `ticket/`：票券查詢頁
- `db/queue.db`：SQLite 資料檔


## 管理與帳號（CSRF 流程）

管理 UI（`/admin/agents.html`）與管理 API 需要管理員權限，系統會檢查登入狀態和角色：

1) 先呼叫 POST `/api/admin/csrf` 取得 `{ csrfToken }`
2) 後續在瀏覽器來源（Origin 在 ALLOWED_ORIGINS 內）呼叫 `/api/agents` 的 POST/PUT/DELETE 時，加上 Header `x-csrf-token: <csrfToken>`

### 櫃台號管理重要說明

**櫃台號只能透過管理端設定，櫃員端無法自行修改**：

- 管理員在 `/admin/agents.html` 建立或編輯櫃員帳號時設定櫃台號
- 櫃員登入後，系統自動從帳號資料中載入櫃台號
- 櫃員端的櫃台號欄位為唯讀，不可手動更改
- 如需變更櫃台號，須聯絡管理員透過管理介面修改

備註：CSRF 僅對帶有瀏覽器 `Origin` 且落在 ALLOWED_ORIGINS 的請求強制檢查；CLI（如 curl/PowerShell）預設無 Origin，CSRF 不會被觸發。


## API 摘要

公共 API：

- GET `/api/health`：健康檢查
- POST `/api/tickets`：建立號碼（Body：`{ serviceType:'A' }`）
- GET `/api/tickets/waiting?serviceType=A`：取得等待清單
- GET `/api/ticket/:id`：查詢單筆票券
- GET `/api/overview`：回傳 summary + currentCalls
- GET `/api/qrcode?text=...`：回傳 PNG QR 圖檔

Captcha / Login：

- GET `/api/captcha/new`：產生 `{ token, expiresAt }`
- GET `/api/captcha/image/:token`：回傳對應 token 的驗證碼圖片（預設 PNG；若 `sharp` 不可用則回傳 SVG）
- POST `/api/login`：驗證 Captcha 與帳密（與 `agents` 表連動；回傳 `{ ok:true, agent }`）

Agent API（需要有效的櫃員登入認證）：

- POST `/api/agent/callNext`：叫下一位（Body：`{ serviceType, counter }`）
- POST `/api/agent/callSpecific`：指定叫號（Body：`{ ticketId, counter, internal? }`）
- POST `/api/agent/markServing`：標記開始服務（Body：`{ ticketId }`）
- POST `/api/agent/finish`：完成（Body：`{ ticketId, result? }`）
- POST `/api/agent/recall`：重叫（Body：`{ ticketId }`）
- POST `/api/agent/cancel`：取消（Body：`{ ticketId, reason? }`）
- POST `/api/agent/transfer`：轉櫃/轉服務（Body：`{ ticketId, toServiceType?, toCounter?, keepStatus? }`）
- POST `/api/agent/createTicket`：櫃台代客取號（Body：`{ serviceType }`）
- GET `/api/agent/history?serviceType=A&limit=50`：歷史紀錄
- GET `/api/agent/ticket/:id`：取票券詳情

管理 agents（需管理員權限，且瀏覽器來源需 `x-csrf-token`）：

- GET `/api/agents`、GET `/api/agents/:id`
- POST `/api/agents`、PUT `/api/agents/:id`、DELETE `/api/agents/:id`


## WebSocket 事件

- `queue:update`：等候與現況摘要更新（payload：`{ serviceType, overview }`）
- `call:made`：叫號事件（payload：`{ ticket }`）
- `agent:message`：Agent 廣播訊息


## 資料模型（SQLite）

- `seq(serviceType, ymd, seq)`：各服務別每日流水號
- `tickets(id, serviceType, number, status, counter, result, createdAt, calledAt, finishedAt)`
- `agents(id, account, name, password[bcrypt], counter, role, active, createdAt, updatedAt)`

### （可選）移除歷史未使用欄位
若早期版本曾建立 `tickets` 表包含 `phone` 欄位，現行程式已不再使用。需要精簡資料庫可在維護時段：

```sql
-- 建立新表（不含 phone）
CREATE TABLE tickets_new AS
SELECT id, serviceType, number, status, counter, result, createdAt, calledAt, finishedAt
FROM tickets;

-- 替換
DROP TABLE tickets;
ALTER TABLE tickets_new RENAME TO tickets;

-- 視需要重建索引 / 觸發器
```

若已有備援或僅需邏輯移除，可保留原欄位，無須強制執行離線遷移。


## 常用操作（PowerShell 範例）

- 取號（公共 API）：
```powershell
Invoke-RestMethod -Method Post -Uri https://your-tunnel-id.devtunnels.ms//api/tickets -ContentType 'application/json' -Body (@{ serviceType='A' } | ConvertTo-Json)
```

- 查看等候清單：
```powershell
Invoke-RestMethod -Method Get -Uri https://your-tunnel-id.devtunnels.ms//api/tickets/waiting?serviceType=A
```


## 疑難排解（Troubleshooting）

- 連線被拒（EADDRINUSE: address already in use 3000）：
  - 變更埠：`$env:PORT='3001'; npm run dev`
  - 或關閉佔用 3000 埠的程式

- SQLite database is locked / SQLITE_BUSY：
  - 可能同時有其它程式開啟 `db/queue.db`（另一個 node 程式或資料庫檢視器）
  - 請關閉相關程式；必要時重新開機或刪除暫存 `queue.db-wal`/`queue.db-shm`（務必停機/備份）

- CORS 錯誤（CORS origin denied）：
  - 設定 `ALLOWED_ORIGINS`，例如：`$env:ALLOWED_ORIGINS='https://your-tunnel-id.devtunnels.ms/,http://127.0.0.1:3000'`

- Captcha 圖片顯示錯誤或 `sharp` 安裝失敗：
  - `sharp` 為可選；若無法安裝，服務會自動改以 SVG 回傳圖片，功能仍可使用

- 呼叫管理 API 回傳 `missing csrf token`：
  - 請先呼叫 `/api/admin/csrf` 取得 token，並於瀏覽器來源請求加上 `x-csrf-token`


## 安全與生產建議

### 🔒 安全性更新（2025-10-01）

本系統已進行全面的安全強化，包含：
- ✅ 環境變數保護與自動驗證
- ✅ 生產環境 CORS 嚴格檢查
- ✅ 錯誤處理改善，避免資訊洩漏
- ✅ 前端輸入驗證工具
- ✅ 自動安全檢查腳本

**詳細資訊**：
- **安全更新說明**：[SECURITY-UPDATE.md](./SECURITY-UPDATE.md)
- **部署檢查清單**：[SECURITY-DEPLOYMENT.md](./SECURITY-DEPLOYMENT.md)
- **安全開發守則**：[Security-Guidelines_Traditional-Chinese.md](./Security-Guidelines_Traditional-Chinese.md)

### 📝 部署前檢查清單

- [ ] 已設定 `.env` 並填入正確的生產環境配置
- [ ] 已執行 `npm run security-check` 無錯誤
- [ ] `NODE_ENV` 設為 `production`
- [ ] `ALLOWED_ORIGINS` 設定為實際網域（移除 localhost）
- [ ] `PUBLIC_ORIGIN` 設定為公開網址
- [ ] 已建立管理員帳號並更改預設密碼
- [ ] 已設定 HTTPS（透過 Nginx/Apache）
- [ ] 已配置防火牆規則
- [ ] 已設定自動備份機制

### 🛡️ 生產環境建議

- **反向代理**：使用 Nginx 或 Apache 配置 SSL/TLS
- **監控與日誌**：整合 PM2 或專業日誌服務
- **備份策略**：每日自動備份資料庫，異地儲存

更多安全指引：
- **最新安全更新**：[SECURITY-UPDATE.md](./SECURITY-UPDATE.md)
- **部署安全檢查清單**：[SECURITY-DEPLOYMENT.md](./SECURITY-DEPLOYMENT.md)
- **安全開發守則**：[Security-Guidelines_Traditional-Chinese.md](./Security-Guidelines_Traditional-Chinese.md)
- **詳細說明文件**：[Security-Guidelines-Explanation_Traditional-Chinese.md](./Security-Guidelines-Explanation_Traditional-Chinese.md)


## 套件腳本

- `npm run dev`：以 nodemon 啟動（開發）
- `npm start`：以 node 啟動（生產）