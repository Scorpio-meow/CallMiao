# 🔒 安全性更新說明

## 最新安全改進（2025-10-01）

本次更新大幅強化了系統的安全性，包含以下重要改進：

---

## 🎯 主要安全改進

### 1. **環境變數保護強化**
- ✅ 更新 `.gitignore`，確保 `.env` 和資料庫檔案不會被追蹤
- ✅ 建立詳細的 `.env.example.new` 範本，包含完整說明
- ✅ 新增生產環境配置驗證

### 2. **生產環境安全檢查**
- ✅ 啟動時自動檢查必要的環境變數
- ✅ 生產環境要求 Origin header，禁止無來源請求
- ✅ 記錄所有 CORS 拒絕事件，便於安全監控

### 3. **錯誤處理改善**
- ✅ 生產環境只記錄錯誤訊息，避免洩漏堆疊追蹤
- ✅ 統一錯誤處理格式
- ✅ 向用戶只顯示通用錯誤訊息

### 4. **前端輸入驗證**
- ✅ 新增 `input-validator.js` 工具庫
- ✅ 提供完整的輸入清理和驗證函數
- ✅ 防止 XSS 攻擊和惡意輸入

### 5. **自動安全檢查**
- ✅ 新增 `security-check.js` 腳本
- ✅ 啟動前自動執行安全檢查
- ✅ 檢查環境配置、檔案權限、版本控制狀態等

---

## 🚀 如何使用

### 首次設定

1. **配置環境變數**
   ```powershell
   # 複製範本檔案
   Copy-Item .env.example.new .env
   
   # 編輯 .env，填入實際的配置值
   notepad .env
   ```

2. **執行安全檢查**
   ```powershell
   npm run security-check
   ```

3. **建立管理員帳號**
   ```powershell
   npm run create-admin
   ```

4. **啟動服務**
   ```powershell
   # 開發環境
   npm run dev
   
   # 正式環境
   npm start
   ```

### 日常使用

- **每次部署前**：執行 `npm run security-check`
- **每月**：執行 `npm audit` 檢查相依性漏洞
- **定期**：更新相依套件 `npm update`

---

## 📚 新增檔案說明

### `public/utils/input-validator.js`
前端輸入驗證工具，提供以下功能：
- HTML 實體編碼（防 XSS）
- 帳號、姓名、櫃台號清理
- 密碼強度驗證
- URL 清理與驗證

**使用範例**：
```javascript
// 在 HTML 中引入
<script src="/utils/input-validator.js"></script>

// 使用驗證
const account = InputValidator.sanitizeAccount(userInput);
const name = InputValidator.sanitizeName(userName);

// 或使用便利函數
const cleanAccount = sanitizeInput.account(userInput);
```

### `SECURITY-DEPLOYMENT.md`
完整的生產環境部署安全檢查清單，包含：
- 部署前檢查項目
- Nginx 配置範例
- 系統層級安全設定
- 監控與日誌設定
- 定期維護任務
- 應急處理程序

### `scripts/security-check.js`
自動安全檢查腳本，會檢查：
- 環境變數配置
- .gitignore 設定
- 資料庫檔案權限
- 相依套件完整性
- 版本控制狀態
- 程式碼中的硬編碼秘密

---

## ⚙️ 環境變數說明

### 開發環境 (development)
```env
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000
PUBLIC_ORIGIN=
```

### 正式環境 (production)
```env
NODE_ENV=production
ALLOWED_ORIGINS=https://queue.yourcompany.com,https://www.yourcompany.com
PUBLIC_ORIGIN=https://queue.yourcompany.com
```

**重要**：正式環境必須設定 `ALLOWED_ORIGINS` 和 `PUBLIC_ORIGIN`

---

## 🔍 自動安全檢查

系統現在會在啟動時自動執行安全檢查（透過 `prestart` script）。

如果檢查失敗，可以：
1. 查看錯誤訊息
2. 修正問題
3. 重新啟動

手動執行檢查：
```powershell
npm run security-check
```

---

## 🛡️ 安全最佳實踐

### 1. **密碼管理**
- 使用強密碼（至少 8 字元，包含字母和數字）
- 定期更換管理員密碼
- 絕不在程式碼中寫死密碼

### 2. **HTTPS**
- 正式環境必須使用 HTTPS
- 透過 Nginx 或 Apache 配置 SSL/TLS
- 使用有效的 SSL 憑證（Let's Encrypt 免費）

### 3. **防火牆**
- 只開放必要的埠（80, 443）
- 使用 IP 白名單限制管理介面存取
- 定期審查防火牆規則

### 4. **備份**
- 每日自動備份資料庫
- 備份檔案加密儲存
- 定期測試備份還原

### 5. **監控**
- 監控系統資源使用
- 記錄並審查所有 API 請求
- 設定異常行為警報

---

## 📞 如何回報安全問題

如果您發現安全漏洞，請：
1. **不要**在公開 issue 中回報
2. 發送郵件至：[安全團隊 Email]
3. 詳細描述問題和重現步驟
4. 我們會在 24 小時內回應

---

## 🔄 更新日誌

### 2025-10-01
- ✅ 強化 .gitignore 排除敏感檔案
- ✅ 改善生產環境 CORS 檢查
- ✅ 加入環境配置驗證
- ✅ 統一錯誤處理，避免資訊洩漏
- ✅ 新增前端輸入驗證工具
- ✅ 新增自動安全檢查腳本
- ✅ 建立安全部署指南

### 2025-11-27
- 🔄 修補 Transitive Dependency: `cookie` (npm) 的安全性問題，已將 `cookie` 鎖定為 `0.7.0`（使用 npm overrides）。此舉可防止 cookie 名稱、path 或 domain 中包含惡意字元導致的繞過或 XSS 風險。

---

## 📖 延伸閱讀

- [SECURITY-DEPLOYMENT.md](./SECURITY-DEPLOYMENT.md) - 完整部署指南
- [Security-Guidelines_Traditional-Chinese.md](./Security-Guidelines_Traditional-Chinese.md) - 安全開發守則
- [README.md](./README.md) - 專案說明文件

---

**重要提醒**：安全性是持續的過程，請定期檢查和更新您的安全設定！
