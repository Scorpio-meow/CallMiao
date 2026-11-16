# 部署指南

[← 回到 README](../README.md)

---

## 目錄

- [上線前檢查清單](#上線前檢查清單)
- [監聽位址](#監聽位址)
- [Nginx 反向代理](#nginx-反向代理)
- [用 PM2 常駐執行](#用-pm2-常駐執行)
- [資料庫檔案](#資料庫檔案)
- [重設密碼](#重設密碼)
- [升級版本](#升級版本)
- [疑難排解](#疑難排解)

---

## 上線前檢查清單

- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET` 是新產生的隨機字串，沒有沿用範例或開發環境的值
- [ ] `PUBLIC_ORIGIN` 是對外的 HTTPS 網址
- [ ] `ALLOWED_ORIGINS` 只列出會嵌入取號頁或呼叫 API 的正式網站，沒有 `localhost` 或測試網址
- [ ] `TRUST_PROXY` 與實際的代理層數一致
- [ ] `TZ` 是營業所在地的時區
- [ ] 已依現場狀況設定 `MAX_WAITING_PER_SERVICE`、`MAX_WAITING_PER_CLIENT` 與 `KIOSK_IPS`
- [ ] 反向代理已啟用 HTTPS，並轉送 WebSocket
- [ ] `DB_DIR` 只有執行服務的系統帳號能讀寫
- [ ] 所有預設或測試用的帳號密碼都已更換
- [ ] `bun test` 全部通過

正式模式若 `ALLOWED_ORIGINS` 含有 `localhost` 或 `127.0.0.1`，啟動時會印出警告。

---

## 監聽位址

| 啟動方式 | 監聽位址 | 適用情況 |
|----------|----------|----------|
| `bun start` | `localhost` | 前面有同一台主機上的反向代理（建議） |
| `bun start --host` | 所有網路介面（`0.0.0.0`） | 區網內直接連線，例如店內的平板與看板 |

伺服器本身只提供 HTTP；正式環境請由反向代理處理 HTTPS。

---

## Nginx 反向代理

```nginx
server {
    listen 80;
    server_name queue.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name queue.example.com;

    ssl_certificate     /etc/letsencrypt/live/queue.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/queue.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> [!IMPORTANT]
> 一定要保留 `proxy_set_header Host $host;`。伺服器靠 `Host` 判斷請求是否來自自己的頁面，少了這行，自己的頁面也會被當成跨站請求而回 `403`。

搭配這個設定，`.env` 請設 `TRUST_PROXY=1`。

---

## 用 PM2 常駐執行

```bash
bun install -g pm2
pm2 start server.js --name callmiao --interpreter bun
pm2 save
pm2 startup
```

用 Node.js 執行時，去掉 `--interpreter bun` 即可。要監聽所有網路介面時，在最後加上 `-- --host`。

| 指令 | 用途 |
|------|------|
| `pm2 status` | 查看執行狀態 |
| `pm2 logs callmiao` | 查看即時日誌 |
| `pm2 restart callmiao` | 修改 `.env` 或更新程式後重新啟動 |

> [!WARNING]
> 驗證碼與即時推播的狀態都存在單一行程的記憶體裡，請勿使用 PM2 的 cluster 模式，也不要開多個實例共用同一個 `DB_DIR`。

---

## 資料庫檔案

`DB_DIR` 底下有 `queue.db`、`sessions.db`，以及執行中產生的 `-wal`、`-shm` 檔。

- **權限**：Linux 上建議只讓服務帳號讀寫：

  ```bash
  chmod 700 /var/lib/callmiao
  chmod 600 /var/lib/callmiao/*.db
  ```

- **備份**：伺服器執行中時，請一併備份 `-wal` 檔，或先停止服務再複製，以免拿到不完整的資料。
- **版本控制**：`.gitignore` 已排除 `db/`、`*.db`、`*.db-*`、`*.sqlite` 與 `*.sqlite-*`，`DB_DIR` 指到專案內其他目錄時，資料庫檔案也不會被 commit。

---

## 重設密碼

忘記密碼、或建立管理員時出現 `UNIQUE constraint failed: agents.account`（帳號已存在）時，在專案根目錄執行下面的指令。最後兩個參數依序是帳號與新密碼：

```bash
bun -e "const { Database } = require('bun:sqlite'); const bcrypt = require('bcryptjs'); const [account, password] = process.argv.slice(-2); const db = new Database(require('path').resolve(process.env.DB_DIR, 'queue.db')); const r = db.run('UPDATE agents SET password = ?, active = 1, sessionVersion = sessionVersion + 1, updatedAt = ? WHERE account = ?', [bcrypt.hashSync(password, 10), new Date().toISOString(), account]); console.log(r.changes ? 'password reset: ' + account : 'account not found: ' + account);" admin "新密碼"
```

- 帳號若被停用，會一併重新啟用；角色維持不變。
- 這個帳號原本的所有登入 Session 會立即失效。
- 伺服器執行中也可以直接執行，不需要先停止。

---

## 升級版本

1. 閱讀 [CHANGELOG.md](../CHANGELOG.md) 中新版本的「破壞性變更」，補上新的必填環境變數。
2. 停止服務並備份 `DB_DIR`。
3. 更新程式並安裝相依套件：`bun install`。
4. 執行 `bun test` 確認測試通過。
5. 啟動服務。資料表結構會在啟動時自動補齊欄位與索引。

> [!NOTE]
> 從 1.x 升級到 2.0.0 後，所有既有 Session 都會失效，櫃員需要重新登入。

---

## 疑難排解

<details>
<summary><b>啟動時出現 <code>CRITICAL: … is not set</code></b></summary>

必填的環境變數缺少或格式錯誤。訊息會指出是哪一個變數，對照[環境變數設定](configuration.md#變數總表)補上即可。常見原因：

- 加了新的服務代碼，卻忘了補 `SERVICE_NAME_<代碼>` 與 `SERVICE_DESC_<代碼>`。
- `KIOSK_IPS` 整行被刪掉。它可以留空，但變數本身一定要存在。
- 正式模式缺少 `PUBLIC_ORIGIN`、`ALLOWED_ORIGINS` 或 `TRUST_PROXY`。

</details>

<details>
<summary><b>連接埠被占用（<code>EADDRINUSE</code>）</b></summary>

換一個連接埠啟動：

```bash
PORT=3001 bun run dev
```

Windows PowerShell 請改用 `$env:PORT='3001'; bun run dev`。也可以找出占用的程式並結束它：

```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

</details>

<details>
<summary><b>資料庫被鎖定（<code>SQLITE_BUSY</code> / <code>database is locked</code>）</b></summary>

有其他程式同時開著同一個資料庫，常見的是另一個還在執行的伺服器，或 SQLite 檢視工具。關掉它們後再啟動；若仍無法解決，先備份 `DB_DIR`，再刪除其中的 `-wal` 與 `-shm` 檔。

</details>

<details>
<summary><b>回應 <code>403 origin not allowed</code></b></summary>

發出請求的頁面來自其他網站，而該網站不在 `ALLOWED_ORIGINS`，也不等於 `PUBLIC_ORIGIN`。把它加入 `ALLOWED_ORIGINS`（多個以逗號分隔、結尾不加 `/`）。若是透過反向代理存取自己的頁面也出現這個錯誤，請確認代理有轉送 `Host` 標頭。

</details>

<details>
<summary><b>回應 <code>403 invalid csrf token</code></b></summary>

寫入請求沒有帶有效的 `x-csrf-token`。先呼叫 `GET /api/csrf` 取得 Token，再放進請求標頭。重新登入後 Token 會改變，要重新取得。

</details>

<details>
<summary><b>櫃員按叫號出現 <code>counter not assigned</code> 或 <code>counter busy</code></b></summary>

- `counter not assigned`：這個帳號還沒有櫃台號，請管理員到後台指派。
- `counter busy`：這個櫃台還有一張已叫號或服務中的票，先完成、取消或轉出它。

</details>

<details>
<summary><b>取號回應 <code>429</code></b></summary>

- `too many waiting tickets from this network`：同一個來源的等候票已達 `MAX_WAITING_PER_CLIENT`。若現場顧客共用同一個對外 IP，請調高上限，或把取號機的 IP 加入 `KIOSK_IPS`。
- `queue is full, please try later`：該服務別的等候票已達 `MAX_WAITING_PER_SERVICE`。
- `too many ticket creations, please try later`：一分鐘內取號太多次，稍後再試。

</details>

<details>
<summary><b>日誌出現 <code>ERR_ERL_UNEXPECTED_X_FORWARDED_FOR</code></b></summary>

請求帶有 `X-Forwarded-For` 標頭，但 `TRUST_PROXY` 沒有設定。代表伺服器前面有一層代理，卻不信任它，結果所有透過代理進來的人都被當成同一個 IP，會共用取號上限與速率限制。

- 前面是 Nginx 等反向代理：設 `TRUST_PROXY=1`。
- 用 VS Code Dev Tunnels、ngrok 等同一台電腦上的通道測試：設 `TRUST_PROXY=loopback`。

修改 `.env` 後要重新啟動伺服器。

</details>

<details>
<summary><b>大廳看板沒有聲音</b></summary>

瀏覽器不允許網頁自動播放聲音。請在看板畫面上按一次「啟用聲音」；每次重新整理頁面後都要再按一次。

</details>
