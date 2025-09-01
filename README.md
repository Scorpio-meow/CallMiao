# 數位叫號嵌入式網頁模組

可嵌入任何既有網站或資訊站的前台取號 Widget、櫃員端、以及大廳顯示頁。含 REST API、WebSocket 即時通知、SQLite 與 QR Code。

本專案已完成基礎強化：
- JWT + HttpOnly Cookie 登入（/api/login，含圖形驗證 Captcha）
- 嚴格 CSP（無 inline script/style）
- 速率限制、角色權限（agent/admin）、管理端 CSRF token

——

## 快速開始（本機）

1) 安裝依賴

```powershell
npm install
```

2) 啟動（開發）

```powershell
npm run dev
```

3) 打開頁面

- 取號：http://localhost:3000/kiosk/index.html
- 櫃員：http://localhost:3000/agent/index.html
- 大廳：http://localhost:3000/lobby/index.html
- 管理：http://localhost:3000/admin/agents.html

預設在非生產環境，若資料庫尚無使用者，會自動建立開發用管理者：
- 帳號：admin
- 密碼：admin123

登入流程：
1. 先至 http://localhost:3000/login/index.html 取得 Captcha token 與圖片
2. 輸入帳號、密碼與驗證碼送出至 /api/login
3. 成功後伺服器會在 Cookie 設定 sid（HttpOnly）；前端不用保存任何敏感資訊

——

## 生產環境設定

請設定下列環境變數（Windows PowerShell 範例）：

```powershell
# 要求：強隨機字串（至少 32 bytes）
$env:JWT_SECRET = "<your-strong-secret>"

# 允許的跨網域來源清單（逗號分隔），例如你的前端網域
$env:ALLOWED_ORIGINS = "https://your-frontend.example.com,https://admin.example.com"

# 伺服器埠
$env:PORT = "3000"

# 啟動
npm run start
```

注意：
- 正式環境請使用 HTTPS，Cookie 會自動以 secure 屬性設定
- 不要把 JWT_SECRET 放進程式碼庫；用系統環境或秘密管理
- 設定 ALLOWED_ORIGINS 為精確清單，避免使用萬用字元

——

## 重要路由與 API

公共：
- GET /api/health
- POST /api/tickets
- GET /api/tickets/waiting
- GET /api/ticket/:id
- GET /api/overview
- GET /api/qrcode?text=...

登入與會話：
- GET /api/captcha/new → 取得 { token, expiresAt }
- GET /api/captcha/image/:token → Captcha 圖片
- POST /api/login → 設定 sid Cookie
- GET /api/auth/me → 取得當前使用者
- POST /api/auth/logout → 登出（清除 Cookie）

受保護（需登入，依角色限制）：
- 管理：/api/agents CRUD、/api/admin/csrf（取得 CSRF token 後再進行變更）
- 櫃員：/api/agent/*（叫號、完成、轉櫃、歷史、訊息）

——

## 目錄結構

- server.js：主要服務與 API
- public/：前端頁面（已移除 inline script/style，符合 CSP）
- db/queue.db：SQLite 資料庫（啟動後建立）

——

## 開發與測試

- 開發：npm run dev（需要 nodemon）
- 安全檢查：npm run audit
- 若要接入企業認證（LDAP/SSO/自家資料庫），請修改 server.js 的 /api/login

——

## 安全與營運建議

- 啟用集中化日誌與告警（WAF/反向代理、Winston/Sentry）
- 將 Captcha 與 Session Blacklist 遷移至 Redis（多機部署）
- 在 CI 內增加 SCA/依賴掃描（npm audit、Snyk、GHAS）

