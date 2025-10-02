/**
 * 通用認證檢查模組
 * 自動檢查使用者登入狀態，未登入時自動跳轉到登入頁面
 */
class AuthChecker {
  constructor(options = {}) {
    this.options = {
      requiredItems: ['ui_agent_name', 'ui_agent_account'],
      loginPath: '/login/index.html',
      skipRedirect: false,
      ...options
    };

    this.urlManager = window.URLManager;
  }

  /**
   * 檢查所需的 sessionStorage 項目是否存在
   */
  checkRequiredItems() {
    const missing = this.options.requiredItems.filter(key => {
      // support both legacy and new ui_ prefixed keys during transition
      const value = sessionStorage.getItem(key) || sessionStorage.getItem(key.replace(/^ui_/, ''));
      return !value || value.trim() === '';
    });

    return {
      isValid: missing.length === 0,
      missing
    };
  }

  /**
   * 取得當前使用者資訊（僅供 UI 顯示）
   * ⚠️ 注意：這些資料來自 sessionStorage，僅用於前端顯示
   * 實際的認證狀態由後端 session 控制
   */
  getCurrentUser() {
    return {
      name: sessionStorage.getItem('ui_agent_name') || '',
      account: sessionStorage.getItem('ui_agent_account') || '',
      counter: sessionStorage.getItem('ui_agent_counter') || '',
      role: sessionStorage.getItem('ui_agent_role') || '',
      id: sessionStorage.getItem('ui_agent_id') || ''
    };
  }

  /**
   * 檢查使用者是否為管理員（僅供 UI 顯示判斷）
   * ⚠️ 注意：實際權限檢查由後端執行
   */
  isAdmin() {
    return sessionStorage.getItem('ui_agent_role') === 'admin';
  }

  /**
   * 檢查認證並在必要時跳轉
   */
  async checkAuthAndRedirect() {
    const { isValid, missing } = this.checkRequiredItems();

    if (!isValid) {
      console.log('AuthChecker - 認證檢查失敗，缺少:', missing);

      if (!this.options.skipRedirect && this.urlManager) {
        await this.urlManager.redirectToLogin();
      }

      return false;
    }

    console.log('AuthChecker - 認證檢查通過');
    return true;
  }

  /**
   * 登出並清除所有相關 sessionStorage
   */
  async logout() {
    try {
      // 呼叫後端登出 API（這才是真正的登出）
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Logout API error:', e);
    }

    // 清除 UI 顯示用的 sessionStorage
    const keys = ['ui_agent_name', 'ui_agent_account', 'ui_agent_counter', 'ui_agent_role', 'ui_agent_id'];
    keys.forEach(key => sessionStorage.removeItem(key));
  }

  /**
   * 初始化頁面認證檢查
   */
  async init() {
    // 等待 URL Manager 載入
    if (this.urlManager && !this.urlManager.isConfigLoaded) {
      await this.urlManager.loadConfig();
    }

    return await this.checkAuthAndRedirect();
  }
}

// 建立全域實例和便利函數
window.AuthChecker = AuthChecker;

// 便利函數：快速檢查認證
window.checkAuth = async function (options = {}) {
    const checker = new AuthChecker(options);
    return await checker.init();
  };

// 便利函數：快速登出
window.logout = async function () {
    const checker = new AuthChecker();
    await checker.logout();
  };

// 便利函數：取得當前使用者
window.getCurrentUser = function () {
    const checker = new AuthChecker();
    return checker.getCurrentUser();
  };

// 便利函數：檢查是否為管理員
window.isAdmin = function () {
    const checker = new AuthChecker();
    return checker.isAdmin();
  };

  // 匯出供模組使用
  if(typeof module !== 'undefined' && module.exports) {
  module.exports = AuthChecker;
}
