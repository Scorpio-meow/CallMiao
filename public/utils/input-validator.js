class InputValidator {
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
  static stripHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.textContent || div.innerText || '';
  }
  static sanitizeAccount(account) {
    if (typeof account !== 'string') return '';
    return account.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  }
  static sanitizeName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/[<>{}[\]\\|`]/g, '');
  }
  static sanitizeCounter(counter) {
    if (typeof counter !== 'string') return '';
    return counter.trim().replace(/[^a-zA-Z0-9]/g, '');
  }
  static validateServiceType(serviceType) {
    if (typeof serviceType !== 'string') return false;
    return /^[A-E]$/i.test(serviceType.trim());
  }
  static sanitizeServiceType(serviceType) {
    if (typeof serviceType !== 'string') return '';
    const cleaned = serviceType.trim().toUpperCase();
    return this.validateServiceType(cleaned) ? cleaned : '';
  }
  static validateNumericId(id) {
    const num = parseInt(id, 10);
    return !isNaN(num) && num > 0 && isFinite(num);
  }
  static sanitizeNumericId(id) {
    const num = parseInt(id, 10);
    return this.validateNumericId(num) ? num : null;
  }
  static validateTicketNumber(number) {
    if (typeof number !== 'string') return false;
    return /^[A-E]\d{3}$/i.test(number.trim());
  }
  static sanitizeTicketNumber(number) {
    if (typeof number !== 'string') return '';
    const cleaned = number.trim().toUpperCase();
    return this.validateTicketNumber(cleaned) ? cleaned : '';
  }
  static validatePasswordStrength(password) {
    if (typeof password !== 'string') return { valid: false, message: '密碼格式錯誤' };
    if (password.length < 8) {
      return { valid: false, message: '密碼長度至少需要 8 個字元' };
    }
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
  static sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return parsed.href;
    } catch (e) {
      return '';
    }
  }
  static validateEmail(email) {
    if (typeof email !== 'string') return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim());
  }
  static sanitizeText(text, maxLength = 1000) {
    if (typeof text !== 'string') return '';
    let cleaned = text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength);
    }
    return cleaned.trim();
  }
  static sanitizeObject(obj, rules = {}) {
    if (typeof obj !== 'object' || obj === null) return {};
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (rules[key]) {
        sanitized[key] = rules[key](value);
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeText(value);
      } else if (typeof value === 'number') {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  static showValidationError(message, elementId = null) {
    console.warn('Validation Error:', message);
    if (elementId) {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = message;
        element.className = 'validation-error';
        element.style.display = 'block';
        setTimeout(() => {
          element.style.display = 'none';
        }, 3000);
      }
    }
    return false;
  }
}
window.InputValidator = InputValidator;
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
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputValidator;
}