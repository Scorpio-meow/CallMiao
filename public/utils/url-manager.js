/**
 * URL Manager - 自動檢查並選擇適當的網址進行跳轉
 * 支援本地網址 (ALLOWED_ORIGINS) 和外網址 (PUBLIC_ORIGIN) 的智能切換
 */
class URLManager {
  constructor() {
    this.config = null;
    this.isConfigLoaded = false;
    
    // 快取設定 5 分鐘
    this.configCache = {
      data: null,
      timestamp: 0,
      expiry: 5 * 60 * 1000 // 5 minutes
    };
  }

  /**
   * 從伺服器載入設定資訊
   */
  async loadConfig() {
    try {
      // 檢查快取是否有效
      const now = Date.now();
      if (this.configCache.data && (now - this.configCache.timestamp) < this.configCache.expiry) {
        this.config = this.configCache.data;
        this.isConfigLoaded = true;
        return this.config;
      }

      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const config = await response.json();
      
      // 快取設定
      this.configCache = {
        data: config,
        timestamp: now,
        expiry: this.configCache.expiry
      };
      
      this.config = config;
      this.isConfigLoaded = true;
      
      console.log('URL Manager - 載入設定:', config);
      return config;
    } catch (error) {
      console.error('URL Manager - 載入設定失敗:', error);
      
      // 使用預設設定
      this.config = {
        publicOrigin: location.origin
      };
      this.isConfigLoaded = true;
      return this.config;
    }
  }

  /**
   * 檢查當前環境類型
   */
  detectEnvironment() {
    const hostname = location.hostname;
    const protocol = location.protocol;
    
    const env = {
      isLocal: false,
      isDevTunnel: false,
      isProduction: false,
      isDevelopment: false,
      hostname,
      protocol
    };

    // 檢查是否為本地環境
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      env.isLocal = true;
      env.isDevelopment = true;
    }
    
    // 檢查是否為 DevTunnel
    if (hostname.includes('devtunnels.ms')) {
      env.isDevTunnel = true;
      env.isDevelopment = true;
    }
    
    // 檢查是否為正式環境
    if (!env.isLocal && !env.isDevTunnel) {
      env.isProduction = true;
    }

    return env;
  }

  /**
   * 檢查兩個 URL 是否同源
   */
  isSameOrigin(url1, url2) {
    try {
      const parsed1 = new URL(url1);
      const parsed2 = new URL(url2);
      return parsed1.origin === parsed2.origin;
    } catch (error) {
      console.warn('URL Manager - 同源檢查失敗:', error);
      return false;
    }
  }

  /**
   * 檢查 URL 是否在允許的來源清單中
   */
  isAllowedOrigin(targetUrl, allowedOrigins = []) {
    try {
      const target = new URL(targetUrl);
      const current = new URL(location.href);
      
      // 檢查是否同源
      if (target.origin === current.origin) {
        return true;
      }
      
      // 檢查允許清單
      for (const allowed of allowedOrigins) {
        const allowedUrl = new URL(allowed);
        if (target.origin === allowedUrl.origin) {
          return true;
        }
      }
      
      // 特殊規則：DevTunnel 環境
      const env = this.detectEnvironment();
      if (env.isDevTunnel) {
        const targetHost = target.hostname;
        const currentHost = current.hostname;
        
        // 允許 DevTunnel 內部跳轉
        if (targetHost.includes('devtunnels.ms') && currentHost.includes('devtunnels.ms')) {
          return true;
        }
      }
      
      // 特殊規則：本地環境
      if (env.isLocal) {
        const targetHost = target.hostname;
        
        // 允許本地網址之間跳轉
        if (targetHost === 'localhost' || targetHost === '127.0.0.1' || 
            targetHost.startsWith('192.168.') || targetHost.startsWith('10.')) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.warn('URL Manager - 允許來源檢查失敗:', error);
      return false;
    }
  }

  /**
   * 建構安全的跳轉 URL
   */
  async buildRedirectUrl(path, params = {}) {
    await this.loadConfig();
    
    const env = this.detectEnvironment();
    let baseUrl;
    
    // 標準化路徑
    let normalizedPath = path;
    if (typeof path === 'string') {
      // 確保路徑以 / 開頭
      if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
      }
      // 移除多餘的開頭斜線
      normalizedPath = normalizedPath.replace(/^\/+/, '/');
    }
    
    // 根據環境選擇基礎 URL
    if (env.isLocal || env.isDevelopment) {
      // 開發環境：優先使用當前 origin
      baseUrl = location.origin;
    } else {
      // 正式環境：使用 PUBLIC_ORIGIN（如果有設定）
      baseUrl = this.config.publicOrigin || location.origin;
    }
    
    // 建構完整 URL
    const url = new URL(normalizedPath, baseUrl);
    
    // 添加參數
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.set(key, String(params[key]));
      }
    });
    
    console.log('URL Manager - 建構跳轉 URL:', {
      environment: env,
      baseUrl: baseUrl,
      originalPath: path,
      normalizedPath: normalizedPath,
      params,
      finalUrl: url.href
    });
    
    return url.href;
  }

  /**
   * 安全跳轉到指定路徑
   */
  async safeRedirect(targetPath, options = {}) {
    const {
      replace = false,
      params = {},
      fallbackPath = '/agent/index.html',
      allowedOrigins = []
    } = options;

    try {
      let targetUrl;
      
      // 標準化路徑：將 // 開頭的路徑轉換為單個 /
      let normalizedPath = targetPath;
      if (typeof targetPath === 'string' && targetPath.startsWith('//') && !targetPath.startsWith('http')) {
        normalizedPath = targetPath.substring(1); // 移除開頭的額外 /
        console.log('URL Manager - 標準化路徑:', targetPath, '->', normalizedPath);
      }
      
      // 如果是完整 URL
      if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
        // 檢查是否允許跳轉
        if (!this.isAllowedOrigin(normalizedPath, allowedOrigins)) {
          console.warn('URL Manager - 跨域跳轉被阻止:', normalizedPath);
          targetUrl = await this.buildRedirectUrl(fallbackPath, params);
        } else {
          targetUrl = normalizedPath;
        }
      } else {
        // 路徑：建構完整 URL
        targetUrl = await this.buildRedirectUrl(normalizedPath, params);
      }
      
      console.log('URL Manager - 執行跳轉:', {
        original: targetPath,
        final: targetUrl,
        replace
      });
      
      // 執行跳轉
      if (replace) {
        location.replace(targetUrl);
      } else {
        location.href = targetUrl;
      }
      
    } catch (error) {
      console.error('URL Manager - 跳轉失敗:', error);
      
      // 錯誤處理：跳轉到後備頁面
      const fallbackUrl = await this.buildRedirectUrl(fallbackPath);
      if (replace) {
        location.replace(fallbackUrl);
      } else {
        location.href = fallbackUrl;
      }
    }
  }

  /**
   * 取得當前頁面的 redirect 參數
   */
  getCurrentRedirectPath() {
    // 使用相對路徑避免 DevTunnel 環境的問題
    // 確保路徑格式正確，避免雙斜線問題
    let path = location.pathname + location.search + location.hash;
    
    // 標準化路徑，移除多餘的斜線
    path = path.replace(/\/+/g, '/');
    
    console.log('URL Manager - 當前重定向路徑:', path);
    return path;
  }

  /**
   * 建構登入跳轉 URL
   */
  async buildLoginUrl(redirectPath = null) {
    const redirect = redirectPath || this.getCurrentRedirectPath();
    return await this.buildRedirectUrl('/login/index.html', { redirect });
  }

  /**
   * 跳轉到登入頁面
   */
  async redirectToLogin(redirectPath = null) {
    const loginUrl = await this.buildLoginUrl(redirectPath);
    console.log('URL Manager - 跳轉到登入頁面:', loginUrl);
    location.href = loginUrl;
  }

  /**
   * 登入後跳轉
   */
  async handleLoginRedirect(redirectParam = null) {
    let redirect = redirectParam || new URLSearchParams(location.search).get('redirect') || '/agent/index.html';
    
    // 解碼 URL 編碼的字符
    if (typeof redirect === 'string' && redirect.includes('%')) {
      try {
        redirect = decodeURIComponent(redirect);
        console.log('URL Manager - 解碼 redirect 參數:', redirectParam, '->', redirect);
      } catch (error) {
        console.warn('URL Manager - 解碼 redirect 參數失敗:', error);
      }
    }
    
    await this.safeRedirect(redirect, {
      fallbackPath: '/agent/index.html',
      allowedOrigins: [
        'http://localhost:3000',
        this.config?.publicOrigin
      ].filter(Boolean)
    });
  }

  /**
   * 檢查是否需要跳轉到登入頁面
   */
  checkAuthAndRedirect(requiredAuth = ['ui_agent_name', 'ui_agent_account']) {
    // 檢查必要的認證資訊，支援遺留鍵名
    const missing = requiredAuth.filter(key => {
      return !(sessionStorage.getItem(key) || sessionStorage.getItem(key.replace(/^ui_/, '')));
    });
    
    if (missing.length > 0) {
      console.log('URL Manager - 缺少認證資訊:', missing);
      this.redirectToLogin();
      return false;
    }
    
    return true;
  }
}

// 建立全域實例
window.URLManager = new URLManager();

// 匯出供模組使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = URLManager;
}
