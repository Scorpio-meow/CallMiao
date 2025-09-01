# 資安審計報告（Go-Live 前）

本報告以「新手最常犯的錯誤」視角，對「數位叫號嵌入式網頁模組」（digital-queue-widget）進行全面審計；內容包含公開檔案、認證與授權、PII 保護、OWASP Top 10 盤點、供應鏈與基礎設施建議，並提供可立即落地的修復步驟與範例。

---

## 專案簡介等基本資訊
- 專案名稱與簡介：數位叫號嵌入式網頁模組（Kiosk/Agent/Lobby + REST API + WebSocket + SQLite）
- 目標使用者：
  - 櫃員（Agent）、大廳顯示（Lobby）、臨櫃取號使用者（Kiosk）
- 處理的資料類型：
  - 是否處理個人身份資訊（PII）？是（電話號碼）
  - 是否處理支付或財務資訊？否
  - 是否有用戶上傳內容（UGC）？否（無檔案上傳）
- 技術棧（Tech Stack）：
  - 前端：原生 HTML/CSS/JS + Socket.IO（多頁）
  - 後端：Node.js + Express + Socket.IO + better-sqlite3
  - 資料庫：SQLite（WAL 模式）
- 部署環境/伺服器類型：未提供（推測一般 Node 服務；建議前置反向代理 + TLS）
- 外部依賴與服務：
  - NPM 套件：bcryptjs, better-sqlite3, cors, dayjs, express, qrcode, sharp, socket.io, svg-captcha（dev：nodemon）
  - 外部 API 服務：無（QR Code 本地生成）
  - 使用的雲端服務：未提供
- 程式碼存取：以當前工作區檔案為準（未連結外部 repo）

需釐清/請補充（請在回覆中提供）：
- 部署環境（雲端/自架、是否有反向代理與 TLS、是否多實例）
- 是否有外部資料庫或雲端儲存（若有，請提供 VPC/防火牆白名單、私有化設定、金鑰限制）
- 正式上線允許的前端網域清單（供 CORS/Socket.IO 收斂）

---

## 第一部分：新手常見的災難性錯誤檢查（Disaster-Class）

本區列出「若放上公網，最容易釀災」的點；含攻擊劇本與修復原理。

### 威脅標題：高風險 - 管理/代理授權依賴「靜態 PIN + Web 儲存」
- 風險等級：高
- 威脅描述：系統使用 Header `x-agent-pin` 比對 `AGENT_PIN` 來保護管理與代理端 API。前端（admin/agent）將 PIN 與 CSRF token 存於 `sessionStorage`。一旦發生任何 XSS，攻擊者可直接竊取 PIN 並遠端呼叫所有敏感 API（新增/刪除帳號、叫號、結束服務）。
- 受影響的元件：`server.js` `requirePin`、`public/admin/agents.html`（sessionStorage 持有 PIN/CSRF）、`public/agent/index.html`（以 PIN 取得受保護 API）。

（--- 高風險專屬區塊 ---）
- 駭客攻擊劇本：
  > 我先找任何能插入腳本的地方（或釣管理員打開惡意頁）。因為網站允許 `unsafe-inline`，只要某個頁面有細小的 DOM 注入點，我就能埋入 `<script>`。一旦腳本在管理頁跑起來，我直接讀 `sessionStorage.admin_pin` 與 `sessionStorage.admin_csrf`，接著從我電腦用這些值呼叫 `/api/agents`、`/api/agent/*`，整個系統任我擺佈。

- 修復原理：
  > 秘密不應存於可被 JS 讀取的儲存區（local/sessionStorage）。改用「伺服器簽發的 HttpOnly Cookie（JWT/Session）」攜帶授權資訊，JS 無法讀取；再搭配嚴格 CSP（移除 `unsafe-inline`）大幅降低被植入腳本的機會。
（--- 專屬區塊結束 ---）

- 修復建議與程式碼範例：
  1) 短期（P0）：保留 PIN 機制但減少暴露
     - 將 admin/agent 前端避免長期保存 PIN；只在互動當下向使用者索取，並存在記憶體變數，頁籤關閉即失效。
     - 為所有敏感端點加上速率限制與詳細審計日誌。
  2) 中期（P1）：導入標準登入
     - 建立 `/api/auth/login` 發 JWT，使用 HttpOnly + SameSite=Strict Cookie；新增 `requireAuth` 檢查與角色（agent/admin），替換 `requirePin`。
  3) 長期（P2）：
     - 關閉 `unsafe-inline`，統一改為外掛腳本並使用 CSP nonce/hash；整合 `helmet`。

---

### 威脅標題：高風險 - CSP 過寬（允許 `unsafe-inline`）放大 XSS 風險
- 風險等級：高
- 威脅描述：目前以中介層設定 `Content-Security-Policy` 且包含 `script-src 'self' 'unsafe-inline'`、`style-src 'self' 'unsafe-inline'`。任何可控字串被 `innerHTML` 插入 DOM 時，一旦轉義遺漏或第三方腳本/插件漏洞，容易被利用為 XSS；在本系統，XSS 會直接導致 PIN/CSRF 被竊，等同系統淪陷。
- 受影響的元件：全站（`server.js` 設定之 CSP 與所有前端頁面）。

（--- 高風險專屬區塊 ---）
- 駭客攻擊劇本：
  > 我只要找到能反射或儲存一段 `<img src=x onerror=...>` 的地方，就能在使用者的瀏覽器執行任意 JS。因為 CSP 放行了 inline script，我不需要再繞其他防線。拿到管理員的 PIN 之後，我就能遠端操控你的後台。

- 修復原理：
  > 把「任何行內腳本」視為違法。只允許外掛檔案 + nonce/hash，這樣即使有可控字串插入 DOM，也難以升級為可執行的 JS。
（--- 專屬區塊結束 ---）

- 修復建議與程式碼範例：
  - 移除 inline `<script>` 與 `<style>`，搬到 `/public/.../*.js|*.css`。
  - 使用 `helmet` 設定：`script-src 'self' 'nonce-<random>'`；後端動態注入 nonce；前端 script 標上對應 nonce。
  - 將 `font-src` 的外站 `r2cdn.perplexity.ai` 移除（非必要且引入追蹤/隱私風險）。

---

### 威脅標題：中風險 - 敏感 API 的單點憑證（PIN）缺少行為防護
- 風險等級：中
- 威脅描述：login/captcha/qrcode 及所有受保護 API 未設速率限制；Captcha 與 CSRF token 採記憶體 store，雖有 TTL 清理，仍可能被濫用造成資源耗用與記憶體壓力。
- 受影響的元件：`/api/login`、`/api/captcha/*`、`/api/qrcode`、`/api/admin/*`、`/api/agent/*`。
- 修復建議：導入 `express-rate-limit`；為 captcha/CSRF store 設最大容量或改用 Redis；qrcode 端點可加入簡單節流和大小限制。

---

### 威脅標題：中風險 - 前端 innerHTML/模板插入未全面轉義
- 風險等級：中
- 威脅描述：`admin/agents.html` 與 `agent/index.html` 多處以 template string 建立 HTML 並插入 DOM。雖目前回傳資料多為受控欄位，但長期而言風險在於未來新增欄位或顯示備註類內容時遺漏轉義，導致 XSS。
- 受影響的元件：`public/admin/agents.html`、`public/agent/index.html` 等。
- 修復建議：若不得不用 innerHTML，統一先以 `escapeHTML()` 轉義後再插入；優先改為以 `textContent`/屬性指派方式渲染。

---

### 已即時修補（本次我已代為完成）
- 修補 1：`GET /api/agents/:id` 現已加上 `requirePin` 授權保護（避免列舉單筆代理資訊）。
- 修補 2：`.gitignore` 已擴充忽略 `.env`、SQLite DB 與日誌等敏感/大型檔案（避免誤提交）。

驗證現況（對照原始碼）：
- PII 泄露：
  - `/api/tickets/waiting` 僅回 `id, serviceType, number, status, createdAt`，不含 phone（已安全）。
  - `/api/ticket/:id` 會剝除 `phone` 後回傳（`const { phone, ...rest } = row`）（已安全）。
- 登入：`/api/login` 需 Captcha 並以 bcrypt 驗證帳密，不存在「帳號不存在仍 ok」的 fallback（已安全）。
- CORS：由 `ALLOWED_ORIGINS` 控制，預設為 `http://localhost:3000`，建議上線前以環境變數收斂至正式網域。

---

## 第二部分：標準應用程式安全審計（對應 OWASP Top 10）

- A01 權限控制失效：
  - 高：敏感操作只靠靜態 PIN；前端以 sessionStorage 存 PIN，遇到 XSS 可被奪取。
  - 中：本次已補上 `/api/agents/:id` 保護；其餘受保護端點均有 `requirePin`。
- A02 加密機制失效：
  - 建議：前置反向代理提供 TLS（HTTPS/WSS）與 HSTS；Cookie 模式上線後配合 `Secure`。
- A03 注入式攻擊：
  - SQL：全部使用參數化查詢（風險低）。
  - XSS：CSP 過寬 + innerHTML 未統一轉義（中高風險）。
- A04 不安全的設計：
  - 使用靜態 PIN 作長期授權；建議改為標準登入/會話（JWT/Cookie）。
- A05 安全設定錯誤：
  - CSP 放行 `unsafe-inline`；缺少 `helmet` 與速率限制。
- A06 危險或過時元件：
  - 建議執行 `npm audit --production`、`npm outdated`，依報告升級；CI 納入 SCA。
- A07 身份認證機制失效：
  - 尚未導入標準會話；目前使用 PIN。
- A08 軟體與資料完整性失效：
  - 可在 CI 中加入建置完整性與檔案簽章（若有供應鏈需求）。
- A09 安全記錄與監控失效：
  - 建議加入 request/security audit log、告警與追蹤。
- A10 SSRF：
  - 目前無外部抓取；若未來新增 URL 代理需白名單與協定限制。

---

## 業務邏輯漏洞（Business Logic）
- 對票券「本人查詢」未使用不可猜測 token。建議：發行 `ticketToken`（QR 內含）作為查看票券詳情與進度的唯一憑證，避免可預測自增 id 被撞。
- 代理操作依賴 PIN，沒有人員個別追蹤。建議：改以帳號登入 + 角色，審計紀錄指向個人。

---

## 依賴與供應鏈安全
- 建議：
  - 執行 `npm audit --production`、`npm outdated`，升級有 CVE 的套件。
  - 使用 `npm ci` 確保可重現建置；CI 納入 SCA（Snyk/OWASP Dependency-Check）。

---

## 資料庫與資料流安全
- 傳輸中：上線時務必走 HTTPS/WSS。
- 靜態資料：SQLite 明文保存電話，主機遺失時可能外洩。建議：
  - 最小化保存（只存必要資訊）；
  - 或改以拆分/雜湊（搭配後四碼驗證流程）。
- OS 權限：Node 服務帳號最小化；DB 目錄限制讀寫（避免 777；檔案 640、目錄 750 起）。

---

## 外部服務與 API 整合安全（預備事項）
若未來接雲端/外部 API，請先確認：
1) 防火牆/IP 白名單是否最小化（嚴禁 0.0.0.0/0）？
2) API 金鑰是否限制來源/可呼叫的 API 範圍？
3) 是否有降級計畫（關閉功能/維護頁）？

---

## 基礎設施與維運安全
- 反向代理：建議 Nginx/Traefik 置前，統一處理 TLS、HSTS、CSP、安全標頭、上傳大小限制。
- 日誌/監控：morgan/winston 安全日誌（注意敏感欄位遮罩），錯誤告警（Sentry/Elastic/APM）。
- 健康檢查：`/api/health` 已有；可加 readiness/liveness 區分容器就緒與存活。
- 靜態檔案：Express 只暴露 `/public`；務必確保 `.env`、`.git`、`db/` 不透過 Web 伺服器對外（反代層同樣要 deny）。

---

## 修復建議與程式碼範例（可落地清單）

P0（立刻）
1) 收斂 CORS/Socket.IO：設定 `ALLOWED_ORIGINS` 為正式網域清單。
2) 敏感端點速率限制：以 `express-rate-limit` 保護 `/api/login`、`/api/captcha/*`、`/api/qrcode`、`/api/admin/*`、`/api/agent/*`。
3) 前端避免長期保存 PIN：移除 `sessionStorage` 持久保存，僅暫存於記憶體或每次操作再次輸入。

P1（本週）
4) XSS 硬化：
   - 將 inline `<script>`/`<style>` 外掛化；
   - server 端 CSP 改用 nonce/hash 並移除 `unsafe-inline`；
   - 統一以 `escapeHTML()` 處理 innerHTML 插入。
5) 安全標頭：導入 `helmet`（包含 HSTS、X-Frame-Options、Referrer-Policy、X-Content-Type-Options 等）。
6) 管理/代理審計：記錄新增/修改/刪除與叫號等操作，包含來源 IP/帳號。

P2（本月）
7) 把 PIN 模式升級為標準登入：JWT + HttpOnly Cookie + 角色權限（admin/agent），以 `requireAuth` 取代 `requirePin`。
8) PII 最小化/拆分保存；評估將 SQLite 移至受管 DB 或至少落地在加密磁碟。
9) CI SCA：`npm audit`、Snyk/Dependency-Check 自動掃描與阻擋高風險發佈。

最小 HTML 轉義工具（前端）
```js
function escapeHTML(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
```

Nginx（反向代理）禁止敏感路徑（示意）
```nginx
location ~ /\.(env|git|htaccess) { deny all; }
location /db/ { deny all; }
```

---

## 第三部分：大型專案特別策略
- 分段檢核建議：
  - 依模組拆解推進（認證/授權 → CSP/前端外掛化 → PII/資料保護），每段建立驗收清單與回歸測試。
- 自動化掃描（請求授權）：
  - 我發現了可重複的風險模式（inline script、innerHTML、PIN 儲存、PII 欄位）。為確保覆蓋率，是否同意我生成一個只讀 RegEx 掃描腳本來搜尋：
    - 任何 `innerHTML =`、`insertAdjacentHTML`、模板字面插入 DOM；
    - 回傳 `phone` 的 API；
    - `unsafe-inline` 與外站 `font-src`；
    - `sessionStorage`/`localStorage` 儲存敏感資訊。

---

## 變更紀錄（本次代辦事項）
- 已修：`GET /api/agents/:id` 改為 `requirePin` 保護。
- 已修：`.gitignore` 新增 `.env`、SQLite 與 log 相關忽略規則。

---

## 結語與後續
目前最急迫的是關閉 `unsafe-inline` 與將 PIN/授權從 Web 儲存搬離；完成 P0 之後再導入標準登入與 CSP 外掛化。請回覆部署環境與正式網域清單，我會根據你的情境提供精準的 `helmet`/CSP/反向代理範本與（若你同意）自動化掃描腳本。
