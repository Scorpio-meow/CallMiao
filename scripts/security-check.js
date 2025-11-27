const fs = require('fs');
const path = require('path');
console.log('🔍 開始安全性檢查...\n');
let errorCount = 0;
let warningCount = 0;
function error(message) {
  console.error(`❌ 錯誤: ${message}`);
  errorCount++;
}
function warning(message) {
  console.warn(`⚠️  警告: ${message}`);
  warningCount++;
}
function success(message) {
  console.log(`✅ ${message}`);
}
console.log('📋 檢查環境變數配置...');
if (!fs.existsSync('.env')) {
  warning('.env 檔案不存在，請從 .env.example.new 複製並配置');
} else {
  success('.env 檔案存在');
  const envContent = fs.readFileSync('.env', 'utf8');
  const requiredVars = ['PORT', 'ALLOWED_ORIGINS', 'NODE_ENV'];
  requiredVars.forEach(varName => {
    const regex = new RegExp(`^${varName}=.+`, 'm');
    if (!regex.test(envContent)) {
      warning(`環境變數 ${varName} 未設定`);
    } else {
      success(`環境變數 ${varName} 已設定`);
    }
  });
  const activeEnvMatch = envContent.match(/^NODE_ENV=(.+)$/m);
  const isProduction = activeEnvMatch && activeEnvMatch[1].trim().toLowerCase() === 'production';
  if (isProduction) {
    console.log('\n🔒 偵測到生產環境設定，進行額外檢查...');
    const activePubOrigin = envContent.match(/^PUBLIC_ORIGIN=(.*)$/m);
    if (!activePubOrigin || !activePubOrigin[1].trim()) {
      error('生產環境必須設定 PUBLIC_ORIGIN');
    }
    const activeAllowedOrigins = envContent.match(/^ALLOWED_ORIGINS=(.*)$/m);
    if (activeAllowedOrigins && /localhost|127\.0\.0\.1/i.test(activeAllowedOrigins[1])) {
      error('生產環境的 ALLOWED_ORIGINS 不應包含 localhost');
    }
    if (activeAllowedOrigins && !/https:\/\/.+/.test(activeAllowedOrigins[1])) {
      warning('生產環境建議使用 HTTPS');
    }
  }
}
console.log('\n📋 檢查 .gitignore 配置...');
if (!fs.existsSync('.gitignore')) {
  error('.gitignore 檔案不存在');
} else {
  const gitignoreContent = fs.readFileSync('.gitignore', 'utf8');
  const requiredIgnores = ['.env', 'node_modules', 'db/*.db'];
  requiredIgnores.forEach(pattern => {
    if (!gitignoreContent.includes(pattern.split('*')[0])) {
      error(`.gitignore 缺少 ${pattern}`);
    } else {
      success(`.gitignore 包含 ${pattern}`);
    }
  });
}
console.log('\n📋 檢查資料庫檔案...');
if (fs.existsSync('db/queue.db')) {
  success('資料庫檔案存在');
  if (process.platform !== 'win32') {
    try {
      const stats = fs.statSync('db/queue.db');
      const mode = stats.mode.toString(8).slice(-3);

      if (mode !== '600' && mode !== '400') {
        warning(`資料庫檔案權限為 ${mode}，建議設為 600 (chmod 600 db/queue.db)`);
      } else {
        success(`資料庫檔案權限正確 (${mode})`);
      }
    } catch (err) {
      warning('無法檢查資料庫檔案權限');
    }
  }
} else {
  console.log('ℹ️  資料庫檔案尚未建立（首次啟動時會自動建立）');
}
console.log('\n📋 檢查相依套件...');
if (fs.existsSync('package.json')) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredDeps = ['express', 'bcryptjs', 'better-sqlite3', 'socket.io', 'dotenv'];
  requiredDeps.forEach(dep => {
    if (pkg.dependencies && pkg.dependencies[dep]) {
      success(`相依套件 ${dep} 已安裝`);
    } else {
      error(`缺少相依套件 ${dep}`);
    }
  });
}
console.log('\n📋 檢查版本控制狀態...');
if (fs.existsSync('.git')) {
  const { execSync } = require('child_process');
  try {
    const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n');
    const sensitivePatterns = [
      { pattern: /^\.env$/, name: '.env' },
      { pattern: /\.db$/, name: 'queue.db' }
    ];
    sensitivePatterns.forEach(({ pattern, name }) => {
      const found = tracked.some(file => pattern.test(file.trim()));
      if (found) {
        error(`敏感檔案 ${name} 在版本控制中！請立即移除`);
      } else {
        success(`敏感檔案 ${name} 未在版本控制中`);
      }
    });
  } catch (err) {
    warning('無法檢查 Git 狀態');
  }
} else {
  console.log('ℹ️  非 Git 專案，跳過版本控制檢查');
}
console.log('\n📋 檢查程式碼中的硬編碼秘密...');
if (fs.existsSync('server.js')) {
  const serverContent = fs.readFileSync('server.js', 'utf8');
  const suspiciousPatterns = [
    { pattern: /password\s*=\s*['"][^'"]{6,}['"]/i, message: '可能包含硬編碼密碼' },
    { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, message: '可能包含硬編碼 API 金鑰' },
    { pattern: /secret\s*=\s*['"][^'"]+['"]/i, message: '可能包含硬編碼秘密' }
  ];
  let foundIssue = false;
  suspiciousPatterns.forEach(({ pattern, message }) => {
    if (pattern.test(serverContent)) {
      warning(`server.js ${message}`);
      foundIssue = true;
    }
  });
  if (!foundIssue) {
    success('未發現明顯的硬編碼秘密');
  }
}
console.log('\n📋 檢查安全工具...');
if (fs.existsSync('public/utils/input-validator.js')) {
  success('輸入驗證工具已安裝');
} else {
  warning('輸入驗證工具不存在，建議安裝');
}
console.log('\n' + '='.repeat(50));
console.log('📊 檢查結果總結');
console.log('='.repeat(50));
if (errorCount === 0 && warningCount === 0) {
  console.log('🎉 太棒了！未發現安全問題');
} else {
  if (errorCount > 0) {
    console.log(`❌ 發現 ${errorCount} 個錯誤需要修復`);
  }
  if (warningCount > 0) {
    console.log(`⚠️  發現 ${warningCount} 個警告需要注意`);
  }
}
console.log('\n建議事項：');
console.log('1. 部署前請閱讀 SECURITY-DEPLOYMENT.md');
console.log('2. 定期執行 npm audit 檢查相依性漏洞');
console.log('3. 使用強密碼並定期更換');
console.log('4. 啟用 HTTPS 和防火牆');
console.log('5. 設定自動備份機制\n');
process.exit(errorCount > 0 ? 1 : 0);