/**
 * 通用認證檢查模組
 * 自動檢查使用者登入狀態，未登入時自動跳轉到登入頁面
 */
class AuthChecker {
  constructor(options = {}) {
    this.options = {
      requiredItems: ['agent_name', 'agent_account'],
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
      const value = sessionStorage.getItem(key);
      return !value || value.trim() === '';
    });

    return {
      isValid: missing.length === 0,
      missing
    };
  }

  /**
   * 取得當前使用者資訊
   */
  getCurrentUser() {
    return {
      name: sessionStorage.getItem('agent_name') || '',
      account: sessionStorage.getItem('agent_account') || '',
      counter: sessionStorage.getItem('agent_counter') || '',
      role: sessionStorage.getItem('agent_role') || '',
      id: sessionStorage.getItem('agent_id') || ''
    };
  }

  /**
   * 檢查使用者是否為管理員
   */
  isAdmin() {
    return sessionStorage.getItem('agent_role') === 'admin';
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
    const keys = ['agent_name', 'agent_account', 'agent_counter', 'agent_role', 'agent_id'];
    keys.forEach(key => sessionStorage.removeItem(key));
    
    console.log('AuthChecker - 已登出');
    
    if (this.urlManager) {
      await this.urlManager.safeRedirect(this.options.loginPath);
    } else {
      location.href = this.options.loginPath;
    }
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
window.checkAuth = async function(options = {}) {
  const checker = new AuthChecker(options);
  return await checker.init();
};

// 便利函數：快速登出
window.logout = async function() {
  const checker = new AuthChecker();
  await checker.logout();
};

// 便利函數：取得當前使用者
window.getCurrentUser = function() {
  const checker = new AuthChecker();
  return checker.getCurrentUser();
};

// 便利函數：檢查是否為管理員
window.isAdmin = function() {
  const checker = new AuthChecker();
  return checker.isAdmin();
};

// 匯出供模組使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthChecker;
}
