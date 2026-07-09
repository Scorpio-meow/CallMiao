# 數位叫號嵌入式網頁模組

可嵌入既有網站或資訊站的取號小工具、櫃員端、大廳叫號顯示看板，搭配 REST API、WebSocket 即時通知、SQLite 輕量資料庫與 QR Code 取號及查詢。

內容包含：
- 客戶端（Kiosk / Widget）：取號與票券 QR Code 生成。
- 櫃員端（Agent）：登入、叫號、重叫、轉服務、完成服務、取消票券。
- 大廳顯示看板（Lobby）：即時叫號顯示與事件播報（支援語意語音廣播）。
- 統一登入頁面（Login）：支援 Captcha 圖形驗證碼與安全認證。
- 管理介面（Admin）：櫃員帳號建立、編輯與櫃台綁定設定。
- 後端服務（Express）：提供 REST API、Socket.IO 即時更新與安全防護。

---

## 快速開始

### 1. 安裝相依套件

請使用 Bun 安裝專案所需的套件：
```powershell
bun install
```

### 2. 設定環境變數

複製環境變數範本並根據您的執行環境進行修改：
```powershell
# 複製環境變數範本
Copy-Item .env.example .env

# 編輯 .env 檔案進行配置
notepad .env
```

開發模式設定範例：
```env
PORT=3000
NODE_ENV=development
# 開發模式下會自動允許 localhost 跨域，無需額外設定 ALLOWED_ORIGINS
```

生產環境與反向代理（如 DevTunnel）設定範例：
```env
PORT=3000
NODE_ENV=production
SESSION_SECRET=您的隨機長字串金鑰
ALLOWED_ORIGINS=https://your-tunnel-id.devtunnels.ms
PUBLIC_ORIGIN=https://your-tunnel-id.devtunnels.ms
```

重要提示：
- 開發模式下，系統會自動允許所有 localhost 與 127.0.0.1 請求，無需在 `ALLOWED_ORIGINS` 中列出。
- 生產環境下，必須設定 `ALLOWED_ORIGINS`（以逗號分隔多個網域，不要有空格）與 `PUBLIC_ORIGIN`。
- 生產環境下，`SESSION_SECRET` 不可使用預設值，否則伺服器將拒絕啟動。

### 3. 手動建立管理員帳號

由於自動化腳本已移出，請依照以下手動步驟在 SQLite 資料庫中建立管理員帳號：

1) 產生加密密碼的 bcrypt 雜湊值（請在終端機執行以下指令）：
```powershell
bun -e "console.log(require('bcryptjs').hashSync('您的密碼', 10))"
```

2) 連接 SQLite 資料庫（請先確保已執行過一次服務以自動生成資料庫檔案，或手動建立 db 目錄）：
```powershell
sqlite3 db/queue.db
```

3) 在 SQLite 互動式終端機中執行 SQL 語法寫入管理員（請將 `<您的-bcrypt-hash>` 替換為第一步產生的結果）：
```sql
INSERT INTO agents (account, name, password, counter, role, active, createdAt) 
VALUES ('admin', '系統管理員', '<您的-bcrypt-hash>', '', 'admin', 1, datetime('now'));
```

### 4. 啟動系統

開發模式（支援程式碼修改後自動重啟）：
```powershell
bun run dev
```

生產模式（使用標準 Node 執行）：
```powershell
bun start
```

### 5. 訪問介面網址對照

本地訪問（開發模式）：
- 客戶端取號小工具：http://localhost:3000/kiosk/index.html
- 櫃員端操作介面：http://localhost:3000/agent/index.html
- 大廳叫號顯示看板：http://localhost:3000/lobby/index.html
- 統一登入頁面：http://localhost:3000/login/index.html
- 管理介面（櫃員與櫃台管理）：http://localhost:3000/admin/agents.html

遠端與正式訪問：
- 將上述網址中的 `localhost:3000` 替換為您在 `.env` 中設定的 `PUBLIC_ORIGIN`。

---

## 需求與相容性

- Node.js 16 以上（建議 18+）或 Bun 執行環境
- Windows / macOS / Linux 作業系統
- 內建 SQLite 資料庫（首次啟動時會自動建立 `db/queue.db` 檔案）

---

## 環境配置 (.env)

| 變數名稱 | 說明 | 預設值 |
|----------|------|--------|
| PORT | 伺服器監聽的埠號 | 3000 |
| NODE_ENV | 環境模式 (development / production) | development |
| SESSION_SECRET | Session 加密密鑰（正式環境下必須修改） | fallback-insecure-secret-change-this |
| ALLOWED_ORIGINS | 允許跨域請求的來源（逗號分隔，不可包含空格與尾端斜線） | 無 |
| PUBLIC_ORIGIN | 系統對外公開網址（用於生成 QR Code 的基礎網址） | 無 |

### 智能 CORS 比對行為

| 請求來源 | 開發模式 (development) | 生產模式 (production) |
|----------|-----------------------|-----------------------|
| 無 Origin 標頭的請求 | 允許存取 | 允許存取 |
| 本地同埠來源 (http://localhost:當前PORT) | 自動允許 | 自動允許 |
| 本地異埠來源 (http://localhost:其他PORT) | 自動允許 | 拒絕存取 |
| 在 ALLOWED_ORIGINS 中設定的網域 | 允許存取 | 允許存取 |
| 其他非信任來源 | 拒絕並記錄安全日誌 | 拒絕並記錄安全日誌 |

---

## 專案結構

```
CNS/
├── server.js                 # 主伺服器程式（Express + Socket.IO）與 API 路由實作
├── package.json              # 專案相依套件與指令設定
├── .env.example              # 環境變數設定範本
├── .gitignore                # Git 忽略檔案清單
├── db/                       # 資料庫儲存目錄
│   └── queue.db              # SQLite 資料庫檔案（啟動時自動建立）
└── public/                   # 前端靜態資源網頁
    ├── login/                # 統一登入頁面（含 Captcha 驗證碼處理邏輯）
    ├── agent/                # 櫃員操作端介面
    ├── kiosk/                # 取號端小工具（支援 iframe 嵌入）
    ├── lobby/                # 大廳看板顯示與語音播報頁面
    ├── ticket/               # 顧客票券進度即時查詢頁面
    ├── admin/                # 管理員介面（櫃員帳號管理與櫃台設定）
    └── utils/                # 前端共用工具庫
        ├── auth-checker.js   # 認證與狀態檢查模組
        ├── input-validator.js # 前端輸入驗證與安全清理工具
        └── url-manager.js    # 安全網址管理與跳轉白名單控制
```

---

## 管理與帳號安全 (CSRF 流程)

管理介面（`/admin/agents.html`）與管理 API 受到 CSRF 流程與管理員角色權限保護：

1) 請求非安全方法（如 POST、PUT、DELETE）前，需先透過 GET `/api/csrf` 取得 `{ csrfToken }`。
2) 後續發送修改資料的 API 請求時，必須在 HTTP Header 中夾帶 `x-csrf-token: <csrfToken>` 標頭。

### 櫃台號管理重要規則

為防範配置錯誤，櫃台號實作了嚴格的權限綁定：
- 櫃台號僅能由管理員透過管理介面（`/admin/agents.html`）在建立或修改櫃員帳號時進行設定。
- 櫃員登入後，系統將自動載入該帳號所綁定的櫃台號。
- 櫃員端操作頁面上的櫃台號欄位為唯讀，櫃員無法自行修改。

---

## API 摘要

### 公共 API

- **GET `/api/health`**：健康檢查。
- **POST `/api/tickets`**：建立排隊票券（Request Body：`{ serviceType: 'A' }`）。
- **GET `/api/tickets/waiting`**：取得指定服務別的等候清單（Query：`?serviceType=A`）。
- **GET `/api/ticket/:id`**：查詢單筆票券詳情。
- **GET `/api/overview`**：取得目前排隊概況與各櫃台叫號狀態。
- **GET `/api/qrcode`**：生成與傳回 PNG 格式的 QR Code 圖片（Query：`?text=...`）。

### 驗證與 Captcha API

- **GET `/api/captcha/new`**：生成新的驗證碼 Token（回傳 `{ token, expiresAt }`）。
- **GET `/api/captcha/image/:token`**：傳回對應 Token 的驗證碼圖片（若系統安裝有 `sharp` 則傳回 PNG，若無則降級為 SVG 向量圖）。
- **POST `/api/login`**：登入驗證（包含帳號、密碼與 Captcha 圖形驗證，成功則建立 Session）。

### 櫃員端 API（需有效的櫃員 Session 認證）

- **POST `/api/agent/callNext`**：呼叫下一位等待的顧客（Request Body：`{ serviceType, counter }`）。
- **POST `/api/agent/callSpecific`**：指定叫號（Request Body：`{ ticketId, counter, internal }`）。
- **POST `/api/agent/markServing`**：標記開始提供服務（Request Body：`{ ticketId }`）。
- **POST `/api/agent/finish`**：完成服務（Request Body：`{ ticketId, result }`）。
- **POST `/api/agent/recall`**：重新呼叫當前票券（Request Body：`{ ticketId }`）。
- **POST `/api/agent/cancel`**：取消該票券並記錄原因（Request Body：`{ ticketId, reason }`）。
- **POST `/api/agent/transfer`**：票券轉櫃或轉移服務別（Request Body：`{ ticketId, toServiceType, toCounter, keepStatus }`）。
- **POST `/api/agent/createTicket`**：櫃台櫃員代客取號（Request Body：`{ serviceType }`）。
- **GET `/api/agent/history`**：取得叫號歷史紀錄（Query：`?serviceType=A&limit=50`）。
- **GET `/api/agent/ticket/:id`**：取得單筆票券之內部詳細資料。

### 管理端 API（需管理員權限，且需帶有 CSRF Token）

- **GET `/api/agents`**：列出所有櫃員帳號。
- **GET `/api/agents/:id`**：查詢單筆櫃員資料。
- **POST `/api/agents`**：建立新的櫃員帳號。
- **PUT `/api/agents/:id`**：修改現有櫃員帳號（包含停用/啟用、修改密碼、變更櫃台號等）。
- **DELETE `/api/agents/:id`**：刪除指定的櫃員帳號。

---

## WebSocket 事件

- **`queue:update`**：排隊等待人數與現況摘要更新（Payload：`{ serviceType, overview }`）。
- **`call:made`**：叫號事件廣播，用於大廳看板接收播放（Payload：`{ ticket }`）。
- **`agent:message`**：櫃員端廣播之系統即時通告。

---

## 資料模型 (SQLite)

### seq 表
儲存各服務別每日的流水號進度：
- `serviceType` (TEXT)：服務類別（如 A, B, C 等）。
- `ymd` (TEXT)：日期字串（格式：YYYYMMDD）。
- `seq` (INTEGER)：當日目前最大流水號。
- 主鍵：`(serviceType, ymd)`

### tickets 表
儲存排隊票券資料：
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)：票券唯一識別碼。
- `serviceType` (TEXT)：服務類別。
- `number` (TEXT)：產生的排隊號碼（如 A001, B002）。
- `status` (TEXT)：目前狀態（waiting / calling / serving / finished / cancelled）。
- `counter` (TEXT)：處理該票券的櫃台號。
- `result` (TEXT)：服務處理結果或取消原因。
- `createdAt` (TEXT)：取號時間。
- `calledAt` (TEXT)：叫號時間。
- `finishedAt` (TEXT)：完成或取消時間。

### agents 表
儲存系統櫃員帳號資料：
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)：帳號唯一識別碼。
- `account` (TEXT UNIQUE)：登入帳號。
- `name` (TEXT)：櫃員姓名。
- `password` (TEXT)：經 bcrypt 處理之加密密碼。
- `counter` (TEXT)：綁定的櫃台號。
- `role` (TEXT)：角色權限（admin / agent）。
- `active` (INTEGER)：啟用狀態（1 為啟用，0 為停用）。
- `createdAt` (TEXT)：建立時間。
- `updatedAt` (TEXT)：最後修改時間。

### 資料庫維護說明：移除歷史未使用欄位

若您是從舊版本升級，舊版 `tickets` 表可能包含已不再使用的 `phone` 欄位。如需在維護時段精簡資料表結構，可連接資料庫並執行以下 SQL 指令：

```sql
-- 1. 建立新結構表（不含 phone 欄位）
CREATE TABLE tickets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serviceType TEXT NOT NULL,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  counter TEXT,
  result TEXT,
  createdAt TEXT NOT NULL,
  calledAt TEXT,
  finishedAt TEXT
);

-- 2. 轉移舊有資料
INSERT INTO tickets_new (id, serviceType, number, status, counter, result, createdAt, calledAt, finishedAt)
SELECT id, serviceType, number, status, counter, result, createdAt, calledAt, finishedAt
FROM tickets;

-- 3. 替換資料表
DROP TABLE tickets;
ALTER TABLE tickets_new RENAME TO tickets;
```

備註：若已有完備的備份，且不介意資料庫中留存無用欄位，亦可選擇不執行此離線遷移。

---

## 生產環境安全與部署建議

### 1. 部署前手動安全檢查

在將系統部署至生產環境前，請確認以下項目是否已手動配置妥當：
- 檢查 `.env` 中的 `NODE_ENV` 已設為 `production`。
- 檢查 `SESSION_SECRET` 已替換為隨機安全金鑰，未保留預設的不安全值。
- 檢查 `ALLOWED_ORIGINS` 僅包含受信任的 HTTPS 公開網域，不含 localhost。
- 檢查 `PUBLIC_ORIGIN` 已設為實際公開的 HTTPS URL。
- 檢查 `db/queue.db` 檔案權限，確保僅執行 Node/Bun 的使用者有權讀寫（建議權限設為 600 或更嚴格）。
- 確認已將所有測試、預設或強度不足的密碼修改為強密碼。
- 確認資料庫已設定自動定時備份機制，並確保 `.env` 與 `db/` 目錄不在 Git 版本追蹤中。

### 2. Nginx 反向代理配置範例

建議在 Express 前端架設 Nginx 作為反向代理並配置 SSL/TLS，以下為 Nginx 配置範例：

```nginx
server {
    listen 443 ssl http2;
    server_name queue.yourcompany.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        
        # 支援 WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 轉發客戶端真實 IP 與安全 Headers
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP 自動導向 HTTPS
server {
    listen 80;
    server_name queue.yourcompany.com;
    return 301 https://$server_name$request_uri;
}
```

### 3. 使用 PM2 管理程序

在生產環境中，建議使用 PM2 行程管理器來確保應用程式能於背景穩定運行、重啟與開機自啟：

```powershell
# 全局安裝 PM2
bun install -g pm2

# 啟動應用並命名為 queue-system
pm2 start server.js --name queue-system

# 設定開機自啟並儲存當前狀態
pm2 startup
pm2 save

# 監控與查看日誌
pm2 monit
pm2 logs queue-system
```

---

## 疑難排解 (Troubleshooting)

### 1. 連線被拒（EADDRINUSE: address already in use）
- 原因：埠號（例如 3000）已被其他程式佔用。
- 解決：可在啟動前透過環境變數指定其他埠號，例如：
  ```powershell
  $env:PORT='3001'
  bun run dev
  ```
  或是找出並終止佔用該埠號的程序（Windows PowerShell 範例）：
  ```powershell
  Get-NetTCPConnection -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
  ```

### 2. SQLite 資料庫鎖定（database is locked / SQLITE_BUSY）
- 原因：同時有其他程序（如其他伺服器實例或 SQLite GUI 檢視工具）開啟並鎖定了資料庫檔案。
- 解決：請關閉所有的外部資料庫連線或檢視器，並終止其他運行的 node/bun 程序。如仍無法解決，請先進行備份，然後嘗試清除 `db/` 目錄下的 `.db-wal` 及 `.db-shm` 檔案。

### 3. CORS 跨域拒絕錯誤 (CORS origin denied)
- 原因：前端網頁發送請求的 Origin 網域與伺服器設定的 `ALLOWED_ORIGINS` 不符合。
- 解決：請檢查 `.env` 檔案中的 `ALLOWED_ORIGINS` 配置，確保請求的網域已完整列於其中。開發模式下 localhost 網址會自動被允許，無需設定。

### 4. Captcha 圖片顯示錯誤或 sharp 套件安裝失敗
- 原因：`sharp` 套件在部分環境下可能因原生依賴編譯失敗而無法安裝。
- 解決：`sharp` 是選用相依套件，若安裝失敗，後端系統會自動改用 `svg-captcha` 原生的 SVG 向量格式傳回驗證碼。此降級不會影響登入功能，但建議生產環境配置好編譯環境以安裝 `sharp`，PNG 格式具備更佳的前端渲染相容性。

### 5. 管理 API 回傳 missing csrf token 錯誤
- 原因：對受保護的 POST/PUT/DELETE API 發送請求時，HTTP Header 中缺少 CSRF Token 或 Token 驗證失敗。
- 解決：請確認瀏覽器已先透過 GET `/api/csrf` 取得 Token，並在發送修改請求時將其夾帶於 `x-csrf-token` Header 中。非瀏覽器客戶端（如 PowerShell / curl 等無瀏覽器 Origin 標頭之請求）不會觸發 CSRF 驗證。

### 6. Git 提交遭拒（敏感檔案偵測）
- 原因：您的 `.env` 或 `db/queue.db` 檔案可能未正確在 `.gitignore` 中排除，導致被 git 暫存並遭安全防護攔截。
- 解決：請確認 `.gitignore` 包含 `node_modules`、`.env` 與 `db/` 項目，並執行以下指令取消暫存敏感檔案：
  ```powershell
  git reset HEAD .env
  git reset HEAD db/queue.db
  ```

---

## 更新日誌

### 2025-11-27
- 實作完整的 CSRF 安全防護機制，防範跨站請求偽造。
- 引入速率限制 (Rate limiting) 防護，有效減緩 DoS 阻斷服務攻擊風險。
- 修補前端 DOM 操作中的 InnerHTML XSS 漏洞，改以安全 DOM API 與 textContent 構建。
- 精簡與優化前端與後端的 CORS 邏輯，加強 DevTunnel 開發連線相容性。
- 修補 Transitive Dependency 安全性漏洞，將 `cookie` 套件鎖定在安全版本 `0.7.0`。
- 在 `public/utils/url-manager.js` 中新增安全白名單與協議校驗，拒絕非安全跳轉。

### 2025-10-01
- 新增智能 CORS 處理，開發環境下自動匹配 localhost。
- 新增生產環境配置驗證，避免因缺失環境變數造成防護漏洞。
- 統一錯誤處理機制，在生產環境中遮蔽詳細的堆疊追蹤資訊以防洩漏。
- 提供前端輸入清理與驗證輔助工具。

### 初始版本
- 提供基礎的排隊叫號邏輯與狀態變更功能。
- 提供 REST API 與 Socket.IO 即時更新看板之機制。
- 整合 SQLite 資料庫儲存。
- 提供 Captcha 圖形驗證碼與二維碼 QR Code 生成 API。