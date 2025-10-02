#!/bin/bash
# ============================================
# 資料庫檔案權限設定腳本 (Linux/macOS)
# ============================================
# 
# 此腳本用於設定 SQLite 資料庫檔案的安全權限
# 確保只有當前使用者可以讀寫資料庫檔案
#
# 使用方式：
#   chmod +x scripts/set-db-permissions.sh
#   ./scripts/set-db-permissions.sh
#
# ============================================

echo "🔒 開始設定資料庫檔案權限..."
echo ""

# 取得腳本所在目錄的父目錄
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DB_DIR="$SCRIPT_DIR/../db"

# 檢查資料庫目錄是否存在
if [ ! -d "$DB_DIR" ]; then
    echo "❌ 錯誤：資料庫目錄不存在: $DB_DIR"
    echo "   請先啟動伺服器以建立資料庫。"
    exit 1
fi

# 取得當前使用者
CURRENT_USER=$(whoami)

echo "👤 當前使用者: $CURRENT_USER"
echo "📁 資料庫目錄: $DB_DIR"
echo ""

# 計算資料庫檔案數量
DB_FILE_COUNT=$(find "$DB_DIR" -type f \( -name "*.db" -o -name "*.db-wal" -o -name "*.db-shm" \) | wc -l)

if [ "$DB_FILE_COUNT" -eq 0 ]; then
    echo "⚠️  警告：未找到任何資料庫檔案"
    echo "   請先啟動伺服器以建立資料庫。"
    exit 0
fi

echo "🔍 找到 $DB_FILE_COUNT 個檔案需要設定權限："
find "$DB_DIR" -type f \( -name "*.db" -o -name "*.db-wal" -o -name "*.db-shm" \) -exec basename {} \; | while read file; do
    echo "   - $file"
done
echo ""

# 詢問確認
read -p "是否繼續設定權限？這會將檔案權限設為 600 (只有擁有者可讀寫) (Y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 已取消操作"
    exit 0
fi

echo ""
echo "⚙️  開始設定權限..."
echo ""

SUCCESS_COUNT=0
ERROR_COUNT=0

# 設定資料庫目錄權限為 700 (只有擁有者可以進入)
echo "📝 設定資料庫目錄權限..."
if chmod 700 "$DB_DIR"; then
    echo "   ✅ 目錄權限已設為 700"
else
    echo "   ❌ 目錄權限設定失敗"
fi
echo ""

# 處理每個資料庫檔案
find "$DB_DIR" -type f \( -name "*.db" -o -name "*.db-wal" -o -name "*.db-shm" \) | while read file; do
    filename=$(basename "$file")
    echo "📝 處理: $filename..."
    
    if chmod 600 "$file"; then
        echo "   ✅ 成功 (權限: 600)"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "   ❌ 失敗"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
done

echo ""
echo "============================================"
echo "📊 設定完成統計："
echo "   ✅ 成功處理的檔案"
echo "============================================"
echo ""

# 顯示最終權限
echo "📋 當前權限狀態："
find "$DB_DIR" -type f \( -name "*.db" -o -name "*.db-wal" -o -name "*.db-shm" \) -ls | while read line; do
    echo "   $line"
done

echo ""
echo "🎉 資料庫檔案權限設定完成！"
echo ""
echo "💡 提示："
echo "   - 資料庫目錄權限: 700 (drwx------)"
echo "   - 資料庫檔案權限: 600 (-rw-------)"
echo "   - 只有當前使用者 ($CURRENT_USER) 可以存取"
echo "   - 部署到伺服器時，請以伺服器使用者執行此腳本"
echo ""
