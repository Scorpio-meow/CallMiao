# 數位叫號嵌入式網頁模組

可嵌入任何既有網站或資訊站的前台取號 Widget、櫃員端後台、以及大廳顯示頁。含 REST API、WebSocket 即時通知、SQLite 輕量資料庫與 QR Code 取號/查詢。

# 數位叫號嵌入式網頁模組

輕量、可嵌入的數位叫號系統範例。包含：

- 客戶端（Kiosk / Widget）：取號流程與票券 QR
- 櫃員端（Agent）：登入 + 操作叫號 / 轉服務 / 完成等功能
- 大廳顯示（Lobby）：即時展示與語音播報事件
- 後端：Express REST API、Socket.IO、SQLite 儲存、QR 圖片產生

這個 repo 提供一個可跑的原型，方便整合到既有網站或內部系統。

---

## 快速開始

1. 安裝套件

```powershell
npm install
```

2. 啟動（開發）

```powershell
npm run dev
```

3. 打開瀏覽器

- 取號 Widget：`http://localhost:3000/kiosk/index.html`
- 櫃員端：`http://localhost:3000/agent/index.html`
- 大廳顯示：`http://localhost:3000/lobby/index.html`
- 管理頁面：`http://localhost:3000/admin/agents.html`

安全說明：必須設定 `AGENT_PIN` 環境變數（伺服器啟動會檢查，若未設定將中止啟動）。
設定範例（PowerShell, 臨時）：
```powershell
$env:AGENT_PIN='0000'; npm run dev
```
或永久設定（Windows):
```powershell
setx AGENT_PIN "0000"
# 關閉並重開 PowerShell 視窗後再啟動
```

管理頁面：`/admin/agents.html`
- 可透過瀏覽器開啟 `http://<host>:<port>/admin/agents.html`，輸入 `x-agent-pin` 後即可列出與管理帳號（建立/編輯/刪除）。

若要用 CLI 建立帳號（PowerShell 範例）：
```powershell
$body = @{ account='alice'; name='Alice'; password='pass123'; counter='1' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agents -ContentType 'application/json' -Body $body -Headers @{ 'x-agent-pin' = '0000' }
```

或 curl：
```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -H "x-agent-pin: 0000" \
  -d '{"account":"alice","name":"Alice","password":"pass123","counter":"1"}'
```

---

## 專案檔案說明

- `server.js`：主伺服器程式（Express + Socket.IO），包含所有 REST API 與 Captcha / Login 範例
- `public/`：前端靜態資源
  - `kiosk/`：取號小工具（可 iframe 或直接開啟）
  - `agent/`：櫃員端控制介面
  - `lobby/`：大廳顯示頁
  - `ticket/`：票券查詢頁
- `db/queue.db`：SQLite 檔案（第一次啟動時建立）

---

## API 詳細

認證：多數 agent 操作需要在 header 中帶 `x-agent-pin`（或在環境變數 `AGENT_PIN` 設定相符），或用 `/api/login` 的延伸驗證。

公共 API:

- GET `/api/health` — 健康檢查
- POST `/api/tickets` — 建立號碼
  - Body: { serviceType: 'A'|'B'|..., phone?: '0912...' }
  - Response: { ticket }
- GET `/api/tickets/waiting?serviceType=A` — 取得等待清單
- GET `/api/ticket/:id` — 查詢單張票券
- GET `/api/overview` — 回傳 summary + currentCalls
- GET `/api/qrcode?text=...` — 產生 PNG 的 QR code

Captcha / Login 流程:

- GET `/api/captcha/new` — 產生一組 Captcha token（回傳 { token, expiresAt }）
- GET `/api/captcha/image/:token` — 以 PNG 圖檔回傳該 token 的驗證碼影像（Content-Type: image/png）
- POST `/api/login` — 驗證 captcha 與帳密
  - Body: { account, password, captchaToken, captcha }
  - 回傳: { ok: true }（範例實作接受任何帳密；請在此位置接入真實驗證）

Agent API（需要 x-agent-pin）:

- POST `/api/agent/callNext` — 叫下一位 { serviceType, counter }
- POST `/api/agent/callSpecific` — 指定一張票 { ticketId, counter, internal }
- POST `/api/agent/markServing` — 標記開始服務 { ticketId }
- POST `/api/agent/finish` — 結束 { ticketId, result, verify4 }
- POST `/api/agent/recall` — 重叫 { ticketId }
- POST `/api/agent/cancel` — 取消 { ticketId, reason }
- POST `/api/agent/transfer` — 轉櫃/轉服務 { ticketId, toServiceType, toCounter, keepStatus }
- POST `/api/agent/createTicket` — 櫃台建立票券 { serviceType, phone }
- GET `/api/agent/history?serviceType=A&limit=50` — 歷史查詢
- POST `/api/agent/message` — 廣播訊息給 agent

---

## Socket.IO 事件

- `queue:update` — 等候/現況摘要更新（payload: { serviceType, overview })
- `call:made` — 叫號事件（payload: { ticket })
- `agent:message` — agent 間的廣播訊息

前端應該在 socket 連線後監聽這些事件以即時更新畫面。

---

## 前端頁面說明

- `public/login/index.html` — 登入頁（使用 Captcha token + 圖檔）；成功後會把 `agent_name` / `agent_pin` 寫入 `sessionStorage` 並導向 `agent/index.html`。
- `public/agent/index.html` — 櫃員端，含：
  - 登入覆蓋層（若 sessionStorage 無 PIN）
  - 服務選擇、櫃台號、12 功能按鈕矩陣
  - 目前等待清單 / 目前服務中清單（保留舊表格以相容舊邏輯）
  - 分類等候數、即時鐘、歷史查詢
- `public/kiosk/index.html` — 客戶端取號頁（彈窗輸入電話、顯示票券 QR 及連結）
- `public/lobby/index.html` — 大廳顯示（語音播報 call:made）
- `public/ticket/index.html` — 個別票券頁（透過 QR 查詢）

---

## 專案開發/測試

- 建議用 Node 16+（已在 package.json 中指定常見套件）
- 調試：`npm run dev`（需要 nodemon）
- 若要在遠端或 Docker 上部署，請設定 `PORT` 與 `AGENT_PIN` 環境變數

測試 Captcha 與 Login:

1. 開啟 `http://localhost:3000/login/index.html`
2. 點擊驗證碼圖片（或刷新頁面）取得新的 token 與 PNG
3. 輸入驗證碼（圖片上的 6 位數）以及任意帳號/密碼，送出

若要連接真實認證（AD/LDAP 或資料庫），請修改 `server.js` 中 `/api/login` 的驗證段落；我可以幫你加入範例連接器。

---

## 安全與生產準備（注意事項）

- 目前 Captcha 與 Login 為示範：
  - Captcha 暫存在記憶體中，重啟會失效；生產應改為 Redis 或 DB 共享儲存
  - Login 範例接受任何帳密；請務必整合企業身分驗證（LDAP/SSO）或資料庫密碼雜湊比較
- CSP 與 Cookie：目前範例在 middleware 中已加入簡單 CSP；根據部署情境請收緊規則
- 日誌與監控：建議加入 request logging（morgan/winston）與錯誤追蹤（Sentry）

---

## 後續建議

- 將 Captcha 儲存改為 Redis（分布式服務）
- 加入使用者角色（agent/admin）與更細緻的權限控制
- 整合 SMS / LINE 推播以通知客戶叫號
- 增加報表匯出與 SLA 監測

---

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agents `
  -ContentType 'application/json' `
  -Body (@{ account='alice'; name='Alice'; password='pass123' } | ConvertTo-Json) `
  -Headers @{ 'x-agent-pin' = '0000' }
