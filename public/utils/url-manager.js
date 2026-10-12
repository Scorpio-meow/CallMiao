class URLManager {
  constructor() {
    this.config = null;
    this.isConfigLoaded = false;
    this.configCache = {
      data: null,
      timestamp: 0,
      expiry: 5 * 60 * 1000
    };
  }
  async loadConfig() {
    try {
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
      this.config = {
        publicOrigin: location.origin
      };
      this.isConfigLoaded = true;
      return this.config;
    }
  }
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
    if (hostname === 'localhost' || hostname === '127.0.0.1' || /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(hostname)) {
      env.isLocal = true;
      env.isDevelopment = true;
    }
    if (hostname.endsWith('.devtunnels.ms')) {
      env.isDevTunnel = true;
      env.isDevelopment = true;
    }
    if (!env.isLocal && !env.isDevTunnel) {
      env.isProduction = true;
    }
    return env;
  }
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
  isAllowedOrigin(targetUrl, allowedOrigins = []) {
    try {
      const target = new URL(targetUrl);
      const current = new URL(location.href);
      if (target.origin === current.origin) {
        return true;
      }
      for (const allowed of allowedOrigins) {
        const allowedUrl = new URL(allowed);
        if (target.origin === allowedUrl.origin) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.warn('URL Manager - 允許來源檢查失敗:', error);
      return false;
    }
  }
  isSafeScheme(urlStr) {
    try {
      const parsed = new URL(urlStr, location.origin);
      const scheme = parsed.protocol.toLowerCase();
      if (scheme === 'http:' || scheme === 'https:') return true;
      return false;
    } catch (e) {
      return false;
    }
  }
  async sanitizeRedirectTarget(targetPath, allowedOrigins = []) {
    await this.loadConfig();
    try {
      const env = this.detectEnvironment();
      const baseOrigin = (!env.isLocal && !env.isDevTunnel) ? (this.config?.publicOrigin || location.origin) : location.origin;
      if (typeof targetPath === 'string' && targetPath.startsWith('//')) {
        console.warn('URL Manager - protocol-relative URL not allowed during sanitize:', targetPath);
        return null;
      }
      const absolute = new URL(targetPath, baseOrigin);
      if (!this.isSafeScheme(absolute.href)) {
        console.warn('URL Manager - scheme not allowed during sanitize:', absolute.href);
        return null;
      }
      const currentUrl = new URL(location.href);
      const normalizePort = (u) => u.port || (u.protocol === 'https:' ? '443' : (u.protocol === 'http:' ? '80' : ''));
      if (absolute.origin === currentUrl.origin || (absolute.hostname === currentUrl.hostname && normalizePort(absolute) === normalizePort(currentUrl))) {
        return absolute.href;
      }
      const provided = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
      const mergedAllowed = new Set(provided.filter(Boolean));
      if (this.config?.publicOrigin) mergedAllowed.add(this.config.publicOrigin);
      for (const candidate of mergedAllowed) {
        try {
          const candUrl = new URL(candidate);
          if (absolute.origin === candUrl.origin) {
            return absolute.href;
          }
        } catch (e) {
          // ignore malformed allowlist entries
        }
      }
      console.warn('URL Manager - sanitizeRedirectTarget rejected:', absolute.href);
      return null;
    } catch (error) {
      console.warn('URL Manager - sanitizeRedirectTarget failed:', error, targetPath);
      return null;
    }
  }
  async buildRedirectUrl(path, params = {}) {
    await this.loadConfig();
    const env = this.detectEnvironment();
    let baseUrl;
    let normalizedPath = path;
    if (typeof path === 'string') {
      if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
      }
      normalizedPath = normalizedPath.replace(/^\/+/, '/');
    }
    if (env.isLocal || env.isDevelopment) {
      baseUrl = location.origin;
    } else {
      baseUrl = this.config.publicOrigin || location.origin;
    }
    const url = new URL(normalizedPath, baseUrl);
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
  async safeRedirect(targetPath, options = {}) {
    const {
      replace = false,
      params = {},
      fallbackPath = '/agent/index.html',
      allowedOrigins = []
    } = options;
    try {
      let targetUrl;
      let normalizedPath = targetPath;
      if (typeof targetPath === 'string' && targetPath.startsWith('//') && !targetPath.startsWith('http')) {
        normalizedPath = targetPath.substring(1);
        console.log('URL Manager - 標準化路徑:', targetPath, '->', normalizedPath);
      }
      let safeTarget = null;
      if (typeof normalizedPath === 'string') {
        if (/^https?:\/\//i.test(normalizedPath) || normalizedPath.startsWith('//')) {
          safeTarget = await this.sanitizeRedirectTarget(normalizedPath, allowedOrigins);
        } else {
          const built = await this.buildRedirectUrl(normalizedPath, params);
          safeTarget = await this.sanitizeRedirectTarget(built, allowedOrigins);
        }
      }
      if (!safeTarget) {
        targetUrl = await this.buildRedirectUrl(fallbackPath, params);
      } else {
        targetUrl = safeTarget;
      }
      console.log('URL Manager - 執行跳轉:', {
        original: targetPath,
        final: targetUrl,
        replace
      });
      if (replace) {
        location.replace(targetUrl);
      } else {
        location.href = targetUrl;
      }
    } catch (error) {
      console.error('URL Manager - 跳轉失敗:', error);
      const fallbackUrl = await this.buildRedirectUrl(fallbackPath);
      if (replace) {
        location.replace(fallbackUrl);
      } else {
        location.href = fallbackUrl;
      }
    }
  }
  getCurrentRedirectPath() {
    let path = location.pathname + location.search + location.hash;
    path = path.replace(/\/+/g, '/');
    console.log('URL Manager - 當前重定向路徑:', path);
    return path;
  }
  async buildLoginUrl(redirectPath = null) {
    const redirect = redirectPath || this.getCurrentRedirectPath();
    return await this.buildRedirectUrl('/login/index.html', { redirect });
  }
  async redirectToLogin(redirectPath = null) {
    const loginUrl = await this.buildLoginUrl(redirectPath);
    console.log('URL Manager - 跳轉到登入頁面:', loginUrl);
    location.href = loginUrl;
  }
  async handleLoginRedirect(redirectParam = null) {
    let redirect = redirectParam || new URLSearchParams(location.search).get('redirect') || '/agent/index.html';
    if (typeof redirect === 'string' && redirect.includes('%')) {
      try {
        redirect = decodeURIComponent(redirect);
        console.log('URL Manager - 解碼 redirect 參數:', redirectParam, '->', redirect);
      } catch (error) {
        console.warn('URL Manager - 解碼 redirect 參數失敗:', error);
      }
    }
    if (typeof redirect === 'string') {
      redirect = redirect.trim();
      if (/[\u0000\u000a\u000d\u2028\u2029]/.test(redirect)) {
        console.warn('URL Manager - redirect contains control characters, rejecting:', redirect);
        redirect = '/agent/index.html';
      }
      if (redirect.startsWith('//')) {
        console.warn('URL Manager - protocol-relative redirect rejected:', redirect);
        redirect = '/agent/index.html';
      }
    }
    await this.safeRedirect(redirect, {
      fallbackPath: '/agent/index.html',
      allowedOrigins: [this.config?.publicOrigin].filter(Boolean)
    });
  }
  checkAuthAndRedirect(requiredAuth = ['ui_agent_name', 'ui_agent_account']) {
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
if (typeof window !== 'undefined') {
  window.URLManager = new URLManager();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = URLManager;
}