# 貢獻指南

感謝你願意讓叫號喵變得更好。這份文件說明如何回報問題、提出修改，以及送出 Pull Request 前要檢查什麼。

---

## 目錄

- [開始之前](#開始之前)
- [回報問題與提出建議](#回報問題與提出建議)
- [準備開發環境](#準備開發環境)
- [開發規範](#開發規範)
- [送出 Pull Request](#送出-pull-request)
- [提交訊息格式](#提交訊息格式)

---

## 開始之前

- 行為準則：參與本專案即表示你同意遵守[行為準則](CODE_OF_CONDUCT.md)。
- 安全漏洞：請不要開公開 Issue，改依 [SECURITY.md](SECURITY.md) 私下回報。
- 較大的改動：新增功能、改變 API 或資料庫結構之前，請先開 Issue 討論，避免做完才發現方向不合。

---

## 回報問題與提出建議

到 [Issues](https://github.com/Scorpio-meow/CallMiao/issues/new/choose) 選擇對應的範本：

| 類型 | 何時使用 |
|------|----------|
| 回報錯誤 | 行為與文件不符，或發生錯誤 |
| 功能建議 | 想要新增或調整功能 |
| 無障礙問題 | 遇到使用上的障礙 |

回報錯誤時請附上版本、執行環境、重現步驟與伺服器的錯誤訊息。**不要貼上 `.env` 的內容、`SESSION_SECRET` 或任何帳號密碼。**

---

## 準備開發環境

需要 [Bun](https://bun.sh/)；改用 Node.js 時需要 22 以上，做法見 [README](README.md#需求)。

1. Fork 並複製專案：

   ```bash
   git clone https://github.com/<你的帳號>/CallMiao.git
   cd CallMiao
   ```

2. 安裝相依套件：

   ```bash
   bun install
   ```

3. 複製 `.env.example` 為 `.env` 並填入必填變數，各變數的意思見[環境變數設定](docs/configuration.md)。

4. 啟動開發伺服器，檔案變更時會自動重啟：

   ```bash
   bun run dev
   ```

建立管理員帳號的方式見 [README](README.md#4-建立第一個管理員帳號)。

---

## 開發規範

### 程式碼

- 前端是不需建置的原生 HTML、CSS 與 JavaScript，請不要引入建置工具或前端框架。
- 內容安全政策為 `script-src 'self'` 與 `style-src 'self'`：不能寫行內 `<script>`、事件屬性與 `style=""`，需要的程式與樣式放進對應資料夾的 `index.js` 與 `style.css`。
- 顯示使用者輸入的內容一律用 `textContent`，不要用 `innerHTML` 拼接。
- 設定值來自 `.env`，不要在程式裡寫死，也不要加預設值；缺少必填設定時應該直接拒絕啟動。
- 不寫程式碼註解，用清楚的命名表達意圖。
- 不使用 emoji。

### 介面

- 後台、櫃員工作台、登入頁共用 [`public/shared/base.css`](public/shared/base.css) 的設計變數與元件，新增樣式時優先沿用。
- 每個操作區只放一個主按鈕；確認與輸入使用 `<dialog>`，不要用 `prompt()`、`confirm()`、`alert()`。
- 手機頁面要避讓安全區，觸控目標至少 44px。
- 完成後請對照[無障礙聲明](ACCESSIBILITY.md)，確認鍵盤操作與對比度沒有退步。

### 文件

- 文件使用繁體中文，格式比照 `docs/` 下的既有文件。
- 行為、API、環境變數有變動時，同步更新對應文件與 [CHANGELOG.md](CHANGELOG.md)。

---

## 送出 Pull Request

1. 從 `main` 開一個新分支，名稱簡短描述用途，例如 `fix/ticket-recall`。
2. 一個 Pull Request 只處理一件事。
3. 在本機確認：

   ```bash
   bun test
   bun audit
   ```

4. 修改 API 或資料庫行為時，在 `test/server.test.js` 補上測試。
5. 推上你的 Fork，開 Pull Request 並填寫範本中的檢查清單。

維護者會檢視並提出意見；請在同一個分支上追加修改，不需要重開 Pull Request。

---

## 提交訊息格式

採用 [Conventional Commits](https://www.conventionalcommits.org/zh-hant/v1.0.0/)：

```text
<類型>(<範圍>)<!>: <一句話說明>
```

| 類型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修正錯誤 |
| `docs` | 只改文件 |
| `refactor` | 不改變行為的重構 |
| `test` | 新增或調整測試 |
| `chore` | 相依套件、設定等雜項 |

破壞性變更在類型後加上 `!`，並在內文說明升級方式。範例：

```text
fix(security)!: 依稽核修補櫃台授權與取號上限
```
