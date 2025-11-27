# 數位叫號嵌入式網頁模組

可嵌入既有網站或資訊站的取號 Widget、櫃員端（Agent）、大廳顯示（Lobby），搭配 REST API、WebSocket 即時通知、SQLite 輕量資料庫與 QR Code 取號/查詢。

內容包含：

- 客戶端（Kiosk / Widget）：取號與票券 QR
- 櫃員端（Agent）：登入、叫號、重叫、轉服務、完成、取消
- 大廳顯示（Lobby）：即時叫號顯示與事件播報
- 後端：Express REST API、Socket.IO、SQLite、Captcha（圖形驗證碼）與管理 API


## 快速開始（Windows PowerShell）

**重要**：首次啟動前請先完成安全配置！

### 🔒 安全配置（首次設定必須執行）

1. **安裝相依套件**

```powershell
npm install
```

2. **設定環境變數**

```powershell
# 複製環境變數範本
Copy-Item .env.example .env

# 編輯 .env 檔案，設定您的配置
notepad .env
```

**環境變數範例**（本地開發）：
```env
PORT=3000
NODE_ENV=development
# 開發模式會自動允許 localhost，無需設定 ALLOWED_ORIGINS
```

**環境變數範例**（生產環境 + DevTunnel）：
```env
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://your-tunnel-id.devtunnels.ms
PUBLIC_ORIGIN=https://your-tunnel-id.devtunnels.ms
```

💡 **重要提示**：
- localhost 會自動被允許，**無需**在 `ALLOWED_ORIGINS` 中列出
- 開發模式會自動允許所有 localhost 和 127.0.0.1
- 生產模式只需列出遠端/公開的 HTTPS URL

3. **執行安全檢查（如需手動執行）**

請參考本文件中「手動安全檢查」清單（檢查環境變數、.gitignore、資料庫備份與權限等）或使用發行版提供的自動化安全檢查工具。

> ⚠️ 注意：請手動執行安全檢查（或使用發行版提供的自動化工具），如需在啟動前自動執行請在 `package.json` 新增 `prestart` 指令來觸發您所選擇的檢查工具。

4. **建立管理員帳號**

若沒有可用的管理工具，請改用下列方法建立或重設管理員帳號：

- 透過管理介面（若可用）：在 `http://<host>/admin/agents.html` 使用管理介面建立帳號。
- 使用 SQLite 與 bcrypt：
  1) 產生 bcrypt hash（在有 Node.js 的環境下）：
  ```powershell
  node -e "console.log(require('bcryptjs').hashSync('YourPassword', 10))"
  ```
  2) 在 SQLite 中建立帳號（請先備份資料庫）：
  ```powershell
  sqlite3 db/queue.db
  INSERT INTO agents (account, name, password, counter, role, active, createdAt) VALUES ('admin', 'Administrator', '<bcrypt-hash>', '', 'admin', 1, datetime('now'));
  ```
  3) 若不熟悉 SQL 操作，可請系統管理員或維運人員協助。

備註：`<bcrypt-hash>` 請由第一步產生並替換。

### 🚀 啟動系統

**開發模式**（自動重啟）：
```powershell
npm run dev
```

**生產模式**：
```powershell
npm start
```

### 📱 訪問介面

本地訪問（開發模式）：
 - Kiosk（取號）：http://localhost:3000/kiosk/index.html https://your-tunnel-id.devtunnels.ms/kiosk/index.html
 - Agent（櫃員）：http://localhost:3000/agent/index.html https://your-tunnel-id.devtunnels.ms/agent/index.html
 - Lobby（大廳）：http://localhost:3000/lobby/index.html https://your-tunnel-id.devtunnels.ms/lobby/index.html
 - 登入頁：http://localhost:3000/login/index.html https://your-tunnel-id.devtunnels.ms/login/index.html
 - 管理頁：http://localhost:3000/admin/agents.html https://your-tunnel-id.devtunnels.ms/admin/agents.html

遠端訪問（使用 DevTunnel 等服務時）：
 - 將 `localhost:3000` 替換為您的公開網址

## 需求與相容性

- Node.js 16 以上（建議 18+）
- Windows / macOS / Linux 皆可
- 內建 SQLite（第一次啟動會建立 `db/queue.db`）


## 設定（.env／環境變數）

### 必要設定

- **PORT**（預設：3000）：HTTP 服務埠號
**重要**：首次啟動前請先完成安全配置！

### 🔒 安全配置（首次設定必須執行）
  ```env
  PORT=3000
  ```
**建立管理員帳號（如需手動建立）**：請參考上面「建立管理員帳號」段落所示的步驟（使用管理 UI 或透過 SQLite/DB 方式）。
  ```env
**重設管理員密碼（自動生成）**：如需手動進行，請使用 Node.js 產生 bcrypt hash 並在資料庫（SQLite）中更新，或聯絡系統管理員。

**重設管理員密碼（指定密碼）**：如需手動進行，請參考上文 `重設管理員密碼` 指示使用 bcrypt hash 更新資料庫。 
  - ✅ 只需列出遠端/公開的 URL
**建立其他管理帳號（如需手動建立）**：
```powershell
# 若有發行版提供的管理工具，請依發行版指引執行或使用資料庫操作建立帳號
```
  # 單一網域
  ALLOWED_ORIGINS=https://queue.yourcompany.com
  
  # 多個網域（逗號分隔，不要有空格）
  ALLOWED_ORIGINS=https://queue.yourcompany.com,https://www.yourcompany.com
  
  # DevTunnel / ngrok
  ALLOWED_ORIGINS=https://your-tunnel-id.devtunnels.ms
  ```

- **PUBLIC_ORIGIN**：對外公開的網址（用於生成 QR Code 和分享連結）
  ```env
  PUBLIC_ORIGIN=https://queue.yourcompany.com
  ```

### 智能 CORS 行為

系統會根據環境自動調整 CORS 策略：

| 請求來源 | 開發模式 | 生產模式 |
|---------|---------|---------|
| 無 Origin header（直接訪問） | ✅ 允許 | ✅ 允許 |
| `http://localhost:當前PORT` | ✅ 自動允許 | ✅ 自動允許 |
| `http://localhost:其他埠` | ✅ 自動允許 | ❌ 拒絕 |
| 在 ALLOWED_ORIGINS 中的網址 | ✅ 允許 | ✅ 允許 |
| 其他來源 | ❌ 拒絕並記錄 | ❌ 拒絕並記錄 |

### 其他可選設定

詳細設定請參考 [.env.example](./.env.example) 檔案。


## 專案結構

```
叫號機模組/
├── server.js                 # 主伺服器（Express + Socket.IO）與所有 API 路由
├── package.json              # 專案相依與預設啟動指令
├── .env                      # 環境變數配置（不提交到 Git）
├── .env.example              # 環境變數範本
├── .gitignore                # Git 忽略檔案清單
│
├── db/                       # 資料庫目錄
│   └── queue.db              # SQLite 資料檔（自動建立）
│
├── public/                   # 前端靜態頁面
│   ├── login/                # 登入頁（含 Captcha）
│   ├── agent/                # 櫃員端操作頁
│   ├── kiosk/                # 取號小工具（可 iframe 嵌入）
│   ├── lobby/                # 大廳顯示頁
│   ├── ticket/               # 票券查詢頁
│   ├── admin/                # 管理介面（櫃員帳號管理）
│   └── utils/                # 共用工具
│       ├── auth-checker.js   # 認證檢查模組
│       ├── input-validator.js # 輸入驗證工具
│       └── url-manager.js    # URL 管理與跳轉
│
│
└── 安全文件/
    ├── SECURITY-UPDATE.md                           # 安全性更新說明
    ├── Security-Guidelines_Traditional-Chinese.md   # 安全開發守則
    └── (其它安全文件可能在上游/發行版提供：如 SECURITY-DEPLOYMENT.md、GIT-SECURITY-CLEANUP.md 等)  
```


## 管理與帳號（CSRF 流程）

管理 UI（`/admin/agents.html`）與管理 API 需要管理員權限，系統會檢查登入狀態和角色：

1) 先呼叫 GET `/api/csrf` 取得 `{ csrfToken }`
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


## 常用操作

### PowerShell 範例

**取號**（公共 API）：
```powershell
$body = @{ serviceType = 'A' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/tickets" -ContentType 'application/json' -Body $body
```

**查看等候清單**：
```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/tickets/waiting?serviceType=A"
```

**取得系統概況**：
```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/overview"
```

### 管理員操作

> ⚠️ 注意：以下 `npm run` 指令（在某些發行版本中）可能會對應到發行版或管理工具中提供的管理指令；如無，請使用資料庫管理工具或聯絡維運人員進行管理帳號作業。

**建立管理員帳號（若無自動化管理工具請改用 DB 或介面）**：
請參考下列 `建立管理員帳號` 區塊，使用管理介面或 SQLite 命令手動建立帳號。

**重設管理員密碼（若無自動化管理工具）：**
若沒有可用的管理工具，請改用資料庫管理或使用 Node.js 產生 bcrypt hash 並在資料庫更新：

1) 產生 bcrypt hash：
```powershell
node -e "console.log(require('bcryptjs').hashSync('YourNewPassword', 10))"
```
2) 更新 SQLite 中的密碼：
```powershell
sqlite3 db/queue.db
UPDATE agents SET password = '<bcrypt-hash>' WHERE account = 'admin';
```

**建立其他管理帳號（亦可用資料庫建立）**：
請依照上述建立管理員步驟，替換 `account` 與 `name` 欄位。或使用發行版提供的管理工具（若可用）。

**執行安全檢查（如無自動化工具請參考下列步驟）：**
若沒有 `security-check` 工具，請手動檢查以下項目（部分檢查可能需系統管理員或維運協助）：
- 檢查 `.env` 中必要變數（`SESSION_SECRET`, `ALLOWED_ORIGINS`, `PUBLIC_ORIGIN` 等）
- 檢查 `.gitignore` 中已排除 `.env` 與 `db/`
- 檢查 `db/queue.db` 權限與備份機制
- 確認 `NODE_ENV=production` 時的嚴格設定與日誌機制


## 疑難排解（Troubleshooting）

### 常見問題

**1. 連線被拒（EADDRINUSE: address already in use）**
```powershell
# 方法 A：變更埠號
$env:PORT='3001'; npm run dev

# 方法 B：找出並關閉佔用埠的程式
netstat -ano | findstr :3000
```

**2. SQLite 資料庫鎖定（database is locked / SQLITE_BUSY）**
- 原因：可能有其他程式同時開啟 `db/queue.db`
- 解決：
  1. 關閉所有資料庫檢視器或其他 node 程式
  2. 停止伺服器後刪除 `db/*.db-wal` 和 `db/*.db-shm`（務必先備份）

**3. CORS 錯誤（CORS origin denied）**
```powershell
# 檢查並設定 ALLOWED_ORIGINS
# 注意：localhost 會自動允許，只需列出遠端 URL

# 範例：設定 DevTunnel URL
$env:ALLOWED_ORIGINS='https://your-tunnel-id.devtunnels.ms'
npm start
```

**4. Origin header required in production**
- 原因：在生產模式下，某些請求缺少 Origin header
- 解決：這通常是正常的安全行為，同源請求會被自動允許
- 如果是 API 測試，考慮使用開發模式或確保請求來自允許的來源

**5. Captcha 圖片顯示錯誤或 `sharp` 安裝失敗**
- `sharp` 為可選相依套件
- 若安裝失敗，系統會自動使用 SVG 格式的驗證碼
- 功能不受影響，但建議在生產環境成功安裝 `sharp` 以獲得更好的效能

**6. 管理 API 回傳 `missing csrf token`**
```powershell
# 步驟 1：取得 CSRF token
$csrf = Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/csrf"

# 步驟 2：使用 token 呼叫管理 API
$headers = @{ 'x-csrf-token' = $csrf.csrfToken }
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/agents" -Headers $headers
```

**7. 無法提交到 Git（pre-commit hook 錯誤）**
- 原因：安全檢查工具偵測到敏感檔案
- 解決：
  ```powershell
  # 確認 .gitignore 包含 .env 和 db/*.db
  git status
  
  # 如果誤加入敏感檔案
  git reset HEAD .env
  git reset HEAD db/queue.db
  ```

### 取得協助

如果問題仍未解決：
1. 執行安全檢查（如適用）：請手動執行或使用發行版/組織提供的自動化安全檢查工具。
2. 檢查伺服器日誌中的錯誤訊息
3. 參考安全部署指南（例如 `SECURITY-DEPLOYMENT.md`，若 repository 未提供，請參考發行版文件或自訂部署指南）
4. 查看 [Security-Guidelines_Traditional-Chinese.md](./Security-Guidelines_Traditional-Chinese.md) 安全守則


## 安全與生產建議

### 🔒 安全性更新（2025-10-01）

本系統已進行**全面的安全強化**，包含：

#### ✅ 核心安全改進
- **環境變數保護**：自動驗證生產環境配置，防止設定錯誤
- **智能 CORS 處理**：自動允許 localhost，生產環境嚴格檢查
- **錯誤處理改善**：避免洩漏敏感資訊（堆疊追蹤、內部路徑等）
- **前端輸入驗證**：完整的 XSS 防護與輸入清理工具
- **自動安全檢查**：部署前自動執行完整安全掃描
- **Git 安全防護**：pre-commit hook 防止提交敏感檔案

#### 📚 詳細文件

| 文件 | 說明 |
|-----|------|
| [SECURITY-UPDATE.md](./SECURITY-UPDATE.md) | 最新安全更新的完整說明 |
| 安全部署指南（可能由發行版或上游提供） | 生產環境部署檢查清單與 Nginx 配置範例 |
| [Security-Guidelines_Traditional-Chinese.md](./Security-Guidelines_Traditional-Chinese.md) | 安全開發守則（開發前必讀） |
| [Security-Guidelines-Explanation_Traditional-Chinese.md](./Security-Guidelines-Explanation_Traditional-Chinese.md) | 安全守則詳細說明 |
| Git 歷史清理指南（可在上游或發行版中取得） | Git 歷史清理指南 |

### � 部署前檢查清單

部署到生產環境前，請確認以下項目：

#### 環境配置
- [ ] 已設定 `.env` 並填入正確的生產環境配置
- [ ] 已執行安全檢查（例如手動檢查或發行版自動化工具）無錯誤
- [ ] `NODE_ENV` 設為 `production`
- [ ] `ALLOWED_ORIGINS` 僅包含 HTTPS 的公開網域（**不含 localhost**）
- [ ] `PUBLIC_ORIGIN` 設定為實際公開網址

#### 帳號與認證
- [ ] 已建立管理員帳號（若 repository 未提供自動化管理工具，請使用資料庫管理工具或發行版提供的管理工具）
- [ ] 已更改所有預設密碼（符合強度要求）
- [ ] 已禁用或刪除測試帳號

#### 網路與伺服器
- [ ] 已設定 HTTPS（透過 Nginx/Apache 反向代理）
- [ ] 已配置 SSL/TLS 憑證
- [ ] 已設定防火牆規則（只開放必要埠）
- [ ] 已測試 HTTPS 連線正常運作

#### 資料保護
- [ ] 資料庫檔案權限設為 `600` 或更嚴格
- [ ] 已設定自動備份機制
- [ ] 備份檔案儲存在安全位置（異地備份）
- [ ] 已確認 `.env` 和 `db/` 不在版本控制中

### 🛡️ 生產環境最佳實踐

#### 1. 使用反向代理（Nginx 範例）

```nginx
server {
    listen 443 ssl http2;
    server_name queue.yourcompany.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        
        # WebSocket 支援
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 安全 headers
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP 自動重定向到 HTTPS
server {
    listen 80;
    server_name queue.yourcompany.com;
    return 301 https://$server_name$request_uri;
}
```

完整 Nginx 配置請參考安全部署指南（如本 repository 未包含，請參考發行版或公司內部部署指引）。

#### 2. 使用 PM2 管理程序

```powershell
# 安裝 PM2
npm install -g pm2

# 啟動應用
pm2 start server.js --name queue-system

# 設定開機自動啟動
pm2 startup
pm2 save

# 監控
pm2 monit

# 查看日誌
pm2 logs queue-system
```

*注意：為了安全性，管理工具預設不會在輸出中顯示明文密碼。若您需要在控制台一次性顯示臨時密碼，請評估並慎重使用，以避免敏感資訊出現在日誌或集中式日誌伺服器中。*
#### 3. 定期維護

- **每日**：檢查日誌，確認無異常活動
- **每週**：執行安全檢查（手動或使用發行版建議的自動化工具）
- **每月**：
*注意：重設密碼及管理工具預設不會在輸出中顯示明文密碼；如您需要顯示臨時密碼，請謹慎評估與使用，避免漏出敏感資訊。*
  - 更新相依套件：`npm update`
  - 檢查備份完整性
- **每季**：審查存取日誌，更新安全政策

### 🔍 安全監控

系統會自動記錄以下安全事件：
- CORS 拒絕事件（含來源 URL）
- 登入失敗嘗試
- CSRF token 驗證失敗
- 生產環境錯誤（僅記錄訊息，不含堆疊）

建議整合專業日誌服務（如 ELK Stack、Splunk）進行集中式監控。

### 📞 安全問題回報

如發現安全漏洞，請：
1. **不要**公開揭露
2. 聯絡系統管理員或專案維護者
3. 提供詳細的重現步驟


### 常用指令

### 開發與執行
- `npm run dev` - 開發模式（使用 nodemon 自動重啟）
- `npm start` - 生產模式（使用 node 啟動）

### 管理與維護
管理與維護操作建議使用管理介面或直接在資料庫 (SQLite) 中操作，若您在發行版中看到管理工具，請遵從該發行版本的使用說明。

### 安全檢查
若 repository 未包含 `security-check` 工具，請手動檢查 README 中列出的安全項目或使用組織/發行版提供的自動化檢查工具。

### 範例

```powershell
# 開發時使用（自動重啟）
npm run dev

# 生產環境啟動
npm start

# 建立管理員並自動生成密碼
請參考本文件中「建立管理員帳號」與「重設管理員密碼」段落，使用管理介面或資料庫 (SQLite) 操作以建立與管理帳號；安全檢查請參考上文的手動檢查清單。
```

---

## 更新日誌

### 2025-10-01 - 安全性大幅強化
- ✅ 新增智能 CORS 處理（自動允許 localhost）
- ✅ 新增 `reset-admin` 管理工具支援密碼重設
- ✅ 新增完整的前端輸入驗證工具
- ✅ 新增自動安全檢查工具
- ✅ 新增 Git pre-commit hook 防止敏感檔案提交
- ✅ 改善錯誤處理，避免資訊洩漏
- ✅ 更新環境變數配置與驗證機制
- ✅ 新增完整的安全文件與部署指南

### 初始版本
- ✅ 基本叫號系統功能
- ✅ REST API 與 WebSocket 支援
- ✅ SQLite 資料庫整合
- ✅ Captcha 驗證碼
- ✅ QR Code 生成
- ✅ 多角色權限管理