# 🔒 數位叫號系統 - 完整安全審計報告

**審計日期**: 2025年10月1日  
**審計範圍**: 完整專案代碼庫與配置  
**審計標準**: OWASP Top 10 (2021) + 新手常見災難性錯誤

---

## 📋 專案基本資訊

### 專案名稱與簡介
- **專案名稱**: 數位叫號嵌入式網頁模組 (Digital Queue Widget)
- **專案類型**: 叫號排隊管理系統
- **版本**: 0.1.0
- **主要功能**: 
  - 客戶端取號（Kiosk）
  - 櫃員端叫號管理（Agent）
  - 大廳即時顯示（Lobby）
  - QR Code 票券查詢
  - 管理員帳號管理

### 目標使用者
- **客戶**: 現場取號的民眾/顧客
- **櫃員**: 服務櫃台的工作人員
- **管理員**: 系統管理者
- **觀眾**: 大廳等候區的客戶

### 處理的資料類型
- ✅ **基本使用者資訊**: 櫃員帳號、姓名、櫃台號
- ❌ **無個人身份資訊（PII）**: 客戶取號不需提供個人資料
- ❌ **無支付或財務資訊**
- ❌ **無用戶上傳內容（UGC）**
- ✅ **認證憑證**: 櫃員密碼（bcrypt 雜湊）
- ✅ **業務資料**: 票券號碼、服務類型、等候狀態

### 技術棧（Tech Stack）

#### 前端
- **框架**: 原生 JavaScript (Vanilla JS)
- **即時通訊**: Socket.IO Client
- **樣式**: 自訂 CSS
- **安全工具**: 
  - `input-validator.js` (XSS 防護)
  - `auth-checker.js` (認證檢查)
  - `url-manager.js` (URL 安全跳轉)

#### 後端
- **運行環境**: Node.js 16+
- **框架**: Express.js 4.x
- **即時通訊**: Socket.IO 4.x
- **認證**: bcryptjs (密碼雜湊)
- **驗證碼**: svg-captcha
- **QR 碼**: qrcode + sharp (可選)
- **安全中介軟體**:
  - `cors` (跨域資源共享)
  - `express-rate-limit` (速率限制)
  - 自訂 CSRF 保護

#### 資料庫
- **類型**: SQLite 3
- **ORM**: better-sqlite3
- **資料表**:
  - `tickets` (票券資料)
  - `agents` (櫃員帳號)
  - `seq` (流水號)

### 部署環境/伺服器類型
- **目前環境**: DevTunnel (開發測試)
  - URL: `https://your-tunnel-id.devtunnels.ms`
  - PORT: 7894
  - NODE_ENV: production
- **建議生產環境**:
  - Nginx 反向代理 + HTTPS
  - PM2 程序管理
  - 防火牆保護

### 外部依賴與服務

#### NPM 套件列表
```json
{
  "dependencies": {
    "dotenv": "^16.4.5",
    "express-rate-limit": "^7.4.0",
    "bcryptjs": "^3.0.2",
    "better-sqlite3": "^9.6.0",
    "cors": "^2.8.5",
    "dayjs": "^1.11.13",
    "express": "^4.19.2",
    "qrcode": "^1.5.4",
    "sharp": "^0.34.3",
    "socket.io": "^4.7.5",
    "svg-captcha": "^1.4.0"
  }
}
```

**套件安全狀態**: ✅ `npm audit` 顯示 **0 個已知漏洞**

#### 外部 API 服務
- ❌ **無外部 API 服務依賴**
- 所有功能均為內部實現

#### 使用的雲端服務
- DevTunnel (僅用於開發測試)
- 無其他雲端服務依賴

---

## 🎉 優秀的安全實踐 (Good Practices Found)

在深入問題分析前，我必須先讚揚您在以下方面做得非常出色：

### ✅ 環境變數管理
- 正確使用 `.env` 檔案管理敏感配置
- `.env` 已加入 `.gitignore`
- 提供完整的 `.env.example` 範本與詳細說明

### ✅ 密碼安全
- 使用 bcrypt 雜湊（bcryptjs）
- Salt rounds: 10（合理的安全強度）
- 密碼**絕不**以明文儲存
- 登入 API 回應不包含密碼

### ✅ 輸入驗證與 XSS 防護
- 實現完整的 `InputValidator` 類別
- HTML 實體編碼 (`escapeHtml`)
- 輸入清理與白名單驗證
- 前端使用 `sanitize` 函數處理使用者輸入

### ✅ CORS 安全配置
- 智能 CORS 處理（開發/生產環境自動切換）
- 白名單機制
- 拒絕的來源會被記錄

### ✅ 速率限制（Rate Limiting）
- 登入 API: 10 分鐘 30 次
- Captcha API: 5 分鐘 60 次
- 一般 API: 每分鐘 120 次
- 有效防止暴力破解與 DoS 攻擊

### ✅ CSRF 保護
- 管理 API 需要 CSRF token
- Token 有效期 15 分鐘
- 自動清理過期 token

### ✅ Captcha 驗證碼
- 登入前必須驗證
- 驗證碼 5 分鐘過期
- 驗證後立即銷毀（一次性使用）

### ✅ SQL 注入防護
- **全面使用 Prepared Statements**
- 使用 better-sqlite3 的參數化查詢
- 無發現任何字串拼接的 SQL

### ✅ 安全工具與文件
- 提供 `security-check.js` 自動檢查腳本
- 完整的安全文件（繁體中文）
- Git pre-commit hook 範本
- 部署檢查清單

### ✅ Content Security Policy (CSP)
```javascript
"default-src 'self'; img-src 'self' data: blob:; 
 script-src 'self' 'unsafe-inline'; 
 connect-src 'self' ws: wss:"
```

### ✅ 錯誤處理
- 生產環境不洩漏堆疊追蹤
- 友善的錯誤訊息
- 詳細錯誤僅在開發模式記錄

---

## 🚨 第一部分：新手常見的災難性錯誤檢查

### ✅ [已通過] 公開存取的敏感檔案

#### 前端洩密檢查
- ✅ **無硬編碼的 API Key**
- ✅ **無硬編碼的後端 API 位址**（使用相對路徑）
- ✅ **無硬編碼的帳號密碼**

**檢查結果**: 所有前端 JavaScript 檔案均安全，無敏感資訊。

#### 伺服器洩密檢查
- ✅ `.env` 已在 `.gitignore` 中
- ✅ 資料庫檔案 (`db/*.db`) 已在 `.gitignore` 中
- ✅ 無 `.bak` 或 `.sql` 備份檔案在版本控制中
- ✅ `node_modules` 已正確排除

**檢查結果**: `.gitignore` 配置正確，無敏感檔案洩漏風險。

### ✅ [已通過] 不安全的檔案/目錄權限

**注意**: Windows 系統的檔案權限管理與 Unix/Linux 不同。

**建議**（若部署到 Linux 伺服器）:
```bash
# 資料庫檔案
chmod 600 db/queue.db

# .env 檔案
chmod 600 .env

# 目錄
chmod 755 public/
```

### ✅ [已通過] 應禁止下載的關鍵檔案

目前使用 Express static middleware，預設行為：
- ✅ `.env` 不在 `public/` 目錄內，無法直接下載
- ✅ `db/` 資料庫不在 `public/` 目錄內，無法直接下載
- ✅ `node_modules` 不在 `public/` 目錄內
- ✅ `server.js` 不在 `public/` 目錄內

**檢查結果**: 目錄結構安全，敏感檔案不可公開訪問。

---

## ⚠️ 第二部分：標準應用程式安全審計

### 威脅 #1: SessionStorage 認證機制的安全風險

**風險等級**: `中`

**威脅描述**:  
目前系統使用 `sessionStorage` 儲存認證資訊（`ui_agent_name`, `ui_agent_account`, `ui_agent_role`），並在前端透過 HTTP headers (`x-agent-account`, `x-agent-name`) 傳遞給後端進行認證。這種機制存在以下問題：

1. **易受 XSS 攻擊**: 如果攻擊者找到 XSS 漏洞，可以讀取 `sessionStorage` 中的認證資訊
2. **前端可篡改**: 使用者可以在瀏覽器開發者工具中修改 `sessionStorage` 內容
3. **無伺服器端狀態驗證**: 後端僅檢查帳號和姓名是否存在於資料庫，但沒有真正的 session 驗證

**受影響的元件**:
- `public/utils/auth-checker.js` (認證檢查模組)
- `public/login/index.html` (登入後儲存認證資訊)
- `public/agent/index.html` (使用認證 headers)
- `public/admin/agents.html` (使用認證 headers)
- `server.js` 中的 `requireAgentAuth` 中介軟體 (行 514-530)

**駭客攻擊劇本 (Hacker's Playbook)**:

> 我是一個普通櫃員，登入後我按下 F12 打開開發者工具。在 Console 中，我輸入：
> ```javascript
> sessionStorage.setItem('ui_agent_role', 'admin');
> location.reload();
> ```
> 
> 刷新頁面後，我發現我現在可以進入管理員介面了！雖然我無法通過 CSRF 驗證來修改其他管理員帳號（因為 CSRF token 機制仍然有效），但我可以看到所有櫃員的帳號資訊。
> 
> 更糟的是，如果我找到一個 XSS 漏洞（例如在姓名欄位），我可以注入腳本竊取其他使用者的 `sessionStorage` 資料，然後冒充他們的身份。

**修復原理 (Principle of the Fix)**:

認證不應該只依賴前端儲存的資訊。就像進入辦公大樓一樣，你不能只帶一張自己寫的「員工證」，而必須由大樓的門禁系統（後端）發放真正的門卡（session token 或 JWT），並且每次進入都要刷卡驗證。

目前的問題是：後端只檢查「這個人說他的名字是 John，資料庫裡確實有個叫 John 的人」，但沒有驗證「他是不是真的 John」。

**修復建議與程式碼範例**:

#### 方案 A: 使用 Express Session（推薦用於內部系統）

**步驟 1**: 安裝依賴
```bash
npm install express-session connect-sqlite3
```

**步驟 2**: 修改 `server.js`

```javascript
// 在檔案開頭添加
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

// 在 app.use(express.json()) 之後添加
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './db'
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProdEnv, // 生產環境要求 HTTPS
    httpOnly: true,     // 防止 JavaScript 存取
    maxAge: 8 * 60 * 60 * 1000, // 8 小時
    sameSite: 'lax'
  }
}));
```

**步驟 3**: 修改登入 API

```javascript
app.post('/api/login', loginLimiter, (req, res) => {
  // ... 現有的 captcha 和密碼驗證邏輯 ...
  
  // 驗證成功後，儲存到 session
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  
  // 儲存認證資訊到 session（伺服器端）
  req.session.agent = {
    id: user.id,
    account: user.account,
    name: user.name,
    counter: user.counter,
    role: user.role
  };
  
  // 回傳給前端（前端仍可儲存到 sessionStorage 用於 UI 顯示）
  return res.json({ 
    ok: true, 
    agent: req.session.agent 
  });
});
```

**步驟 4**: 修改認證中介軟體

```javascript
function requireAgentAuth(req, res, next) {
  // 改為檢查 server-side session
  if (!req.session || !req.session.agent) {
    return res.status(401).json({ error: 'unauthorized - not logged in' });
  }
  
  // 驗證帳號是否仍然有效
  const agent = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(req.session.agent.id);
  if (!agent) {
    req.session.destroy();
    return res.status(401).json({ error: 'unauthorized - account disabled' });
  }
  
  req.authenticatedAgent = agent;
  next();
}
```

**步驟 5**: 添加登出 API

```javascript
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'logout failed' });
    res.json({ ok: true });
  });
});
```

**步驟 6**: 更新 `.env.example`

```env
# Session 密鑰（生產環境必須設定）
SESSION_SECRET=請用 openssl rand -base64 32 生成
```

#### 方案 B: 使用 JWT（適合前後端分離或 API 導向系統）

這個方案更複雜，但提供更好的擴展性。如果需要此方案的詳細說明，請告知。

---

### 威脅 #2: DevTunnel URL 暴露於生產環境配置

**風險等級**: `中`

**威脅描述**:  
`.env` 檔案中包含 DevTunnel 的暫時性 URL (`https://your-tunnel-id.devtunnels.ms`)，且 `NODE_ENV` 設為 `production`。這代表：

1. **DevTunnel URL 可能會失效**: DevTunnel 的 URL 通常是暫時性的
2. **混淆開發與生產環境**: 使用 DevTunnel 但設定為 production 模式
3. **潛在的公開暴露**: 如果 DevTunnel 設定不當，系統可能對外網公開

**受影響的元件**:
- `.env` 檔案
- `server.js` 中的 CORS 和環境驗證邏輯

**修復建議**:

**選項 1: 開發測試環境**（目前狀態）
```env
PORT=7894
NODE_ENV=development
ALLOWED_ORIGINS=
PUBLIC_ORIGIN=
```

**選項 2: 正式部署環境**（使用自有網域）
```env
PORT=7894
NODE_ENV=production
ALLOWED_ORIGINS=https://queue.yourcompany.com
PUBLIC_ORIGIN=https://queue.yourcompany.com
```

**建議**:
1. 如果僅用於內部測試，請改用 `NODE_ENV=development`
2. 如果要正式部署，請使用固定的網域名稱
3. 考慮使用不同的 `.env` 檔案（`.env.development`, `.env.production`）

---

### 威脅 #3: CSRF 保護僅針對瀏覽器請求

**風險等級**: `低`

**威脅描述**:  
目前的 CSRF 保護機制只檢查帶有 `Origin` header 且在白名單中的請求。這意味著：

```javascript
function requireCsrf(req, res, next) {
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    // 只有這種情況才檢查 CSRF
    const token = req.headers['x-csrf-token'];
    if (!token) return res.status(403).json({ error: 'missing csrf token' });
    // ...
  }
  next(); // 其他情況直接通過
}
```

**潛在問題**:
- CLI 工具或 API 客戶端（無 Origin header）可以繞過 CSRF 檢查
- 雖然他們仍需要通過其他認證（如 `requireAgentAuth`），但這是設計上的不一致

**受影響的元件**:
- `server.js` 中的 `requireCsrf` 函數（行 678-686）
- 管理 API 端點（`/api/agents/*`）

**修復建議**:

這其實是一個設計決策問題。如果您希望：

**選項 A**: 允許 CLI/API 客戶端存取（目前行為）
- 保持現狀
- 在文件中明確說明此設計決策
- 確保其他認證機制（session/JWT）足夠強固

**選項 B**: 強制所有請求都需要 CSRF（更嚴格）
```javascript
function requireCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!token) return res.status(403).json({ error: 'missing csrf token' });
  
  const rec = csrfStore[token];
  if (!rec) return res.status(403).json({ error: 'invalid or expired csrf token' });
  
  next();
}
```

**我的建議**: 如果修復了威脅 #1（使用 server-side session），則目前的 CSRF 實現已經足夠。只需要在文件中說明清楚。

---

### 威脅 #4: 無密碼強度要求的 API 端點

**風險等級**: `低`

**威脅描述**:  
雖然前端 `InputValidator.validatePasswordStrength()` 有密碼強度檢查（至少 8 字元），但後端 API 端點（`POST /api/agents`, `PUT /api/agents/:id`）沒有強制執行密碼複雜度要求。

**受影響的元件**:
- `server.js` 中的 `POST /api/agents`（行 335-346）
- `server.js` 中的 `PUT /api/agents/:id`（行 353-362）
- `server.js` 中的 `PUT /api/agent/profile`（行 759-777）

**修復建議**:

在 `server.js` 中添加密碼驗證函數：

```javascript
// 在檔案開頭定義
function validatePassword(password) {
  if (typeof password !== 'string') return { valid: false, message: '密碼格式錯誤' };
  
  if (password.length < 8) {
    return { valid: false, message: '密碼長度至少需要 8 個字元' };
  }
  
  const hasNumber = /\d/.test(password);
  const hasLetter = /[a-zA-Z]/.test(password);
  
  if (!hasNumber || !hasLetter) {
    return { valid: false, message: '密碼必須包含字母和數字' };
  }
  
  return { valid: true };
}
```

在建立/更新帳號時使用：

```javascript
app.post('/api/agents', requireCsrf, (req, res) => {
  const { account, name, password, counter, role } = req.body || {};
  if (!account || !password) return res.status(400).json({ error: 'account and password required' });
  
  // 添加密碼驗證
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.message });
  }
  
  // ... 繼續原有邏輯
});
```

---

### 威脅 #5: Socket.IO 無認證機制

**風險等級**: `低`

**威脅描述**:  
Socket.IO 連線沒有認證機制。任何人都可以連接到 WebSocket 並接收即時事件（如叫號通知）。

```javascript
io.on('connection', (socket) => {
  socket.on('join', (room) => socket.join(room));
  socket.on('leave', (room) => {
    try { socket.leave(room); } catch (e) { /* noop */ }
  });
});
```

**潛在風險**:
- 未授權的使用者可以監聽叫號事件
- 可以加入任意 room
- 雖然目前只廣播公開資訊（叫號），但如果未來添加敏感資訊可能有問題

**受影響的元件**:
- `server.js` 中的 Socket.IO 設定（行 794-800）

**修復建議**:

如果您認為叫號資訊是公開的（大廳顯示幕也會看到），則可以保持現狀。

如果需要認證，可以添加：

```javascript
const { Server } = require('socket.io');

// 修改 Socket.IO 初始化
const io = new Server(server, { 
  cors: { origin: ALLOWED_ORIGINS },
  // 添加認證
  allowRequest: (req, callback) => {
    // 如果使用 session，可以共享 session middleware
    // 或者檢查 cookie/token
    callback(null, true); // 暫時允許所有連線
  }
});

// 在 connection 事件中驗證
io.use((socket, next) => {
  // 可以從 handshake 中取得 session 或 token
  const session = socket.handshake.session;
  if (!session || !session.agent) {
    return next(new Error('unauthorized'));
  }
  socket.agent = session.agent;
  next();
});
```

**我的建議**: 如果叫號資訊本來就是公開的，保持現狀即可。在文件中說明「Socket.IO 事件為公開資訊」。

---

### 威脅 #6: 無速率限制的 Socket.IO 事件

**風險等級**: `低`

**威脅描述**:  
雖然 HTTP API 有速率限制，但 Socket.IO 的 `join` 和 `leave` 事件沒有任何限制。惡意使用者可以快速加入/離開大量 rooms，造成伺服器資源耗盡。

**修復建議**:

```javascript
// 使用簡單的記憶體速率限制
const socketRateLimits = new Map();

function checkSocketRateLimit(socketId, maxPerMinute = 60) {
  const now = Date.now();
  const record = socketRateLimits.get(socketId) || { count: 0, resetAt: now + 60000 };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 60000;
  }
  
  record.count++;
  socketRateLimits.set(socketId, record);
  
  return record.count <= maxPerMinute;
}

io.on('connection', (socket) => {
  socket.on('join', (room) => {
    if (!checkSocketRateLimit(socket.id)) {
      socket.emit('error', { message: 'rate limit exceeded' });
      return;
    }
    socket.join(room);
  });
  
  socket.on('disconnect', () => {
    socketRateLimits.delete(socket.id);
  });
});

// 定期清理
setInterval(() => {
  const now = Date.now();
  for (const [socketId, record] of socketRateLimits.entries()) {
    if (now > record.resetAt + 60000) {
      socketRateLimits.delete(socketId);
    }
  }
}, 5 * 60 * 1000);
```

---

### ✅ [已通過] OWASP Top 10 (2021) 完整盤查

#### A01: 權限控制失效 (Broken Access Control)
- ⚠️ **部分問題**: 前端認證機制較弱（見威脅 #1）
- ✅ CSRF 保護已實現
- ✅ 管理 API 需要管理員角色
- ✅ 資料庫查詢有適當的過濾

#### A02: 加密機制失效 (Cryptographic Failures)
- ✅ 密碼使用 bcrypt 雜湊
- ✅ 無明文密碼儲存
- ⚠️ **建議**: 使用 HTTPS（生產環境必須）
- ⚠️ **建議**: SQLite 資料庫加密（可選，使用 SQLCipher）

#### A03: 注入式攻擊 (Injection)
- ✅ **完全使用 Prepared Statements**，無 SQL 注入風險
- ✅ 前端有 XSS 防護（HTML 實體編碼）
- ✅ 無 NoSQL 注入風險（使用 SQLite）
- ✅ 無 Command Injection（未使用 `exec`, `eval` 等）

#### A04: 不安全的設計 (Insecure Design)
- ✅ 有 Captcha 防止自動化攻擊
- ✅ 有速率限制防止暴力破解
- ⚠️ **部分問題**: 認證機制設計較簡單（見威脅 #1）

#### A05: 安全設定錯誤 (Security Misconfiguration)
- ✅ 有環境變數驗證
- ✅ 生產環境會警告不安全的配置
- ✅ 錯誤訊息不洩漏敏感資訊
- ✅ 有 CSP header
- ⚠️ **建議**: 添加更多安全 headers（見下方建議）

#### A06: 危險或過時的元件 (Vulnerable and Outdated Components)
- ✅ **npm audit 顯示 0 個漏洞**
- ✅ 所有套件版本較新
- ✅ 有 `package-lock.json` 鎖定版本

#### A07: 身份認證和驗證機制失效 (Identification and Authentication Failures)
- ✅ 有 Captcha 防止自動化
- ✅ 有速率限制（10 分鐘 30 次登入）
- ✅ 密碼雜湊強度足夠（bcrypt）
- ⚠️ **部分問題**: Session 管理較簡單（見威脅 #1）
- ⚠️ **建議**: 添加密碼複雜度要求（見威脅 #4）

#### A08: 軟體和資料完整性失效 (Software and Data Integrity Failures)
- ✅ 使用 npm lock file
- ✅ 無使用未驗證的外部腳本（CDN）
- ✅ 所有 JavaScript 均為本地檔案

#### A09: 安全記錄和監控失效 (Security Logging and Monitoring Failures)
- ⚠️ **部分實現**: 有基本日誌（CORS 拒絕、錯誤）
- ❌ **缺少**: 登入失敗記錄
- ❌ **缺少**: 敏感操作審計日誌（帳號建立、刪除）
- ❌ **缺少**: 集中式日誌管理

**建議**: 添加審計日誌

```javascript
// 在 server.js 開頭添加
const auditLog = [];
const MAX_AUDIT_LOGS = 1000;

function logAuditEvent(event) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...event
  };
  
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_LOGS) {
    auditLog.shift(); // 移除最舊的記錄
  }
  
  // 在生產環境可以寫入檔案或外部服務
  if (isProdEnv) {
    console.log('[AUDIT]', JSON.stringify(entry));
  }
}

// 使用範例
app.post('/api/login', loginLimiter, (req, res) => {
  // ... 驗證邏輯 ...
  
  if (!ok) {
    logAuditEvent({
      type: 'LOGIN_FAILED',
      account: account,
      ip: req.ip
    });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  
  logAuditEvent({
    type: 'LOGIN_SUCCESS',
    account: user.account,
    ip: req.ip
  });
  
  // ...
});

// 提供 API 查看審計日誌（僅限管理員）
app.get('/api/audit/logs', requireCsrf, (req, res) => {
  // 檢查管理員權限
  if (req.session.agent.role !== 'admin') {
    return res.status(403).json({ error: 'admin only' });
  }
  
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  res.json({ logs: auditLog.slice(-limit) });
});
```

#### A10: 伺服器端請求偽造 (SSRF)
- ✅ **無 SSRF 風險**: 系統不發起外部 HTTP 請求
- ✅ QR Code 生成使用本地函式庫

---

### 建議添加的安全 Headers

在 `server.js` 中添加：

```javascript
// 在現有的 CSP header 之後添加
app.use((req, res, next) => {
  // 現有的 CSP
  res.setHeader('Content-Security-Policy', "default-src 'self'; ...");
  
  // 額外的安全 headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // 如果使用 HTTPS
  if (isProdEnv) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // 移除 powered-by header
  res.removeHeader('X-Powered-By');
  
  next();
});

// 或使用 helmet 套件（更簡單）
// npm install helmet
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:", "https://r2cdn.perplexity.ai"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));
```

---

## 🔍 第三部分：大型專案特別策略

### 分析結果

您的專案規模適中（約 16 個 JavaScript 檔案，1 個主要後端檔案），**不需要**額外的自動化掃描工具。我已經透過以下方式完成完整審計：

1. ✅ 手動檢查所有 JavaScript 檔案
2. ✅ 使用 `grep_search` 搜尋敏感模式
3. ✅ 使用 `semantic_search` 尋找潛在風險
4. ✅ 檢查所有 HTML 檔案
5. ✅ 執行 `npm audit`
6. ✅ 檢查 `.gitignore` 和環境配置

**結論**: 無發現重複的高風險模式需要自動化掃描。

---

## 📊 風險總結與優先順序

### 高風險 (需立即修復)
**無發現**

### 中風險 (建議修復)
1. **威脅 #1**: SessionStorage 認證機制 → **建議實現 server-side session**
2. **威脅 #2**: DevTunnel URL 配置混淆 → **釐清環境設定**

### 低風險 (可選修復)
3. **威脅 #3**: CSRF 保護範圍 → **文件說明或強化**
4. **威脅 #4**: 密碼強度檢查 → **添加後端驗證**
5. **威脅 #5**: Socket.IO 認證 → **評估必要性**
6. **威脅 #6**: Socket.IO 速率限制 → **添加基本保護**
7. **審計日誌**: 添加登入失敗、帳號變更等事件記錄

### 建議改善
- 添加更多 HTTP 安全 headers
- 考慮使用 helmet 套件
- 生產環境強制 HTTPS
- 定期執行 `npm audit` 和 `npm update`

---

## ✅ 已通過的安全檢查項目

1. ✅ 無硬編碼的 API Key 或密碼
2. ✅ 環境變數管理正確
3. ✅ `.env` 已在 `.gitignore` 中
4. ✅ 資料庫檔案不在版本控制中
5. ✅ 全面使用 Prepared Statements（無 SQL 注入）
6. ✅ 密碼使用 bcrypt 雜湊
7. ✅ 有前端 XSS 防護工具
8. ✅ 有速率限制（防暴力破解）
9. ✅ 有 CSRF 保護
10. ✅ 有 Captcha 驗證
11. ✅ 有 CSP header
12. ✅ npm 套件無已知漏洞
13. ✅ 生產環境錯誤不洩漏敏感資訊
14. ✅ 有完整的安全文件
15. ✅ 有自動安全檢查腳本

---

## 🎯 建議的修復順序

### 第一階段（立即實施）
1. **修復威脅 #1**: 實現 server-side session 認證
   - 安裝 `express-session` 和 `connect-sqlite3`
   - 修改登入 API 和認證中介軟體
   - 測試所有功能仍正常運作

2. **修復威脅 #2**: 釐清環境配置
   - 決定使用開發或生產模式
   - 更新 `.env` 檔案
   - 執行 `npm run security-check` 確認

### 第二階段（本週內）
3. **添加威脅 #4**: 後端密碼強度驗證
4. **添加審計日誌**: 登入失敗、帳號操作記錄
5. **添加安全 headers**: 使用 helmet 或手動添加

### 第三階段（視需求）
6. **評估威脅 #5 和 #6**: 決定是否需要 Socket.IO 認證
7. **強化威脅 #3**: 如果需要，強化 CSRF 保護
8. **設定 HTTPS**: 生產環境必須使用 HTTPS

---

## 📚 額外建議與最佳實踐

### 1. 資料庫備份策略

建議建立自動備份腳本：

**scripts/backup-db.js**:
```javascript
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const DB_PATH = path.join(__dirname, '..', 'db', 'queue.db');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = dayjs().format('YYYYMMDD_HHmmss');
const backupPath = path.join(BACKUP_DIR, `queue_${timestamp}.db`);

fs.copyFileSync(DB_PATH, backupPath);
console.log(`Backup created: ${backupPath}`);

// 刪除 30 天前的備份
const files = fs.readdirSync(BACKUP_DIR);
const cutoff = dayjs().subtract(30, 'days');

files.forEach(file => {
  const filePath = path.join(BACKUP_DIR, file);
  const stats = fs.statSync(filePath);
  if (dayjs(stats.mtime).isBefore(cutoff)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted old backup: ${file}`);
  }
});
```

**package.json**:
```json
{
  "scripts": {
    "backup": "node scripts/backup-db.js"
  }
}
```

**Windows 排程**: 每天凌晨 3 點執行
```powershell
# 使用 Task Scheduler 或
# 簡單的 PowerShell 腳本
cd "C:\path\to\QMS"
npm run backup
```

### 2. 更新 `.gitignore`

```gitignore
# 現有內容...

# Backups
backups/
*.backup

# Temp files
*.swp
*~

# Session files
db/sessions.db
```

### 3. 環境變數範本

建議分開建立：

**.env.development.example**:
```env
PORT=3000
NODE_ENV=development
# 開發模式會自動允許 localhost，無需設定 ALLOWED_ORIGINS
ALLOWED_ORIGINS=
PUBLIC_ORIGIN=
```

**.env.production.example**:
```env
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://queue.yourcompany.com
PUBLIC_ORIGIN=https://queue.yourcompany.com
SESSION_SECRET=請用 openssl rand -base64 32 生成
```

### 4. 生產環境部署檢查清單（更新版）

```markdown
## 部署前檢查清單 v2.0

### 環境配置
- [ ] 已設定正確的 `.env` 檔案（使用 `.env.production.example` 範本）
- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET` 已設定（使用強隨機字串）
- [ ] `ALLOWED_ORIGINS` 僅包含 HTTPS URL
- [ ] 已執行 `npm run security-check` 無錯誤

### 認證與授權
- [ ] 已實現 server-side session（威脅 #1 修復）
- [ ] 已建立管理員帳號（`npm run create-admin`）
- [ ] 所有測試帳號已刪除或停用
- [ ] 管理員密碼符合強度要求（至少 8 字元，含字母和數字）

### 網路與伺服器
- [ ] 已設定 HTTPS（Nginx 反向代理）
- [ ] SSL 憑證已安裝且有效
- [ ] 防火牆僅開放必要埠（80, 443）
- [ ] Nginx 配置已添加安全 headers

### 資料保護
- [ ] 資料庫檔案權限設為 600 (`chmod 600 db/*.db`)
- [ ] 已設定自動備份（每日）
- [ ] 備份檔案儲存在安全位置
- [ ] 已測試備份還原流程

### 監控與日誌
- [ ] 已啟用審計日誌
- [ ] 已設定日誌輪替（避免檔案過大）
- [ ] 已測試登入失敗記錄功能
- [ ] 設定日誌告警（可選）

### 效能與可用性
- [ ] 使用 PM2 或類似工具管理程序
- [ ] 設定開機自動啟動
- [ ] 測試程序重啟後功能正常
- [ ] 設定健康檢查監控（`GET /api/health`）

### 最終測試
- [ ] 功能測試：取號、叫號、管理員操作
- [ ] 安全測試：登入、CSRF、速率限制
- [ ] 效能測試：並發使用者、長時間運行
- [ ] 備份測試：手動觸發備份並驗證
```

---

## 🎓 新手學習重點總結

### 您做得非常好的地方：

1. **環境變數管理**: 完美使用 `.env` 和 `.gitignore`
2. **密碼安全**: 正確使用 bcrypt，無明文密碼
3. **SQL 注入防護**: 100% 使用 Prepared Statements
4. **輸入驗證**: 完整的前端 XSS 防護工具
5. **速率限制**: 防止暴力破解和 DoS
6. **文件完整**: 詳細的 README 和安全文件

### 需要改進的地方：

1. **認證機制**: 從前端 sessionStorage 升級到後端 session
2. **環境配置**: 釐清開發與生產環境的界線
3. **密碼政策**: 後端也要驗證密碼強度
4. **審計日誌**: 記錄重要的安全事件

### 關鍵學習要點：

#### 💡 認證 vs 授權
- **認證 (Authentication)**: 你是誰？（登入）
- **授權 (Authorization)**: 你能做什麼？（權限）
- **永遠在伺服器端驗證**，不要相信前端

#### 💡 多層防禦 (Defense in Depth)
- 前端驗證 → 使用者體驗
- 後端驗證 → 真正的安全
- 兩者都要做！

#### 💡 信任邊界 (Trust Boundary)
- 前端 = 不可信任區域
- 後端 = 可信任區域
- 所有跨越邊界的資料都要驗證

---

## 📞 後續支援

### 如果您需要協助：

1. **實現 server-side session**: 我可以提供完整的程式碼範例
2. **設定 Nginx HTTPS**: 我可以提供完整的配置檔
3. **自動化備份腳本**: 我可以提供適合 Windows 的版本
4. **審計日誌系統**: 我可以提供完整的實現

### 定期維護建議：

- **每週**: 執行 `npm run security-check`
- **每月**: 執行 `npm audit` 和更新套件
- **每季**: 審查存取日誌，更新密碼
- **每年**: 全面安全審計

---

## 🎉 總評

### 安全等級評分：**B+ (良好)**

**優點**：
- ✅ 基礎安全實踐非常紮實
- ✅ 無嚴重的災難性錯誤
- ✅ 程式碼品質高，易於維護
- ✅ 文件完整，思慮周密

**改進空間**：
- 升級到 server-side session（從 B+ → A）
- 添加審計日誌（增強可追溯性）
- 生產環境使用 HTTPS（必須）

### 🏆 您已經超越了 80% 的新手開發者！

大多數新手常犯的錯誤（硬編碼密碼、SQL 注入、缺少驗證、敏感檔案洩漏等），您**完全沒有犯**。這非常難得！

只要修復本報告中的「中風險」項目，您的系統就可以安全地上線使用。

---

**審計完成日期**: 2025年10月1日  
**下次建議審計**: 2026年1月1日（或重大功能更新後）  
**審計人**: Senior Security Architect (AI Assistant)

---

## 附錄：快速修復指令

### 安裝必要套件
```powershell
cd "C:\path\to\QMS"
npm install express-session connect-sqlite3 helmet
```

### 執行安全檢查
```powershell
npm run security-check
```

### 生成 Session Secret
```powershell
# PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### 更新環境變數
```powershell
# 編輯 .env
notepad .env

# 添加這一行（使用上面生成的值）
# SESSION_SECRET=你生成的隨機字串
```

### 重新啟動服務
```powershell
# 停止現有服務（Ctrl+C）
# 然後
npm start
```

---

**祝您部署順利！🚀**

如有任何問題，請隨時詢問。
