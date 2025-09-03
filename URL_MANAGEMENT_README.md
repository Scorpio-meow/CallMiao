# URL 管理與自動跳轉系統

本系統實現了智能的 URL 檢查和跳轉管理，可自動判斷使用本地網址（ALLOWED_ORIGINS）還是外網址（PUBLIC_ORIGIN）進行跳轉。

## 主要功能

### 1. 環境自動檢測
系統會自動檢測當前運行環境：
- **本地環境**: localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x
- **DevTunnel 環境**: *.devtunnels.ms
- **正式環境**: 其他所有域名

### 2. 智能 URL 選擇
根據檢測到的環境自動選擇適當的基礎 URL：
- **開發/本地環境**: 使用當前 origin (location.origin)
- **正式環境**: 優先使用 PUBLIC_ORIGIN 環境變數，回退到當前 origin

### 3. 安全跳轉檢查
- 自動驗證跳轉目標是否安全
- 支援同源政策檢查
- 特殊規則支援 DevTunnel 和本地環境
- 防止開放式重定向攻擊

## 核心組件

### URLManager 類
主要的 URL 管理類，提供以下方法：

```javascript
// 載入伺服器設定
await urlManager.loadConfig()

// 檢測當前環境
const env = urlManager.detectEnvironment()

// 建構安全的跳轉 URL
const url = await urlManager.buildRedirectUrl('/agent/index.html', { param: 'value' })

// 安全跳轉
await urlManager.safeRedirect('/login/index.html')

// 檢查是否允許跳轉到指定 URL
const isAllowed = urlManager.isAllowedOrigin(targetUrl, allowedOrigins)
```

### AuthChecker 類
認證狀態檢查和管理：

```javascript
// 檢查認證狀態並在必要時跳轉到登入頁面
const isAuthenticated = await checkAuth()

// 取得當前使用者資訊
const user = getCurrentUser()

// 檢查是否為管理員
const isAdminUser = isAdmin()

// 登出
await logout()
```

## 使用方式

### 1. 在 HTML 頁面中引入
```html
<script src="/utils/url-manager.js"></script>
<script src="/utils/auth-checker.js"></script>
```

### 2. 基本使用範例

#### 檢查認證並跳轉
```javascript
// 頁面載入時檢查認證
window.addEventListener('load', async () => {
    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
        // 使用者已登入，初始化頁面
        initializePage();
    }
    // 如果未登入，會自動跳轉到登入頁面
});
```

#### 登入後跳轉
```javascript
// 在登入頁面處理登入成功後的跳轉
const urlManager = window.URLManager;
const redirectTo = new URLSearchParams(location.search).get('redirect') || '/agent/index.html';
await urlManager.handleLoginRedirect(redirectTo);
```

#### 安全跳轉
```javascript
// 安全地跳轉到指定頁面
await urlManager.safeRedirect('/admin/agents.html');
```

### 3. 伺服器端設定

#### 環境變數
```bash
# .env 檔案
PORT=3000
AGENT_PIN=0000
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
PUBLIC_ORIGIN=https://yourdomain.com
NODE_ENV=production
```

#### API 端點
系統會自動從 `/api/config` 端點載入設定：
```json
{
  "publicOrigin": "https://yourdomain.com",
  "environment": {
    "isLocal": false,
    "isDevTunnel": false,
    "isProduction": true,
    "hostname": "yourdomain.com"
  },
  "allowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
  "features": {
    "autoRedirect": true,
    "smartUrlDetection": true
  }
}
```

## 安全特性

### 1. 防止開放式重定向
- 檢查跳轉目標是否在允許清單中
- 自動拒絕不安全的跨域跳轉
- 提供後備跳轉路徑

### 2. 環境隔離
- 開發環境和正式環境使用不同的 URL 規則
- DevTunnel 環境有特殊的安全規則
- 本地開發時自動使用本地 URL

### 3. 認證保護
- 自動檢查使用者登入狀態
- 未登入時自動跳轉到登入頁面
- 保護敏感頁面免受未授權存取

## 測試

訪問 `/test/url-manager.html` 可以進行完整的系統測試，包括：
- 環境檢測測試
- 設定載入測試
- URL 建構測試
- 安全跳轉測試
- 認證狀態測試
- 跨域檢查測試

## 故障排除

### 常見問題

1. **跳轉不工作**
   - 檢查 `PUBLIC_ORIGIN` 環境變數是否正確設定
   - 確認 `ALLOWED_ORIGINS` 包含所有需要的域名
   - 查看瀏覽器控制台是否有錯誤訊息

2. **DevTunnel 環境問題**
   - 確保 DevTunnel URL 包含在 `ALLOWED_ORIGINS` 中
   - 檢查 `PUBLIC_ORIGIN` 是否設定為 DevTunnel URL

3. **認證檢查失敗**
   - 確認 sessionStorage 中有必要的認證資訊
   - 檢查 AuthChecker 的 requiredItems 設定

### 除錯模式
在瀏覽器控制台中啟用詳細日誌：
```javascript
// 查看 URL Manager 設定
console.log(await window.URLManager.loadConfig());

// 查看環境檢測結果
console.log(window.URLManager.detectEnvironment());

// 查看認證狀態
console.log(window.getCurrentUser());
```

## 更新記錄

- **v1.0.0**: 初始版本，包含基本的 URL 管理和認證檢查
- 自動環境檢測
- 智能 URL 選擇
- 安全跳轉保護
- 完整的測試介面
