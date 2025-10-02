# ============================================
# 資料庫檔案權限設定腳本 (Windows PowerShell)
# ============================================
# 
# 此腳本用於設定 SQLite 資料庫檔案的安全權限
# 確保只有當前使用者可以讀寫資料庫檔案
#
# 使用方式：
#   .\scripts\set-db-permissions.ps1
#
# ============================================

Write-Host "🔒 開始設定資料庫檔案權限..." -ForegroundColor Cyan
Write-Host ""

# 檢查資料庫目錄是否存在
$dbDir = Join-Path $PSScriptRoot "..\db"
if (-not (Test-Path $dbDir)) {
    Write-Host "❌ 錯誤：資料庫目錄不存在: $dbDir" -ForegroundColor Red
    Write-Host "   請先啟動伺服器以建立資料庫。" -ForegroundColor Yellow
    exit 1
}

# 取得當前使用者
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host "👤 當前使用者: $currentUser" -ForegroundColor Green
Write-Host "📁 資料庫目錄: $dbDir" -ForegroundColor Green
Write-Host ""

# 取得所有資料庫相關檔案
$dbFiles = Get-ChildItem -Path $dbDir -Include "*.db", "*.db-wal", "*.db-shm" -Recurse

if ($dbFiles.Count -eq 0) {
    Write-Host "⚠️  警告：未找到任何資料庫檔案" -ForegroundColor Yellow
    Write-Host "   請先啟動伺服器以建立資料庫。" -ForegroundColor Yellow
    exit 0
}

Write-Host "🔍 找到 $($dbFiles.Count) 個檔案需要設定權限：" -ForegroundColor Cyan
$dbFiles | ForEach-Object {
    Write-Host "   - $($_.Name)" -ForegroundColor Gray
}
Write-Host ""

# 詢問確認
$confirmation = Read-Host "是否繼續設定權限？這會移除所有繼承權限，只保留當前使用者的存取權 (Y/N)"
if ($confirmation -ne 'Y' -and $confirmation -ne 'y') {
    Write-Host "❌ 已取消操作" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "⚙️  開始設定權限..." -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$errorCount = 0

foreach ($file in $dbFiles) {
    try {
        Write-Host "📝 處理: $($file.Name)..." -ForegroundColor Gray
        
        # 取得當前 ACL
        $acl = Get-Acl -Path $file.FullName
        
        # 停用繼承並移除所有繼承的權限
        $acl.SetAccessRuleProtection($true, $false)
        
        # 移除所有現有規則
        $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
        
        # 只為當前使用者新增完全控制權限
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $currentUser,
            "FullControl",
            "Allow"
        )
        $acl.AddAccessRule($accessRule)
        
        # 套用新的 ACL
        Set-Acl -Path $file.FullName -AclObject $acl
        
        Write-Host "   ✅ 成功" -ForegroundColor Green
        $successCount++
    }
    catch {
        Write-Host "   ❌ 失敗: $_" -ForegroundColor Red
        $errorCount++
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "📊 設定完成統計：" -ForegroundColor Cyan
Write-Host "   ✅ 成功: $successCount 個檔案" -ForegroundColor Green
Write-Host "   ❌ 失敗: $errorCount 個檔案" -ForegroundColor Red
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($errorCount -eq 0) {
    Write-Host "🎉 所有資料庫檔案權限已成功設定！" -ForegroundColor Green
    Write-Host ""
    Write-Host "💡 提示：" -ForegroundColor Yellow
    Write-Host "   - 檔案現在只有您可以存取" -ForegroundColor Gray
    Write-Host "   - 如需備份，請確保有足夠的權限" -ForegroundColor Gray
    Write-Host "   - 部署到伺服器時，請以伺服器使用者執行此腳本" -ForegroundColor Gray
} else {
    Write-Host "⚠️  部分檔案設定失敗，請檢查錯誤訊息" -ForegroundColor Yellow
    Write-Host "   常見原因：" -ForegroundColor Gray
    Write-Host "   - 檔案正在被使用（請關閉伺服器）" -ForegroundColor Gray
    Write-Host "   - 權限不足（請以管理員身分執行）" -ForegroundColor Gray
}

Write-Host ""
