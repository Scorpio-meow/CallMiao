# Git 安全清理指南

## ⚠️ 重要：敏感檔案已從版本控制中移除

我們發現以下敏感檔案曾被提交到 Git，現已移除追蹤：
- `.env` - 包含環境變數配置
- `db/queue.db` - 資料庫檔案
- `db/queue.db-shm` - SQLite 共享記憶體檔案

---

## 📋 已執行的清理步驟

```powershell
# 從 Git 追蹤中移除（保留本地檔案）
git rm --cached .env
git rm --cached -r db/

# 更新 .gitignore（已完成）
# 提交變更
git add .gitignore
git commit -m "security: 移除敏感檔案並更新 .gitignore"
```

---

## 🔍 接下來需要做什麼

### 1. 提交變更

```powershell
# 查看變更狀態
git status

# 加入所有安全改進
git add .

# 提交
git commit -m "security: 完整安全性改進

- 更新 .gitignore 排除敏感檔案
- 加強生產環境 CORS 檢查
- 改善錯誤處理避免資訊洩漏
- 新增前端輸入驗證工具
- 新增自動安全檢查腳本
- 建立安全部署指南
- 從 Git 移除 .env 和資料庫檔案"

# 推送到遠端
git push origin main
```

### 2. ⚠️ 檢查 Git 歷史（重要）

敏感檔案雖然已停止追蹤，但**仍存在於 Git 歷史**中！

#### 選項 A：接受風險（適用於內部專案）
如果這是內部專案且：
- `.env` 中的設定值都是開發環境設定
- 資料庫中沒有真實的敏感資料
- 可以更換所有密碼和金鑰

則可以：
1. 更換 `.env` 中所有的值
2. 建立新的管理員帳號並刪除舊帳號
3. 繼續使用現有的 Git 歷史

#### 選項 B：完全清理歷史（建議用於公開專案）

**警告**：這會改寫 Git 歷史，所有協作者需要重新 clone！

```powershell
# 使用 BFG Repo-Cleaner（建議）
# 1. 下載 BFG: https://rtyley.github.io/bfg-repo-cleaner/
# 2. 建立備份
git clone --mirror https://github.com/yourusername/yourrepo.git

# 3. 執行清理
java -jar bfg.jar --delete-files .env yourrepo.git
java -jar bfg.jar --delete-folders db yourrepo.git

# 4. 清理歷史
cd yourrepo.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 5. 強制推送（會覆蓋遠端歷史）
git push --force
```

或使用 git-filter-branch（較慢但內建）：

```powershell
# 從所有歷史中移除 .env
git filter-branch --force --index-filter `
  "git rm --cached --ignore-unmatch .env" `
  --prune-empty --tag-name-filter cat -- --all

# 從所有歷史中移除 db/ 目錄
git filter-branch --force --index-filter `
  "git rm --cached --ignore-unmatch -r db/" `
  --prune-empty --tag-name-filter cat -- --all

# 清理
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 強制推送
git push origin --force --all
git push origin --force --tags
```

### 3. 通知協作者

如果清理了 Git 歷史，通知所有協作者：

```text
重要：我們已清理了 Git 歷史以移除敏感檔案

請執行以下步驟：
1. 備份您的本地更改
2. 刪除本地 repository
3. 重新 clone: git clone <repo-url>
4. 重新應用您的本地更改
```

---

## 🔐 防止未來再次發生

### 1. 使用 Git Hooks（建議）

建立 `.git/hooks/pre-commit`（已提供範例）：

```bash
#!/bin/sh
# Pre-commit hook: 檢查敏感檔案

if git diff --cached --name-only | grep -E '\.env$|db/.*\.db'; then
    echo "❌ 錯誤：嘗試提交敏感檔案！"
    echo "請檢查 .gitignore 並移除這些檔案："
    git diff --cached --name-only | grep -E '\.env$|db/.*\.db'
    exit 1
fi
```

安裝 hook：
```powershell
# Linux/Mac
cp .git/hooks/pre-commit.sample .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# Windows (在 Git Bash 中)
cp .git/hooks/pre-commit.sample .git/hooks/pre-commit
```

### 2. 使用 Git Secrets（進階）

安裝 git-secrets 工具：
```powershell
# 使用 Chocolatey
choco install git-secrets

# 或手動安裝: https://github.com/awslabs/git-secrets
```

配置：
```powershell
cd /path/to/your/repo
git secrets --install
git secrets --register-aws
```

### 3. 定期執行安全檢查

```powershell
# 每次 commit 前
npm run security-check

# 或設定為 Git hook
echo "npm run security-check" > .git/hooks/pre-commit
```

---

## 📝 檢查清單

部署到生產環境前：

- [ ] 已從 Git 移除 `.env` 和資料庫檔案
- [ ] 已更新 `.gitignore`
- [ ] 已檢查 Git 歷史（並決定是否清理）
- [ ] 已更換所有敏感資訊（密碼、金鑰等）
- [ ] 已通知協作者（如果清理了歷史）
- [ ] 已設定 Git hooks 防止未來再犯
- [ ] 已執行 `npm run security-check` 無錯誤

---

## 🆘 如果敏感資訊已外洩

1. **立即行動**
   - 更換所有密碼和 API 金鑰
   - 檢查是否有未授權存取
   - 通知相關人員

2. **評估影響**
   - 哪些資訊被暴露？
   - 誰可能存取過？
   - 持續多久？

3. **採取補救措施**
   - 更新所有受影響的系統
   - 強化存取控制
   - 啟用雙因素認證

4. **記錄與學習**
   - 記錄事件經過
   - 分析根本原因
   - 改進流程防止再發生

---

## 📞 需要協助？

如有任何安全疑慮，請聯絡：
- 技術支援：[您的 Email]
- 安全團隊：[安全 Email]

---

**最後更新**：2025-10-01
