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
  getCurrentUser() {
    return {
      name: sessionStorage.getItem('ui_agent_name') || '',
      account: sessionStorage.getItem('ui_agent_account') || '',
      counter: sessionStorage.getItem('ui_agent_counter') || '',
      role: sessionStorage.getItem('ui_agent_role') || '',
      id: sessionStorage.getItem('ui_agent_id') || ''
    };
  }
  isAdmin() {
    return sessionStorage.getItem('ui_agent_role') === 'admin';
  }
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
  async logout() {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn('Logout API error:', e);
    }
    const keys = ['ui_agent_name', 'ui_agent_account', 'ui_agent_counter', 'ui_agent_role', 'ui_agent_id'];
    keys.forEach(key => sessionStorage.removeItem(key));
  }
  async init() {
    if (this.urlManager && !this.urlManager.isConfigLoaded) {
      await this.urlManager.loadConfig();
    }
    return await this.checkAuthAndRedirect();
  }
}
window.AuthChecker = AuthChecker;
window.checkAuth = async function (options = {}) {
  const checker = new AuthChecker(options);
  return await checker.init();
};
window.logout = async function () {
  const checker = new AuthChecker();
  await checker.logout();
};
window.getCurrentUser = function () {
  const checker = new AuthChecker();
  return checker.getCurrentUser();
};
window.isAdmin = function () {
  const checker = new AuthChecker();
  return checker.isAdmin();
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthChecker;
}