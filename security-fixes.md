# 數位叫號系統 - 資安審計報告

**審計日期：** 2025年9月2日  
**審計師：** 資深資安顧問  
**專案狀態：** 開發階段（Vibe Coding 完成，準備上線前審計）

---

## 專案基本資訊

### 專案簡介
- **專案名稱：** 數位叫號嵌入式網頁模組
- **功能描述：** 可嵌入既有網站或資訊站的取號 Widget、櫃員端、大廳顯示系統
- **主要特色：** REST API、WebSocket 即時通知、SQLite 輕量資料庫、QR Code 取號/查詢

### 目標使用者
- **客戶端：** 一般民眾（透過 Kiosk 取號）
- **櫃員端：** 服務人員（叫號、管理、處理業務）
- **管理端：** 系統管理員（帳號管理）
- **大廳顯示：** 等候區民眾（查看叫號狀態）

### 處理的資料類型
- **個人身份資訊（PII）：** ✅ 是 - 處理客戶電話號碼
- **支付或財務資訊：** ❌ 否
- **用戶上傳內容（UGC）：** ❌ 否
- **敏感業務資料：** ✅ 是 - 服務類型、櫃台資訊、內部訊息

### 技術棧（Tech Stack）
- **前端：** 原生 HTML5/CSS3/JavaScript、Socket.IO 客戶端
- **後端：** Node.js + Express.js + Socket.IO
- **資料庫：** SQLite3 (better-sqlite3)
- **認證機制：** bcryptjs 密碼雜湊、圖形驗證碼 (svg-captcha)

### 部署環境/伺服器類型
- **開發環境：** Windows 本地 (localhost:3000)
- **生產環境：** 未明確指定，支援反向代理 (nginx, cloudflare 等)
- **隧道服務：** 使用 DevTunnels (https://your-tunnel-id.devtunnels.ms/)

### 外部依賴與服務
- **NPM 套件：** express, socket.io, better-sqlite3, bcryptjs, qrcode, svg-captcha, sharp, dayjs, cors, express-rate-limit, dotenv
- **外部 API 服務：** 無
- **雲端服務：** 無

---

## 第一部分：新手常見的災難性錯誤檢查

### ✅ 公開存取的敏感檔案檢查 - 通過
- **前端洩密檢查：** ✅ 通過 - 無硬編碼 API Key、密碼或敏感資訊
- **伺服器洩密檢查：** ✅ 通過 - 無資料庫備份檔、調試日誌等敏感檔案
- **.env 保護：** ✅ 通過 - 已正確加入 .gitignore

### ✅ 檔案權限檢查 - 通過
- **敏感檔案保護：** ✅ 通過 - .env 檔案已被 .gitignore 保護
- **資料庫檔案：** ✅ 通過 - SQLite 檔案已在 .gitignore 中

---

## 第二部分：中高風險安全問題

### 🔴 高風險 - XSS 攻擊風險：未過濾的 innerHTML 注入

**風險等級：** `高`

**威脅描述：** 
在多個前端頁面中發現 13 處直接使用 `innerHTML` 設置動態內容，且這些內容來自 API 回應或用戶輸入，存在跨站腳本攻擊（XSS）風險。攻擊者可以透過操控服務端資料或利用其他漏洞注入惡意腳本。

**受影響的元件：**
- `public/admin/agents.html` - 第 84, 86, 92, 95 行（帳號列表顯示）
- `public/agent/index.html` - 第 276, 311, 379, 391, 700 行（票券與歷史資料顯示）
- `public/lobby/index.html` - 第 28 行（叫號顯示）
- `public/ticket/index.html` - 第 135, 172 行（票券狀態顯示）
- `public/kiosk/index.html` - 第 110 行（摘要顯示）

**駭客攻擊劇本 (Hacker's Playbook):**
> 「我發現了一個有趣的攻擊路徑。雖然前端沒有直接的輸入漏洞，但我注意到櫃員端會顯示客戶提供的『電話號碼』和『姓名』等資訊。如果我能透過其他方式（比如直接操作資料庫，或是找到一個 SQL 注入點）將惡意 JavaScript 代碼插入到這些欄位中，那麼當櫃員查看客戶資料時，我的腳本就會在櫃員的瀏覽器中執行。更危險的是，如果我能把腳本注入到大廳顯示的叫號資訊中，那麼所有正在等候的客戶都會成為我的受害者。我的腳本可以竊取他們的 Session、重定向到釣魚網站，甚至利用他們的瀏覽器進行進一步攻擊。」

**修復原理 (Principle of the Fix):**
> 想像一下，`innerHTML` 就像是一個『萬能翻譯機』，它會把你給它的任何文字都當作『HTML 指令』來執行。如果壞人在文字中夾帶了 `<script>` 標籤，翻譯機就會乖乖地執行這些惡意指令。而 `textContent` 則像是一個『安全打字機』，它只會把文字當作『純文字』來顯示，不會執行任何指令。另一個解決方案是使用『消毒劑』（HTML sanitizer），它會檢查並清除文字中的危險成分，只留下安全的部分。

**修復建議與程式碼範例：**

1. **立即修復：將所有 innerHTML 改為 textContent**
```javascript
// ❌ 危險寫法
element.innerHTML = userProvidedData;

// ✅ 安全寫法
element.textContent = userProvidedData;
```

2. **如需顯示格式化內容，使用安全的 DOM 操作**
```javascript
// ❌ 危險寫法
wrap.innerHTML = `<div class="muted">錯誤: ${data.error}</div>`;

// ✅ 安全寫法
wrap.innerHTML = '';
const div = document.createElement('div');
div.className = 'muted';
div.textContent = `錯誤: ${data.error}`;
wrap.appendChild(div);
```

3. **使用 HTML sanitizer 庫（推薦）**
```bash
npm install dompurify
```
```javascript
// ✅ 使用 sanitizer
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userProvidedData);
```

---

### 🔴 高風險 - 敏感資訊透過錯誤訊息洩漏

**風險等級：** `高`

**威脅描述：** 
系統在多處直接將後端錯誤訊息暴露給前端用戶，可能洩漏資料庫結構、檔案路徑、內部邏輯等敏感資訊。

**受影響的元件：**
- `server.js` - 多處 `res.status(500).json({ error: err.message })` 
- 前端頁面顯示後端原始錯誤訊息

**駭客攻擊劇本 (Hacker's Playbook):**
> 「我開始對這個叫號系統進行偵察。我故意發送格式錯誤的 API 請求，觸發各種錯誤條件。太好了！錯誤訊息告訴我：『SQLITE_CONSTRAINT_UNIQUE: agents.account』，現在我知道資料庫使用 SQLite，有一個叫 `agents` 的表，帳號欄位有唯一性約束。繼續測試後，我從錯誤訊息中拼湊出了完整的資料庫架構。這些資訊大大降低了我尋找 SQL 注入漏洞的難度。」

**修復原理 (Principle of the Fix):**
> 錯誤訊息就像是你家的『內部設計圖』。對內部人員（開發者、管理員）來說，詳細的錯誤訊息很有用，能幫助快速定位問題。但對外部人員（一般用戶、潛在攻擊者）來說，這些資訊就像是『作案工具』。正確的做法是：對內部記錄詳細錯誤（用於除錯），對外部只顯示通用、無害的錯誤訊息。

**修復建議與程式碼範例：**

1. **建立統一的錯誤處理機制**
```javascript
// ✅ 安全的錯誤處理
function handleError(res, error, userMessage = '操作失敗') {
  // 記錄詳細錯誤供開發者查看
  console.error('Internal error:', error);
  
  // 只向用戶顯示通用錯誤訊息
  res.status(500).json({ error: userMessage });
}

// 使用範例
try {
  // 資料庫操作
} catch (err) {
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(400).json({ error: '帳號已存在' });
  }
  return handleError(res, err, '建立帳號失敗');
}
```

2. **生產環境隱藏敏感資訊**
```javascript
const isProd = process.env.NODE_ENV === 'production';

app.use((err, req, res, next) => {
  console.error(err.stack);
  
  const message = isProd ? '伺服器錯誤' : err.message;
  res.status(500).json({ error: message });
});
```

---

### 🟡 中風險 - CSRF 保護機制不完整

**風險等級：** `中`

**威脅描述：** 
雖然系統實作了 CSRF Token 機制，但保護範圍不完整。部分敏感操作（如密碼重設提示等）可能仍可被跨站請求偽造攻擊利用。

**受影響的元件：**
- `/api/agent/*` 路由群組
- 部分管理 API

**修復建議：**
1. 確保所有狀態變更的 API 都受 CSRF 保護
2. 考慮實作 SameSite Cookie 作為額外防護
3. 對敏感操作增加二次確認機制

---

### 🟡 中風險 - 缺少輸入長度限制

**風險等級：** `中`

**威脅描述：** 
系統對用戶輸入（如電話號碼、姓名、訊息內容）缺少適當的長度限制，可能導致資料庫溢出或 DoS 攻擊。

**修復建議：**
```javascript
// ✅ 新增輸入驗證
function validateInput(data) {
  if (data.phone && data.phone.length > 15) {
    throw new Error('電話號碼過長');
  }
  if (data.name && data.name.length > 50) {
    throw new Error('姓名過長');
  }
  // ... 其他驗證
}
```

---

## 第三部分：OWASP Top 10 合規性檢查

### A01: 權限控制失效 - ✅ 良好
- PIN 碼機制運作正常
- 會話管理適當
- 角色權限區分清楚

### A02: 加密機制失效 - ✅ 良好  
- 密碼使用 bcrypt 進行雜湊
- 建議檢查 HTTPS 實作

### A03: 注入式攻擊 - ✅ 良好
- 使用參數化查詢
- 無發現 SQL 注入風險

### A04: 不安全的設計 - ✅ 良好
- 整體架構設計合理

### A05: 安全設定錯誤 - 🟡 需注意
- CSP 設定偏寬鬆（允許 unsafe-inline）
- 建議加強生產環境設定

### A06: 危險或過時的元件 - ✅ 良好
- npm audit 顯示 0 個已知漏洞

### A07: 身份認證和驗證機制失效 - ✅ 良好
- 圖形驗證碼機制健全
- 登入限制適當

### A08: 軟體和資料完整性失效 - ✅ 良好
- 無使用 CDN 或外部腳本

### A09: 安全記錄和監控失效 - 🟡 需改善
- 建議增加更詳細的安全日誌

### A10: 伺服器端請求偽造 (SSRF) - ✅ 良好
- 無外部請求功能

---

## 優先修復建議

### 🔴 高優先級（立即修復）
1. **XSS 防護**：將所有 innerHTML 改為安全替代方案
2. **錯誤訊息處理**：建立統一的錯誤處理機制

### 🟡 中優先級（近期修復）  
1. **輸入驗證**：增加長度和格式限制
2. **CSP 強化**：移除 unsafe-inline，使用 nonce 或 hash
3. **安全日誌**：增加操作審計追蹤

### 🟢 低優先級（長期改善）
1. **監控機制**：實作異常行為偵測
2. **備份策略**：建立資料備份與恢復機制

---

## 總結

您的數位叫號系統在基礎安全架構方面表現良好，特別是在資料庫查詢安全、認證機制和依賴套件管理方面。主要風險集中在前端 XSS 防護和錯誤訊息處理，這些都是新手開發者常犯的錯誤，但也是相對容易修復的問題。

建議在上線前優先處理標記為「高風險」的問題，這將大幅提升系統的整體安全性。系統已具備良好的安全基礎，經過適當的修復後，可以安全地投入生產環境使用。

**最後提醒：** 在正式上線前，請確保：
1. 使用強健的 AGENT_PIN
2. 啟用 HTTPS 
3. 設定適當的防火牆規則
4. 建立定期備份機制

---
**審計完成日期：** 2025年9月2日  
**下次建議審計：** 3個月後或重大功能更新時
