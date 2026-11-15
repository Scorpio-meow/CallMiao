# 安全性

叫號喵會放在公開網路上給顧客取號，也管理櫃員帳號，因此在每一層都加了防護。本文件說明這些防護怎麼運作、如何自行驗證，以及發現漏洞時怎麼回報。

---

## 目錄

- [回報漏洞](#回報漏洞)
- [支援版本](#支援版本)
- [防護總覽](#防護總覽)
- [防護機制](#防護機制)
- [自行驗證](#自行驗證)
- [安全更新紀錄](#安全更新紀錄)

---

## 回報漏洞

> [!IMPORTANT]
> 請不要在公開的 Issue 或討論區張貼安全漏洞。

請透過 GitHub 私下回報：到 [Security → Report a vulnerability](https://github.com/Scorpio-meow/CallMiao/security/advisories/new) 建立通報，並盡量附上：

- 漏洞類型與影響範圍
- 重現步驟或概念驗證（PoC）
- 建議的修正方式（若有）

收到通報後會先評估影響，修正後發布新版本，並在 [CHANGELOG.md](CHANGELOG.md) 註明。

---

## 支援版本

| 版本 | 安全性更新 |
|------|:----------:|
| 2.x | 支援 |
| 1.x | 不支援，請升級到 2.x |

---

## 防護總覽

| 威脅 | 防護 | 實作 |
|------|------|------|
| 跨站請求偽造（CSRF） | 綁定 Session 的 CSRF Token、來源白名單、`SameSite=Lax` Cookie | `server.js` |
| 非法跨站存取 | 白名單以外的 `Origin` 一律 `403`，HTTP 與 WebSocket 相同 | `cors`、Socket.IO `allowRequest` |
| 點擊劫持 | 只有 `/kiosk/` 能被 `ALLOWED_ORIGINS` 嵌入，其他頁面只允許同源 | `helmet` |
| 跨站腳本（XSS） | 前端只用 `textContent` 與 DOM API 建畫面；CSP 禁止外部與行內腳本 | `public/*`、`helmet` |
| 暴力破解登入 | 一次性圖形驗證碼、登入速率限制、bcrypt 密碼雜湊 | `svg-captcha`、`express-rate-limit`、`bcryptjs` |
| Session 劫持與殘留 | 登入時重新產生 Session、`HttpOnly` Cookie、改密碼或停用帳號即撤銷 Session | `express-session`、`sessionVersion` |
| 越權操作 | 管理員權限每次重新查資料庫；已叫號的票只限所屬櫃台操作 | `server.js` |
| 佇列被塞滿 | 每服務別與每來源網路的等候票上限、取號速率限制 | `server.js` |
| 設定遺漏 | 必填環境變數缺少時拒絕啟動 | `server.js` |
| 機密外洩 | `.env` 與資料庫不進版本控制；正式模式不回傳錯誤細節 | `.gitignore`、錯誤處理 |

---

## 防護機制

### CSRF

- 登入後以 `GET /api/csrf` 取得 Token。Token 由 `crypto.randomBytes` 產生並存在伺服器端 Session，比對時使用 `crypto.timingSafeEqual`。
- 除了 `POST /api/login` 與 `POST /api/tickets`，所有寫入請求都必須登入並帶 `x-csrf-token` 標頭，否則回 `403`。
- 兩個例外的理由：匿名取號不依賴登入狀態，所以偽造請求拿不到額外權限；登入需要一次性驗證碼，且跨站請求會先被來源白名單擋下。
- 以上 Token 檢查之外，Session Cookie 也設為 `SameSite=Lax`，跨站送出的 `POST` 不會帶上它。

### 來源白名單與嵌入

- 允許的來源：與伺服器同主機的頁面、`PUBLIC_ORIGIN`、`ALLOWED_ORIGINS`；開發模式另外允許 `http://localhost:PORT`。完整規則見[來源白名單規則](docs/configuration.md#來源白名單規則)。
- 其他來源的 HTTP 請求直接回 `403` 並記錄日誌，請求不會進到後面的處理；Socket.IO 握手也用同一套規則。
- `/kiosk/` 的 CSP `frame-ancestors` 為 `'self'` 加上 `ALLOWED_ORIGINS`；其他頁面維持 `frame-ancestors 'self'` 與 `X-Frame-Options: SAMEORIGIN`。

### 認證與 Session

- 驗證碼 5 分鐘內有效，只能使用一次，以 PNG 圖片輸出。
- 密碼以 bcrypt 雜湊保存；帳號或密碼錯誤都回同一個訊息。
- 登入成功時重新產生 Session ID，防止 Session 固定攻擊。
- Session Cookie 設定 `HttpOnly`、`SameSite=Lax`，正式模式另加 `Secure`，有效 8 小時。
- 每個帳號有 `sessionVersion`。改密碼、重設密碼或停用帳號時遞增，該帳號其他 Session 立即失效，WebSocket 訊息也不會再送達。
- 櫃員修改自己的密碼時必須輸入目前的密碼。

### 授權

- 每個需要登入的請求都重新查資料庫確認帳號仍啟用、權限未變更，降級或停用立即生效。
- 櫃台號一律取自登入帳號，請求中無法冒用其他櫃台。
- 已叫號或服務中的票只有叫號的櫃台與管理員能操作。
- 管理員無法降級、停用或刪除自己，避免後台被鎖死。

### 佇列與速率限制

- 每個服務別最多 `MAX_WAITING_PER_SERVICE` 張等候票，每個來源網路最多 `MAX_WAITING_PER_CLIENT` 張。IPv6 以 `/56` 網段計算，換位址也繞不過。
- 來源 IP 以 `SESSION_SECRET` 做 HMAC 後才存入資料庫，不保存原始 IP，公開 API 也不會回傳。
- 登入、驗證碼、取號、查詢、QR Code、櫃員與管理 API 各有獨立的速率限制，數值見 [API 參考](docs/api.md#速率限制)。
- 速率限制與取號上限依賴正確的來源 IP，請依實際代理層數設定 `TRUST_PROXY`。

### 前端與標頭

- 所有頁面都以 `document.createElement()` 與 `textContent` 建立畫面，不把使用者資料拼進 `innerHTML`。
- CSP 只允許同源的腳本與樣式，頁面沒有行內腳本。
- 登入後的 `redirect` 參數以 `new URL()` 解析，只接受同源路徑；`//attacker.com`、`/\attacker.com`、`javascript:` 一律改回櫃員首頁。
- `/api/qrcode/:ticketId` 只為已存在的票券產生 QR Code，不是開放的文字轉 QR 服務。

### 設定與相依套件

- 啟動時檢查所有必填環境變數，缺少就拒絕啟動，避免在不安全的設定下上線。
- 正式模式的錯誤回應不含堆疊或細節。
- `package.json` 以 `overrides` 將間接相依的 `cookie` 固定在 `0.7.0`，避開舊版的解析漏洞。
- `.gitignore` 排除 `.env`、`.env.*`（保留 `.env.example`）、資料庫檔、`*.cookie` 與日誌。

---

## 自行驗證

### 整合測試

```bash
bun test
```

測試會用暫存資料庫啟動伺服器，涵蓋：

- 跨日作廢以 `TZ` 的午夜為準
- 匿名取號的每來源上限，且回應不洩漏內部欄位
- 同一個 IPv6 `/56` 網段共用取號上限
- 櫃員只能操作自己櫃台已叫號的票
- 轉櫃只能在保留狀態時指定櫃台
- 重設密碼會撤銷該帳號的 Session
- 驗證碼只能使用一次
- 其他網站的來源回 `403`，伺服器自己的主機放行
- 只有取號頁能被允許的網站嵌入

### 相依套件漏洞

```bash
bun audit
```

### 上線前檢查

部署前請逐項確認[上線前檢查清單](docs/deployment.md#上線前檢查清單)。

---

## 安全更新紀錄

每個版本的安全性修正都記錄在 [CHANGELOG.md](CHANGELOG.md) 的「安全性」段落。
