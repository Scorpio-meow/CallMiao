/**
 * 前端輸入驗證與清理工具
 * 用於防止 XSS 攻擊和惡意輸入
 */
class InputValidator {
  /**
   * HTML 實體編碼，防止 XSS 攻擊
   */
  static escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
      '/': '&#x2F;'
    };
    return text.replace(/[&<>"'/]/g, char => map[char]);
  }

  /**
   * 移除 HTML 標籤
   */
  static stripHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.textContent || div.innerText || '';
  }

  /**
   * 驗證並清理帳號（只允許字母、數字、底線、橫線）
   */
  static sanitizeAccount(account) {
    if (typeof account !== 'string') return '';
    return account.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  }

  /**
   * 驗證並清理姓名（移除特殊字元但保留中文）
   */
  static sanitizeName(name) {
    if (typeof name !== 'string') return '';
    // 允許中文、英文、空格、常見標點
    return name.trim().replace(/[<>{}[\]\\|`]/g, '');
  }

  /**
   * 驗證並清理櫃台號（只允許字母和數字）
   */
  static sanitizeCounter(counter) {
    if (typeof counter !== 'string') return '';
    return counter.trim().replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * 驗證服務類型（只允許 A-E）
   */
  static validateServiceType(serviceType) {
    if (typeof serviceType !== 'string') return false;
    return /^[A-E]$/i.test(serviceType.trim());
  }

  /**
   * 清理服務類型
   */
  static sanitizeServiceType(serviceType) {
    if (typeof serviceType !== 'string') return '';
    const cleaned = serviceType.trim().toUpperCase();
    return this.validateServiceType(cleaned) ? cleaned : '';
  }

  /**
   * 驗證數字 ID
   */
  static validateNumericId(id) {
    const num = parseInt(id, 10);
    return !isNaN(num) && num > 0 && isFinite(num);
  }

  /**
   * 清理數字 ID
   */
  static sanitizeNumericId(id) {
    const num = parseInt(id, 10);
    return this.validateNumericId(num) ? num : null;
  }

  /**
   * 驗證票券號碼格式（例如 A001, B123）
   */
  static validateTicketNumber(number) {
    if (typeof number !== 'string') return false;
    return /^[A-E]\d{3}$/i.test(number.trim());
  }

  /**
   * 清理票券號碼
   */
  static sanitizeTicketNumber(number) {
    if (typeof number !== 'string') return '';
    const cleaned = number.trim().toUpperCase();
    return this.validateTicketNumber(cleaned) ? cleaned : '';
  }

  /**
   * 驗證密碼強度（至少 8 字元）
   */
  static validatePasswordStrength(password) {
    if (typeof password !== 'string') return { valid: false, message: '密碼格式錯誤' };
    
    if (password.length < 8) {
      return { valid: false, message: '密碼長度至少需要 8 個字元' };
    }
    
    // 建議包含數字、字母
    const hasNumber = /\d/.test(password);
    const hasLetter = /[a-zA-Z]/.test(password);
    
    if (!hasNumber || !hasLetter) {
      return { 
        valid: true, 
        message: '建議密碼包含字母和數字，以提高安全性',
        weak: true 
      };
    }
    
    return { valid: true, message: '密碼強度良好' };
  }

  /**
   * 清理並驗證 URL
   */
  static sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    try {
      const parsed = new URL(url.trim());
      // 只允許 http 和 https 協議
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return parsed.href;
    } catch (e) {
      return '';
    }
  }

  /**
   * 驗證 Email 格式（基本檢查）
   */
  static validateEmail(email) {
    if (typeof email !== 'string') return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim());
  }

  /**
   * 清理一般文字輸入（移除危險字元）
   */
  static sanitizeText(text, maxLength = 1000) {
    if (typeof text !== 'string') return '';
    
    // 移除控制字元和特殊 Unicode
    let cleaned = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    
    // 限制長度
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength);
    }
    
    return cleaned.trim();
  }

  /**
   * 批次清理物件的所有字串屬性
   */
  static sanitizeObject(obj, rules = {}) {
    if (typeof obj !== 'object' || obj === null) return {};
    
    const sanitized = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (rules[key]) {
        // 使用指定的清理規則
        sanitized[key] = rules[key](value);
      } else if (typeof value === 'string') {
        // 預設清理文字
        sanitized[key] = this.sanitizeText(value);
      } else if (typeof value === 'number') {
        // 數字保持不變
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * 顯示驗證錯誤訊息（可選的 UI 輔助函數）
   */
  static showValidationError(message, elementId = null) {
    console.warn('Validation Error:', message);
    
    if (elementId) {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = message;
        element.className = 'validation-error';
        element.style.display = 'block';
        
        // 3 秒後自動隱藏
        setTimeout(() => {
          element.style.display = 'none';
        }, 3000);
      }
    }
    
    return false;
  }
}

// 全域匯出
window.InputValidator = InputValidator;

// 便利函數
window.sanitizeInput = {
  account: (v) => InputValidator.sanitizeAccount(v),
  name: (v) => InputValidator.sanitizeName(v),
  counter: (v) => InputValidator.sanitizeCounter(v),
  serviceType: (v) => InputValidator.sanitizeServiceType(v),
  ticketNumber: (v) => InputValidator.sanitizeTicketNumber(v),
  text: (v) => InputValidator.sanitizeText(v),
  html: (v) => InputValidator.escapeHtml(v),
  url: (v) => InputValidator.sanitizeUrl(v)
};

// 模組匯出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputValidator;
}
