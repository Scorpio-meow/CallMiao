# 🔒 安全部署檢查清單

本文件提供叫號機系統部署到生產環境時的安全檢查清單與最佳實踐。

---

## 📋 部署前必查項目

### 1. 環境變數配置 ✅

- [ ] 已複製 `.env.example.new` 為 `.env`
- [ ] `NODE_ENV` 設定為 `production`
- [ ] `ALLOWED_ORIGINS` 設定為實際網域（移除所有 localhost）
- [ ] `PUBLIC_ORIGIN` 設定為實際公開網址
- [ ] 所有必填項目已正確填寫

### 2. 敏感資料保護 ✅

- [ ] `.env` 檔案已加入 `.gitignore`（已自動處理）
- [ ] 檢查 Git 歷史，確認 `.env` 未曾被提交
- [ ] 資料庫檔案未上傳到版本控制
- [ ] 沒有任何密碼或金鑰寫死在程式碼中

### 3. 資料庫安全 ✅

- [ ] 資料庫檔案權限設為 `600` 或更嚴格
  ```bash
  chmod 600 db/queue.db
  ```
- [ ] 資料庫目錄權限設為 `700`
  ```bash
  chmod 700 db/
  ```
- [ ] 已設定自動備份機制
- [ ] 備份檔案儲存在安全位置

### 4. 帳號與密碼 ✅

- [ ] 已使用 `npm run create-admin` 建立管理員帳號
- [ ] 已更改所有預設密碼
- [ ] 密碼符合強度要求（至少 8 字元，包含字母和數字）
- [ ] 已禁用或刪除測試帳號

### 5. 網路安全 ✅

- [ ] 已啟用 HTTPS（透過 Nginx/Apache 反向代理）
- [ ] 已設定防火牆規則（只開放必要埠）
- [ ] 已配置 SSL/TLS 憑證
- [ ] 已測試 HTTPS 連線正常運作

### 6. 伺服器設定 ✅

- [ ] 已安裝並啟用反向代理（Nginx/Apache）
- [ ] 已設定正確的代理 headers
  ```nginx
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Host $host;
  ```
- [ ] 已設定速率限制（可在 Nginx 層級額外設定）
- [ ] 已禁止直接存取敏感檔案（.env, .git, db/）

---

## 🛡️ Nginx 範例配置

```nginx
server {
    listen 443 ssl http2;
    server_name queue.yourcompany.com;

    # SSL 憑證
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 安全標頭
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 禁止存取敏感檔案
    location ~ /\. {
        deny all;
        return 404;
    }

    location ~ ^/(db|node_modules|scripts)/ {
        deny all;
        return 404;
    }

    location ~* \.(env|md|json|lock)$ {
        deny all;
        return 404;
    }

    # Socket.IO 支援
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 主要應用程式
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 額外速率限制
    limit_req_zone $binary_remote_addr zone=login_limit:10m rate=5r/m;
    location /api/login {
        limit_req zone=login_limit burst=2;
        proxy_pass http://localhost:3000;
    }
}

# HTTP 自動重定向到 HTTPS
server {
    listen 80;
    server_name queue.yourcompany.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 🔧 系統層級安全設定

### Linux/Ubuntu 伺服器

```bash
# 1. 建立專用使用者（不使用 root）
sudo adduser queueapp
sudo usermod -aG sudo queueapp

# 2. 設定檔案權限
sudo chown -R queueapp:queueapp /path/to/queue-app
chmod 755 /path/to/queue-app
chmod 600 /path/to/queue-app/.env
chmod 700 /path/to/queue-app/db

# 3. 設定防火牆
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp  # SSH
sudo ufw enable

# 4. 安裝 PM2 進程管理器
sudo npm install -g pm2
pm2 start server.js --name queue-system
pm2 startup
pm2 save

# 5. 設定自動重啟
pm2 restart queue-system --cron "0 3 * * *"  # 每天凌晨 3 點重啟
```

---

## 📊 監控與日誌

### 1. 啟用日誌記錄

建議使用 PM2 的日誌功能：

```bash
# 查看日誌
pm2 logs queue-system

# 設定日誌輪替
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 2. 監控系統健康

```bash
# 使用 PM2 監控
pm2 monit

# 查看系統資源
pm2 status
```

### 3. 錯誤通知

考慮整合錯誤監控服務（如 Sentry）：

```bash
npm install @sentry/node
```

---

## 🔄 定期維護任務

### 每日

- [ ] 檢查系統日誌是否有異常
- [ ] 確認備份正常執行
- [ ] 監控系統資源使用狀況

### 每週

- [ ] 檢查安全更新
- [ ] 審查存取日誌
- [ ] 測試備份還原

### 每月

- [ ] 更新相依套件
  ```bash
  npm audit
  npm update
  ```
- [ ] 審查使用者帳號權限
- [ ] 檢查磁碟空間
- [ ] 審查 CORS 設定

### 每季

- [ ] 更換管理員密碼
- [ ] 完整安全審計
- [ ] 壓力測試
- [ ] 災難復原演練

---

## 🚨 應急處理程序

### 系統被入侵時

1. **立即行動**
   ```bash
   # 停止服務
   pm2 stop queue-system
   
   # 斷開網路連線（視情況）
   sudo ufw deny from any to any
   ```

2. **保存證據**
   ```bash
   # 備份日誌
   cp -r logs/ /secure/location/incident-$(date +%Y%m%d)/
   
   # 保存系統快照
   ```

3. **分析與修復**
   - 檢查所有使用者帳號
   - 審查系統日誌
   - 掃描惡意程式
   - 更換所有密碼和金鑰

4. **復原服務**
   - 從乾淨的備份還原
   - 更新所有套件
   - 強化安全設定
   - 逐步恢復服務

### 資料外洩時

1. 立即通知所有受影響用戶
2. 強制所有用戶更換密碼
3. 調查外洩範圍和原因
4. 加強安全措施
5. 依法律要求進行通報

---

## 📞 支援與聯絡

- **技術支援**：[您的支援 Email]
- **安全問題回報**：[安全團隊 Email]
- **緊急聯絡**：[24/7 緊急電話]

---

## 📚 延伸閱讀

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js 安全最佳實踐](https://nodejs.org/en/docs/guides/security/)
- [Express 安全更新](https://expressjs.com/en/advanced/best-practice-security.html)
- 本專案：`Security-Guidelines_Traditional-Chinese.md`

---

**最後更新**：2025年10月1日

**注意**：此檢查清單應定期更新，並根據實際部署環境調整。
