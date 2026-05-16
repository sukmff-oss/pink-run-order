# 粉紅超跑 LINE 點餐系統 - GAS 後端設定指南

## 快速設定（5 分鐘）

### Step 1: 建立 Google Apps Script 專案

1. 前往 https://script.google.com
2. 點「+ 新增專案」
3. 刪除預設的 `Code.gs`，分別建立以下四個檔案：
   - `Code.gs`（主要入口 + 初始化）
   - `Database.gs`（Google Sheets 資料庫）
   - `LineBot.gs`（LINE 機器人處理）
   - `Api.gs`（LIFF 點餐 API + 廚房面板）

### Step 2: 設定腳本屬性

1. 點左側「專案設定」⚙️
2. 勾選「顯示 gs 檔案的指令碼屬性 manifest」
3. 在 `appsscript.json` 加入：

```json
{
  "scriptProperties": {
    "properties": {
      "LINE_ACCESS_TOKEN": "你的Channel Access Token",
      "LINE_USER_ID": "你的LINE UserId"
    }
  }
}
```

或者在 GAS 介面手動設定：
1. 檔案 → 專案設定 → 指令碼屬性
2. 新增 `LINE_ACCESS_TOKEN` = 你的 Token
3. 新增 `LINE_USER_ID` = 你的 LINE UID
4. 新增 `SPREADSHEET_ID` = （等 Step 3 完成後填入）

### Step 3: 初始化資料庫

1. 在 `Code.gs` 中選 `setupSheets` 函式
2. 點「執行」→「執行函式」→「setupSheets」
3. 第一次執行需要授權（點「授權」）
4. 完成後複製輸出的 **試算表 ID**（長得像 `1ABC123xyz...`）
5. 貼到 `SPREADSHEET_ID` 屬性

### Step 4: 部署為 Web App

1. 點「部署」→ 「新增部署」→ ⚙️（設定）
2. 類型： **網頁應用程式**
3. 執行身份： **我**
4. 可存取範圍： **任何人**
5. 點「部署」
6. 複製 **Web App 網址**（長得像 `https://script.google.com/macros/s/XXX/exec`）

### Step 5: 設定 LINE Webhook

1. 前往 LINE Developers Console
2. 進入你的 Messaging API 頻道
3. 點「Messaging API」→「Edit」
4. Webhook URL 填入：
   ```
   https://script.google.com/macros/s/XXX/exec
   ```
5. 點「Verify」確認
6. 啟用 Webhook

## 設定完成的驗證

### 健康檢查
```
https://script.google.com/macros/s/XXX/exec?test=ping
```
預期輸出：`pong`

### 廚房面板
```
https://script.google.com/macros/s/XXX/exec?panel=1
```
預期：看到廚房管理介面

### LINE 測試
傳「我的訂單」到 LINE 官方帳號，應收到回覆

## 架構說明

```
LINE 群組/私聊
    ↓
LINE Messaging API → Webhook
    ↓
GAS Web App (doPost)
    ↓
handleLineWebhook() → 處理綁定/點餐指令
    ↓
Google Sheets (永久儲存)
    ↓
linePush() / lineReply() → 發 LINE 通知

LIFF 網頁 → POST JSON
    ↓
GAS Web App (doPost)
    ↓
handleOrderApi() → 建立訂單
    ↓
Google Sheets (永久儲存)
    ↓
linePush() → 推播廚房
```

## 常見問題

### Q: LINE Webhook 驗證失敗
A: 確認 Web App 部署為「任何人可存取」，每次修改後需重新部署

### Q: 推播訊息沒收到
A: 檢查 LINE_ACCESS_TOKEN 是否正確，是否有設定 LINE_USER_ID

### Q: 資料庫找不到資料
A: 確認 SPREADSHEET_ID 已設定，並執行過 setupSheets()

### Q: 每次修改後要重新部署嗎？
A: 只修改一般函式：一般需要重新部署。修改 doPost/doGet：需要重新部署。修改其他函式：可直接執行。

## LIFF 網頁對接方式

在 LIFF 頁面送出訂單時：

```javascript
const res = await fetch('https://script.google.com/macros/s/XXX/exec', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'liff',         // 識別這是 LIFF 點餐
    name: '顧客名',
    phone: '0912345678',
    items: [{name: '排骨便當', price: 100, qty: 1}],
    total: 100,
    location: '大園區',
    line_user_id: liffUserId  // 可選
  })
});
```

## 測試流程

1. LINE 私聊傳「綁定 0912345678」→ 系統回「綁定成功」
2. LIFF 頁面點餐（填 0912345678）→ 收到 LINE 確認
3. 廚房面板按「開始製作」→ 收到「👨‍🍳 開始製作」
4. 廚房面板按「備好」→ 收到「✅ 餐點已備好」