# 數位叫號嵌入式網頁模組

可嵌入既有網站或資訊站的取號 Widget、櫃員端（Agent）、大廳顯示（Lobby），搭配 REST API、WebSocket 即時通知、SQLite 輕量資料庫與 QR Code 取號/查詢。

內容包含：

- 客戶端（Kiosk / Widget）：取號與票券 QR
- 櫃員端（Agent）：登入、叫號、重叫、轉服務、完成、取消
- 大廳顯示（Lobby）：即時叫號顯示與事件播報
- 後端：Express REST API、Socket.IO、SQLite、Captcha（圖形驗證碼）與管理 API


## 快速開始（Windows PowerShell）

1) 安裝相依套件

```powershell
npm install
```

2) 設定環境變數並啟動（開發）

```powershell
$env:AGENT_PIN='0000'; npm run dev
```

3) 開啟以下頁面

- Kiosk：http://localhost:3000/kiosk/index.html
- Agent：http://localhost:3000/agent/index.html
- Lobby：http://localhost:3000/lobby/index.html
- 管理頁：http://localhost:3000/admin/agents.html

提示：若你看到「嚴重錯誤：需要 AGENT_PIN 環境變數。」請依上方指令設定後重啟。


## 需求與相容性

- Node.js 16 以上（建議 18+）
- Windows / macOS / Linux 皆可
- 內建 SQLite（第一次啟動會建立 `db/queue.db`）


## 設定（環境變數）

- AGENT_PIN（必填）：後台/管理 API 所需的 PIN；伺服器啟動時會強制檢查
- PORT（選填，預設 3000）：HTTP 服務埠
- ALLOWED_ORIGINS（選填）：允許的前端網域清單，逗號分隔，例如：
  - `http://localhost:3000,http://127.0.0.1:3000`
- NODE_ENV（選填）：`production` 時請搭配更嚴格的 CORS/CSP 設定

在 Windows 永久設定環境變數：

```powershell
setx AGENT_PIN "0000"
# 關閉並重開 PowerShell 視窗後生效
```


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

管理 UI（`/admin/agents.html`）與管理 API 需要：

1) 於 Header 帶入 `x-agent-pin: <AGENT_PIN>`
2) 先呼叫 POST `/api/admin/csrf` 取得 `{ csrfToken }`
3) 後續在瀏覽器來源（Origin 在 ALLOWED_ORIGINS 內）呼叫 `/api/agents` 的 POST/PUT/DELETE 時，加上 Header `x-csrf-token: <csrfToken>`

PowerShell 範例（建立帳號）：

```powershell
$csrf = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/admin/csrf -Headers @{ 'x-agent-pin' = '0000' }
$body = @{ account='alice'; name='Alice'; password='pass123'; counter='1' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agents -ContentType 'application/json' -Body $body -Headers @{ 'x-agent-pin' = '0000'; 'x-csrf-token' = $csrf.csrfToken }
```

備註：CSRF 僅對帶有瀏覽器 `Origin` 且落在 ALLOWED_ORIGINS 的請求強制檢查；CLI（如 curl/Invoke-RestMethod）預設無 Origin，CSRF 不會被觸發。


## API 摘要

公共 API：

- GET `/api/health`：健康檢查
- POST `/api/tickets`：建立號碼（Body：`{ serviceType:'A', phone:'09...' }`，phone 必填）
- GET `/api/tickets/waiting?serviceType=A`：取得等待清單
- GET `/api/ticket/:id`：查詢單筆票券（隱去 phone）
- GET `/api/overview`：回傳 summary + currentCalls
- GET `/api/qrcode?text=...`：回傳 PNG QR 圖檔

Captcha / Login：

- GET `/api/captcha/new`：產生 `{ token, expiresAt }`
- GET `/api/captcha/image/:token`：回傳對應 token 的驗證碼圖片（預設 PNG；若 `sharp` 不可用則回傳 SVG）
- POST `/api/login`：驗證 Captcha 與帳密（與 `agents` 表連動；回傳 `{ ok:true, agent }`）

Agent / 管理 API（Header 需帶 `x-agent-pin`）：

- POST `/api/agent/callNext`：叫下一位（Body：`{ serviceType, counter }`）
- POST `/api/agent/callSpecific`：指定叫號（Body：`{ ticketId, counter, internal? }`）
- POST `/api/agent/markServing`：標記開始服務（Body：`{ ticketId }`）
- POST `/api/agent/finish`：完成（Body：`{ ticketId, result?, verify4? }`，可驗證電話末 4 碼）
- POST `/api/agent/recall`：重叫（Body：`{ ticketId }`）
- POST `/api/agent/cancel`：取消（Body：`{ ticketId, reason? }`）
- POST `/api/agent/transfer`：轉櫃/轉服務（Body：`{ ticketId, toServiceType?, toCounter?, keepStatus? }`）
- POST `/api/agent/createTicket`：櫃台代客取號（Body：`{ serviceType, phone }`）
- GET `/api/agent/history?serviceType=A&limit=50`：歷史紀錄
- GET `/api/agent/ticket/:id`：取票券詳情（含 phone）

管理 agents（需 `x-agent-pin`，且瀏覽器來源需 `x-csrf-token`）：

- GET `/api/agents`、GET `/api/agents/:id`
- POST `/api/agents`、PUT `/api/agents/:id`、DELETE `/api/agents/:id`


## WebSocket 事件

- `queue:update`：等候與現況摘要更新（payload：`{ serviceType, overview }`）
- `call:made`：叫號事件（payload：`{ ticket }`）
- `agent:message`：Agent 廣播訊息


## 資料模型（SQLite）

- `seq(serviceType, ymd, seq)`：各服務別每日流水號
- `tickets(id, serviceType, number, phone, status, counter, result, createdAt, calledAt, finishedAt)`
- `agents(id, account, name, password[bcrypt], counter, role, active, createdAt, updatedAt)`


## 常用操作（PowerShell 範例）

- 取號（公共 API）：
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/tickets -ContentType 'application/json' -Body (@{ serviceType='A'; phone='0912345678' } | ConvertTo-Json)
```

- 叫下一位（Agent）：
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agent/callNext -ContentType 'application/json' -Body (@{ serviceType='A'; counter='1' } | ConvertTo-Json) -Headers @{ 'x-agent-pin' = '0000' }
```

- 建立/管理帳號（需 CSRF）：
```powershell
$csrf = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/admin/csrf -Headers @{ 'x-agent-pin' = '0000' }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agents -ContentType 'application/json' -Body (@{ account='alice'; name='Alice'; password='pass123'; counter='1' } | ConvertTo-Json) -Headers @{ 'x-agent-pin' = '0000'; 'x-csrf-token' = $csrf.csrfToken }
```


## 疑難排解（Troubleshooting）

- 啟動失敗/Exit Code 1，並顯示「需要 AGENT_PIN 環境變數」：
  - 於 PowerShell 執行：`$env:AGENT_PIN='0000'; npm run dev`

- 連線被拒（EADDRINUSE: address already in use 3000）：
  - 變更埠：`$env:PORT='3001'; npm run dev`
  - 或關閉佔用 3000 埠的程式

- SQLite database is locked / SQLITE_BUSY：
  - 可能同時有其它程式開啟 `db/queue.db`（另一個 node 程式或資料庫檢視器）
  - 請關閉相關程式；必要時重新開機或刪除暫存 `queue.db-wal`/`queue.db-shm`（務必停機/備份）

- CORS 錯誤（CORS origin denied）：
  - 設定 `ALLOWED_ORIGINS`，例如：`$env:ALLOWED_ORIGINS='http://localhost:3000,http://127.0.0.1:3000'`

- Captcha 圖片顯示錯誤或 `sharp` 安裝失敗：
  - `sharp` 為可選；若無法安裝，服務會自動改以 SVG 回傳圖片，功能仍可使用

- 呼叫管理 API 回傳 `missing csrf token`：
  - 請先呼叫 `/api/admin/csrf` 取得 token，並於瀏覽器來源請求加上 `x-csrf-token`

- 取號回傳 `phone is required`：
  - 目前設計強制需提供電話（僅數字會被保留），請在 Body 加入 `phone`


## 安全與生產建議

- Captcha 暫存於記憶體，建議改為 Redis/DB 做分散式與重啟持久化
- 登入驗證使用 `agents` 表與 bcrypt 密碼雜湊；請搭配公司 SSO/LDAP 或自有帳號系統
- 收緊 CORS/CSP、加上 HTTPS 與反向代理（Nginx/Ingress）
- 監控與日誌：建議整合 morgan/winston 與 Sentry/Elastic 方案

更多安全指引：`Security-Guidelines_Traditional-Chinese.md`、`Security-Guidelines-Explanation_Traditional-Chinese.md`、`security-fixes.md`


## 套件腳本

- `npm run dev`：以 nodemon 啟動（開發）
- `npm start`：以 node 啟動（生產）