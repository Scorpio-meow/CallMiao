# 🔒 數位叫號系統 - 完整安全審計報告

**審計日期**: 2025年10月2日  
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
  - 櫃員端服務管理（Agent）
  - 大廳顯示叫號（Lobby）
  - 票券狀態查詢（Ticket）
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
  - `helmet` (安全標頭)
  - `express-rate-limit` (速率限制)
  - 自訂 CSRF 保護

#### 資料庫
- **類型**: SQLite 3
- **ORM**: better-sqlite3
- **資料表**:
  - `tickets` (票券資料)
  - `agents` (櫃員資料)
  - `seq` (流水號)

### 部署環境/伺服器類型
- **目前環境**: DevTunnel (開發測試)
- **計劃環境**: 生產環境 (需要安全配置)

### 外部依賴與服務

#### NPM 套件列表 (package.json)
**生產依賴**:
- bcryptjs: ^3.0.2 (密碼雜湊)
- better-sqlite3: ^9.6.0 (SQLite 資料庫)
- connect-sqlite3: ^0.9.16 (Session 儲存)
- cors: ^2.8.5 (跨域資源共享)
- dayjs: ^1.11.13 (日期處理)
- dotenv: ^16.4.5 (環境變數)
- express: ^4.19.2 (Web 框架)
- express-rate-limit: ^7.4.0 (速率限制)
- express-session: ^1.18.2 (Session 管理)
- helmet: ^8.1.0 (安全標頭)
- qrcode: ^1.5.4 (QR 碼生成)
- sharp: ^0.34.3 (圖片處理)
- socket.io: ^4.7.5 (即時通訊)
- svg-captcha: ^1.4.0 (驗證碼)

**開發依賴**:
- nodemon: ^3.1.7 (開發伺服器)

#### 外部 API 服務
- 無使用外部 API 服務

#### 使用的雲端服務
- DevTunnel (開發測試用)

---

## ⚠️ 安全威脅評估與修復建議

### 🔴 威脅 #1: SessionStorage 認證機制殘留 → **中風險**

* **風險等級**: `中`
* **威脅描述**: 雖然後端已改用安全的 server-side session 認證機制，但前端程式碼仍大量使用 sessionStorage 來儲存和讀取認證資訊，這可能在未來造成混淆或被惡意利用。
* **受影響的元件**: 
  - `public/login/index.html` (行 86-93)
  - `public/agent/index.html` (行 222-223)
  - `public/admin/agents.html` (行 193-196, 356-359)
  - `public/utils/auth-checker.js` (行 22, 37-41, 49)

* **修復建議與程式碼範例**:
  1. **保留 sessionStorage 僅用於 UI 顯示目的，明確標註用途**
  2. **確保所有實際認證都透過後端 session 進行**
  3. **在註解中明確說明 sessionStorage 不用於安全認證**

```javascript
// ✅ 正確做法：明確標註用途
// 注意：此資料僅用於 UI 顯示，實際認證依賴後端 session
sessionStorage.setItem('ui_agent_name', display); // UI 顯示用，非認證用

// ❌ 避免：模糊的命名可能造成安全誤解
sessionStorage.setItem('ui_agent_name', display);
```

---

### 🔴 威脅 #2: .env 檔案在 Git 歷史中的潛在洩漏 → **高風險**

* **風險等級**: `高`
* **威脅描述**: 雖然目前 .env 檔案已正確設定在 .gitignore 中，但如果之前曾經被提交到 Git 歷史中，敏感資訊（如 SESSION_SECRET）仍可能被存取。
* **受影響的元件**: 
  - `.env` 檔案 (包含 SESSION_SECRET 和 DevTunnel URL)
  - Git 版本控制歷史

**(--- 高風險專屬區塊 ---)**

* **駭客攻擊劇本 (Hacker's Playbook):**
  > 我是一個有權限存取你 Git 倉庫的攻擊者（可能是內部人員或獲得存取權限）。即使你現在把 .env 加入 .gitignore，我仍然可以使用 `git log --all --full-history -- .env` 來搜尋是否有任何提交曾經包含這個檔案。如果找到了，我就能使用 `git show <commit-hash>:.env` 來查看那個時候的 .env 內容，取得你的 SESSION_SECRET 和其他敏感設定。有了這些資訊，我就能偽造 session cookies 或使用你的外部服務憑證。

* **修復原理 (Principle of the Fix):**
  > Git 就像是一個「時光機器」，它記住了所有的歷史變化。即使你現在把秘密藏起來（加入 .gitignore），時光機器裡仍然保存著過去的「快照」。要真正解決這個問題，你需要：1）檢查歷史中是否真的有洩漏，2）如果有洩漏，更換所有受影響的秘密值，3）考慮清理 Git 歷史（但會影響所有協作者）。最重要的是，這提醒我們「預防勝於治療」—— 從一開始就不要提交秘密到版本控制中。

**(--- 專屬區塊結束 ---)**

* **修復建議與程式碼範例**:
  1. **檢查 Git 歷史是否有 .env 洩漏**
  ```powershell
  # 檢查是否曾經提交過 .env
  git log --all --full-history -- .env
  git log --all --full-history -- "*.env"
  
  # 如果找到提交，檢查內容
  git show <commit-hash>:.env
  ```

  2. **立即更換所有可能洩漏的秘密值**
  ```powershell
  # 生成新的 SESSION_SECRET
  [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
  ```

  3. **重設所有管理員密碼**
  ```powershell
  npm run reset-admin -- --generate
  ```

---

### 🔴 威脅 #3: 開發環境配置用於 DevTunnel 場景 → **中風險**

* **風險等級**: `中`
* **威脅描述**: 目前配置 `NODE_ENV=development` 但同時使用 DevTunnel URL，這種配置混合可能導致安全設定不一致，開發模式下的寬鬆安全檢查可能在公開環境中造成風險。
* **受影響的元件**: 
  - `.env` 檔案 (NODE_ENV=development 配置)
  - DevTunnel 公開存取 URL

* **修復建議與程式碼範例**:
  1. **依據實際使用場景調整環境設定**

  **開發測試環境** (.env):
  ```env
  NODE_ENV=development
  # 本地開發，不需要設定 ALLOWED_ORIGINS
  PORT=7894
  ```

  **DevTunnel 測試環境** (.env):
  ```env
  NODE_ENV=production
  PORT=7894
  ALLOWED_ORIGINS=https://your-tunnel-id.devtunnels.ms
  PUBLIC_ORIGIN=https://your-tunnel-id.devtunnels.ms
  SESSION_SECRET=<你的安全密鑰>
  ```

---

### 🟡 威脅 #4: SQLite 資料庫檔案權限設定 → **中風險**

* **風險等級**: `中`
* **威脅描述**: SQLite 資料庫檔案（queue.db, sessions.db）位於專案目錄中，如果部署到生產環境時檔案權限設定不當，可能被未授權存取。
* **受影響的元件**: 
  - `db/queue.db` (主要資料庫)
  - `db/sessions.db` (session 資料)
  - `db/queue.db-wal`, `db/queue.db-shm` (SQLite WAL 檔案)

* **修復建議與程式碼範例**:
  1. **設定適當的檔案權限（Linux/macOS）**
  ```bash
  chmod 600 db/*.db
  chmod 700 db/
  ```

  2. **Windows 環境的權限設定**
  ```powershell
  # 移除繼承權限，只保留擁有者存取權
  icacls "db\*.db" /inheritance:r
  icacls "db\*.db" /grant:r "%USERNAME%:(R,W)"
  ```

  3. **確保 Web 伺服器無法直接存取資料庫檔案**
  - 配置 Nginx/Apache 禁止存取 `/db/` 路徑
  - 或將資料庫移至 Web 根目錄外

---

### 🟡 威脅 #5: CORS 配置開發便利性設定 → **低風險**

* **風險等級**: `低`
* **威脅描述**: 開發模式下自動允許所有 localhost 連線雖然方便開發，但可能在錯誤配置的情況下帶來安全風險。
* **受影響的元件**: 
  - `server.js` CORS 配置 (行 182-187)

* **修復建議與程式碼範例**:
  1. **已實現的安全機制很好，建議保持現狀**
  2. **確保生產環境正確設定**
  ```javascript
  // ✅ 目前的實現已經很安全
  if (!isProdEnv) {
    const isLocalhost = origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
    if (isLocalhost) return cb(null, true);
  }
  ```

---

### 🟢 威脅 #6: 密碼儲存與認證機制 → **安全**

* **風險等級**: `低`
* **威脅描述**: 經檢查，密碼使用 bcrypt 正確雜湊儲存，認證機制已從不安全的 header-based 改為安全的 server-side session。
* **受影響的元件**: 
  - 密碼雜湊: `bcrypt.hashSync(password, 10)`
  - Session 認證: `requireAgentAuth` 中介軟體

* **修復建議與程式碼範例**:
  ✅ **目前實現已符合最佳實踐，無需修復**

---

### 🟢 威脅 #7: SQL 注入防護 → **安全**

* **風險等級**: `無`
* **威脅描述**: 經全面檢查，所有資料庫查詢都使用參數化查詢（prepared statements），有效防範 SQL 注入攻擊。
* **受影響的元件**: 
  - 所有使用 `db.prepare()` 的查詢

* **修復建議與程式碼範例**:
  ✅ **目前實現已符合最佳實踐，無需修復**

---

### 🟢 威脅 #8: 相依性安全 → **安全**

* **風險等級**: `無`
* **威脅描述**: 執行 `npm audit` 檢查顯示 "found 0 vulnerabilities"，所有相依套件都是最新且安全的版本。
* **受影響的元件**: 
  - 所有 npm 套件

* **修復建議與程式碼範例**:
  ✅ **目前所有套件安全，建議定期執行 `npm audit` 檢查**

---

### 🟢 威脅 #9: 輸入驗證與 XSS 防護 → **安全**

* **風險等級**: `無`
* **威脅描述**: 專案已實現完整的前端輸入驗證工具 (`input-validator.js`)，包含 HTML 實體編碼和各種輸入清理功能。
* **受影響的元件**: 
  - `public/utils/input-validator.js`

* **修復建議與程式碼範例**:
  ✅ **輸入驗證機制完善，建議在所有用戶輸入處使用**

---

## 📊 安全評估總結

### 風險分佈
- **高風險**: 1 項 (Git 歷史洩漏)
- **中風險**: 3 項 (SessionStorage 殘留、環境配置、檔案權限)
- **低風險**: 1 項 (CORS 開發設定)
- **安全**: 4 項 (密碼儲存、SQL 注入防護、相依性、輸入驗證)

### 🏆 安全亮點
1. ✅ **優秀的認證機制**: 已從不安全的 header-based 認證升級為安全的 server-side session
2. ✅ **完善的輸入驗證**: 實現了專業級的前端輸入清理工具
3. ✅ **SQL 注入防護**: 100% 使用參數化查詢
4. ✅ **相依性管理**: 所有套件都是安全版本
5. ✅ **密碼安全**: 使用 bcrypt 正確雜湊儲存

### 🎯 優先修復建議
1. **立即行動**: 檢查 Git 歷史是否有 .env 洩漏，如有則更換所有秘密值
2. **短期改善**: 清理 sessionStorage 使用，明確標註用途
3. **部署前**: 根據實際環境設定正確的 NODE_ENV 和 CORS 配置
4. **生產環境**: 設定適當的檔案權限保護資料庫

---

## 💡 最佳實踐建議

### 開發階段
- 定期執行 `npm run security-check`
- 使用 `npm audit` 檢查相依性漏洞
- 確保新功能都使用現有的安全工具（input-validator.js 等）

### 部署階段
- 遵循 `SECURITY-DEPLOYMENT.md` 檢查清單
- 設定適當的檔案權限
- 配置 HTTPS 和安全 headers

### 維護階段
- 定期更新相依套件
- 監控錯誤日誌中的安全事件
- 定期檢查 session 和認證機制

---

## 🔍 建議的後續行動

基於此次審計結果，建議開發團隊：

1. **立即檢查 Git 歷史洩漏風險**
2. **制定敏感資訊洩漏應對計畫**
3. **建立定期安全檢查流程**
4. **為生產部署準備詳細的安全配置文件**

**總體評估**: 🟢 **這是一個安全意識很強的專案**，大部分安全機制都已正確實施。發現的問題主要是配置和歷史遺留問題，而非根本性的安全缺陷。經過建議的修復後，此系統可以安全地部署到生產環境。

---

**審計完成時間**: 2025年10月2日  
**審計員**: 資深安全架構師
