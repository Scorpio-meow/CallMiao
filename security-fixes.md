# 資安審計報告（Go-Live 前）

本報告針對「數位叫號嵌入式網頁模組」（digital-queue-widget）進行新手常見錯誤為主軸的全面檢視，涵蓋公開檔案、權限與認證、資料洩漏、OWASP Top 10、供應鏈與基礎設施建議，並提供可立即落地的修復步驟與程式碼範例。

---

## 專案簡介等基本資訊
- 專案名稱與簡介：數位叫號嵌入式網頁模組（Kiosk/Agent/Lobby + REST API + WebSocket + SQLite）
- 目標使用者：
  - 櫃員（Agent）、大廳顯示（Lobby）、臨櫃取號使用者（Kiosk）
- 處理的資料類型：
  - 是否處理個人身份資訊（PII）？是（電話號碼）
  - 是否處理支付或財務資訊？否（目前未見）
  - 是否有用戶上傳內容（UGC）？否（未見檔案上傳）
- 技術棧（Tech Stack）：
  - 前端：原生 HTML/CSS/JS + Socket.IO 用戶端（多頁）
  - 後端：Node.js + Express + Socket.IO + better-sqlite3
  - 資料庫：SQLite（WAL 模式）
- 部署環境/伺服器類型：未提供（預設本機或一般 Node 服務；建議前置反向代理 Nginx/TLS）
- 外部依賴與服務：
  - NPM 套件：bcryptjs, better-sqlite3, cors, dayjs, express, qrcode, sharp, socket.io, svg-captcha, nodemon（dev）
  - 外部 API 服務：未見（QRCode 本地生成）
  - 使用的雲端服務：未提供
- 程式碼存取：本報告以工作區現有檔案為準（未連結外部 repo）

需釐清/請補充（寫在這裡以便後續調整風險等級與控制措施）：
- 部署環境（雲端/自架機、是否有反向代理與 TLS、是否多實例）
- 是否有外部資料庫或雲端儲存（若有，請提供：VPC/防火牆白名單、私有化設定、存取金鑰限制）
- 是否需要對外開放 API（跨網域）與正式前端網域清單

---

## 第一部分：新手常見的災難性錯誤檢查（重點）

### 威脅標題：高風險 - 管理/代理端保護繞過（x-agent-name Header 即通行）
- 風險等級：高
- 威脅描述：`requirePin` 驗證允許只要請求含 `x-agent-name` 頭就視為通過（即使 `x-agent-pin` 不正確或缺失）；攻擊者可直接以 HTTP 工具自建 Header 呼叫所有需要 PIN 的 API（含管理 CRUD 與代理操作）。
- 受影響的元件：`server.js` 中 `requirePin()`，所有標註 `requirePin` 的路由（如 `/api/agents` POST/PUT/DELETE、`/api/agent/*` 系列）。

（--- 高風險專屬區塊 ---）
- 駭客攻擊劇本（Hacker's Playbook）:
  > 我不需要知道你的 PIN。打開終端機，直接發一個請求：
  > `POST /api/agents`，加上 Header：`x-agent-name: anyone`，Body 放我要新增的帳號密碼。
  > 伺服器沒要求 PIN，因為看到 `x-agent-name` 就放行。我現在能新增/修改/刪除 Agent，接著用這個後門去操作叫號、結束客戶服務記錄、甚至大量建立票單干擾系統。

- 修復原理（Principle of the Fix）:
  > 門禁不能因為「自稱是員工名字」就放人進門。Header `x-agent-name` 就像自己嘴巴說「我是員工」，不具任何驗證能力。正確作法是以「只有伺服器能驗證的憑證」做授權，例如：一次性 PIN 僅做啟動、後續用 JWT/Session 驗證；或至少移除這條繞過，強制檢查正確的 PIN/權杖。
（--- 專屬區塊結束 ---）

- 修復建議與程式碼範例：
  1) 立即性修補（最小風險）：移除 `x-agent-name` 放行邏輯，只接受正確的 `x-agent-pin`（只允許 Header，不再讀 `body/query`）。
  2) 正式方案（建議）：實作真正登入流程（/api/login 發 JWT，HttpOnly + SameSite=Strict Cookie），新增 `requireAuth` 中介層驗簽與角色檢查（agent/admin），所有管理/代理 API 改為驗證 JWT，而不是 PIN 或自稱姓名。

  範例要點：
  - 後端：`requirePin` 改為僅檢查 `req.get('x-agent-pin') === AGENT_PIN`，並逐步汰除 PIN，導入 JWT。
  - 前端：拿掉自動附加 `x-agent-name` 的行為；改為依瀏覽器自動帶上的 HttpOnly Cookie（無法被 JS 竊取）。

---

### 威脅標題：高風險 - PII（電話）未授權外洩（多個未保護 API）
- 風險等級：高
- 威脅描述：
  - `/api/tickets/waiting`（未授權）回傳所有等待中票單的 `phone`。
  - `/api/ticket/:id`（未授權）回傳單張票單含完整 `phone`，`id` 為自增，可被暴力枚舉。
  - 以上造成大規模電話號碼收集（隱私法規風險）。
- 受影響的元件：`server.js` 上述兩條 API。

（--- 高風險專屬區塊 ---）
- 駭客攻擊劇本：
  > 我寫個小腳本，從 `id=1` 開始一路請求 `/api/ticket/1`、`/api/ticket/2`... 每一筆都含完整電話。我幾分鐘就能把你們近期所有用戶電話抓光，拿去做釣魚簡訊。

- 修復原理：
  > 公開 API 不應暴露可識別資訊（PII）。若確有需求，應最小化（只回傳必要欄位），或加保護（身分驗證/一次性 token/最後四碼驗證）才能取用詳細資料。
（--- 專屬區塊結束 ---）

- 修復建議與程式碼範例：
  - 將 `/api/tickets/waiting` 改為僅回傳必要欄位（例如：`id, serviceType, number, createdAt`），移除 `phone`。
  - 將 `/api/ticket/:id` 改為預設回傳遮罩後電話（或不回傳），必要時新增受保護版本（需 JWT 或提供「電話後四碼 verify4」才回原文）。
  - 若要對客戶本人顯示，建議建立「含隨機 `ticketToken`」的票券查詢 URL（QR 內含 token），以不可猜測的 token 存取詳細資訊。

---

### 威脅標題：中風險 - Login 後門：帳號不存在時仍回傳 ok（繞過真正認證）
- 風險等級：中
- 威脅描述：`/api/login` 只驗證已存在的 `agents` 帳號；對不存在帳號直接回傳 `{ ok: true }`。任何人只要通過 Captcha，即可被前端當作登入成功，進一步在客戶端形成「名義登入」狀態。
- 受影響的元件：`server.js` `/api/login`，前端 `public/login/index.html`、`public/agent/index.html` 對登入結果的信任。
- 修復建議與程式碼範例：
  - 僅對驗證通過的真實帳號回傳成功；取消 demo fallback。
  - 導入正式身分驗證（JWT + HttpOnly Cookie），前端不再以 `sessionStorage` 名稱視為登入依據。

---

### 威脅標題：中風險 - 管理資料列舉（Agents 列表可匿名讀取）
- 風險等級：中
- 威脅描述：`GET /api/agents` 無需授權即回傳所有 Agent 概要資料（帳號、姓名、櫃台、角色、時間戳）。雖不含密碼，但有助攻擊者建立帳號字典、社工攻擊。
- 受影響的元件：`server.js` `/api/agents`（GET），`public/admin/agents.html` 載入流程。
- 修復建議：為該端點加入授權（`requireAuth/requirePin`）或改為僅管理頁面透過後端渲染取得，避免對外暴露。

---

### 威脅標題：中風險 - CSP 允許 `unsafe-inline`、前端以 innerHTML 插入未轉義文字
- 風險等級：中
- 威脅描述：
  - Content-Security-Policy 設為 `script-src 'self' 'unsafe-inline'`、`style-src 'self' 'unsafe-inline'`，大幅放寬 XSS 成功機會。
  - `public/admin/agents.html` 直接以 template string 組 innerHTML 顯示資料庫中的 `name` 等欄位，未做 HTML escape；若惡意資料被寫入（例如社工讓管理員貼上惡意字串），可在管理頁觸發 XSS。
- 受影響的元件：全站 CSP、中：`public/admin/agents.html`、`public/agent/index.html` 局部 innerHTML。
- 修復建議：
  - 短期：對所有插入 DOM 的資料做 HTML 轉義（escape）。
  - 中期：移除 inline script/style，改用外掛檔 + CSP nonce/hash，將 CSP 改為不含 `unsafe-inline`。
  - 長期：導入 Helmet（`helmet`）統一管理安全標頭。

---

### 威脅標題：中風險 - 機制缺少節流：Captcha/QR 端點可被濫用造成資源耗用
- 風險等級：中
- 威脅描述：`/api/captcha/new`、`/api/qrcode` 可被大量呼叫，Captcha 與 CSRF token 皆保留於記憶體，未設上限；`sharp` 生成 PNG 亦耗資源。
- 受影響的元件：`server.js` Captcha 與 CSRF 記憶體 store、QRCode 產生。
- 修復建議：
  - 導入 `express-rate-limit` 針對敏感端點（captcha/login/qrcode/admin/agent）設速率限制。
  - 將 Captcha/CSRF store 移至 Redis（集中式）並設定最大容量與 TTL；或至少在記憶體 store 增加「上限清理」。

---

## 第二部分：標準應用程式安全審計（對應 OWASP Top 10）

- A01 權限控制失效：
  - 高：`requirePin` 以 `x-agent-name` 放行（繞過）。
  - 中：`GET /api/agents` 匿名可見；`/api/ticket/:id`、`/api/tickets/waiting` 泄露 PII。
- A02 加密機制失效：
  - 建議：導入 TLS（HTTPS）與 HSTS（由反向代理或 `helmet`），SQLite at-rest 若在共享或不可信磁碟上，考慮加密或磁碟加密。
- A03 注入式攻擊：
  - SQL：皆使用參數化查詢，風險低。
  - XSS：前端 `innerHTML` 未轉義 + CSP 寬鬆，提高 XSS 風險。
- A04 不安全的設計：
  - 以「姓名 header」作為授權依據屬設計性風險。
  - 未授權的 PII 查詢端點。
- A05 安全設定錯誤：
  - CSP 過寬、缺少 Helmet 通用標頭、缺少速率限制。
- A06 危險或過時的元件：
  - 建議：執行 `npm audit`/`npm outdated`，鎖定版本與安全升級（目前版本看起來新穩定，但仍需審核發佈時的 CVE）。
- A07 身份認證和驗證機制失效：
  - Login 對不存在帳號仍成功；未導入標準的會話（JWT/Cookie）。
- A08 軟體與資料完整性失效：
  - 建議：CI 中加入完整性檢查（SLSA/Checksum）與部署簽章驗證（若有供應鏈需求）。
- A09 安全記錄與監控失效：
  - 建議：加入 request logging（morgan/winston）與安全審計事件（管理操作、認證失敗、速率限制觸發）。
- A10 SSRF：
  - 目前未見外部抓取，但任何未來 URL 讀取（如圖檔代理）需限網段與 scheme 白名單。

---

## 業務邏輯漏洞（Business Logic）
- 代理操作端點（callNext/finish/transfer 等）只要繞過 `requirePin` 即可廣泛操作，屬於高影響的業務風險。
- `/api/ticket/:id` 以可預測 id 提供敏感資訊，欠缺「持券者」驗證（建議改以不可猜測 token）。

---

## 依賴與供應鏈安全
- 建議動作：
  - 執行 `npm audit --production`、`npm outdated`，依報告升級。
  - 鎖版與重建 lockfile（`npm ci`）以保證可重現建置。
  - 於 CI 加入 SCA（如 `npm audit`, Snyk, OWASP Dependency-Check）。

---

## 資料庫與資料流安全
- 傳輸中：以 TLS 提供 HTTPS 與 WSS，建議在反向代理層強制。
- 靜態資料：SQLite 未加密，若主機可能遺失或多人共用，建議：
  - 主機/磁碟全盤加密或搬遷至受管資料庫（權限分離）。
  - 僅儲存必要欄位；避免存入完整電話（或分段/雜湊 + 後四碼驗證）。
- 權限：執行用戶（OS 層）最小化；避免以過高權限帳號執行 Node 服務。

---

## 外部服務與 API 整合安全
目前未見外部雲端服務，但若後續加入，請先回答並落實下列三題（出自《安全守則》）：
1) 我們是否已設定最嚴格的防火牆/IP 白名單？
2) API 金鑰是否在供應商後台限制在最小必要範圍？
3) 若服務中斷或被入侵，有沒有降級計畫（關閉相關功能/維護頁）？

---

## 基礎設施與維運安全
- 反向代理：建議以 Nginx/Traefik 置前與 TLS/HSTS/CSP/限制上傳大小等。
- 日誌與監控：導入 request log、安全事件審計、錯誤告警（Sentry/Elastic/APM）。
- 任務與健康檢查：加上 `/api/health` 以外的就緒/活性檢查（ready/live），利於容器編排。

---

## 修復建議與程式碼範例（精選）

以下提供「可快速落地」的修復方向；若需要，我可直接提交變更 PR：

1) 修正 `requirePin`（立即）：
   - 僅接受 Header `x-agent-pin`；不得以 `x-agent-name` 或 body/query 通過。
   - 逐步汰除 PIN，導入 JWT（HttpOnly+SameSite=Strict），新增 `requireAuth` + 角色檢查。

2) 保護/去識別化 PII：
   - `/api/tickets/waiting`：移除 `phone` 欄位；或後端統一遮罩。
   - `/api/ticket/:id`：預設只回遮罩資訊；要看原文須提供不可猜測 `ticketToken` 或 `verify4`。

3) 前端 XSS 硬化：
   - 所有 innerHTML 賦值前做 HTML escape；或改以 textContent/屬性指派。
   - 移除 inline script/style，改用外掛檔與 CSP nonce，刪除 `unsafe-inline`。

4) 節流與資源保護：
   - `express-rate-limit` 用於 `/api/captcha/*`、`/api/login`、`/api/qrcode`、`/api/admin/*`、`/api/agent/*`。
   - Captcha/CSRF store 移至 Redis，設定上限與 TTL；或在記憶體 store 增加最大數量清理。

5) 安全標頭：
   - 加入 `helmet`（X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS 等）。
   - 收緊 CSP：`script-src 'self'` + nonce/hash；`style-src 'self'`。

6) 管理列舉收斂：
   - `GET /api/agents` 加授權或改由後端渲染，避免匿名列舉帳號。

---

## 第三部分：大型專案特別策略
- 分段檢核建議：
  - 若決定導入 JWT/角色與全面 CSP 改造，可切分為「認證/授權」「前端 CSP/外掛化」「API PII 去識別」三個模組逐步上線，降低風險。
- 自動化掃描（請求授權）：
  - 我發現了可重複的風險模式（未授權 PII、innerHTML 未轉義、CSP 過寬）。為確保覆蓋率，是否同意我產生一個只讀的 RegEx 掃描腳本，快速搜尋整個程式庫中：
    - 以 `innerHTML =` 或 template string 插入 DOM 的位置；
    - 回傳 `phone` 的 API；
    - 任何 `x-agent-name`、`unsafe-inline` 出現處。

---

## 附：對應修正工作的優先順序（P0->P2）
- P0（立刻）
  1) 移除 `x-agent-name` 放行（修 `requirePin`）。
  2) `/api/tickets/waiting` 與 `/api/ticket/:id` 去識別/加授權。
  3) 停用 login demo fallback（不存在帳號不得登入）。
- P1（本週）
  4) 導入 `express-rate-limit`；Captcha/CSRF store 設上限。
  5) `GET /api/agents` 加授權或下架。
  6) 前端敏感輸出全面 `escapeHTML()`（admin/agent 頁面）。
- P2（本月）
  7) 導入 JWT + HttpOnly Cookie、角色權限，替換 PIN 模式。
  8) 移除 inline script/style，收緊 CSP；導入 Helmet。
  9) 強化日誌與告警、TLS/HSTS、資料保護策略（加密或最小化）。

---

## 補充：最小 HTML 轉義工具（前端）
```js
function escapeHTML(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
// 使用： el.innerHTML = `<div>${escapeHTML(a.name||'')}</div>`;
```

---

## 結語
本次審計發現兩項「災難級/高風險」問題：授權繞過與 PII 泄露。建議先完成 P0 修復再開放任何外網存取。若需要，我可直接提交修補 PR 或協助導入 JWT、CSP 與速率限制的範本實作。
