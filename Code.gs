/**
 * 粉紅超跑 LINE 點餐系統 - Google Apps Script 後端
 *
 * 設定步驟：
 * 1. 在 script.google.com 新增專案
 * 2. 分別建立 Code.gs、Database.gs、LineBot.gs、Api.gs
 * 3. 在「專案設定」填入以下「指令碼屬性」：
 *    - LINE_ACCESS_TOKEN: 你的 LINE Channel Access Token
 *    - LINE_USER_ID: 管理員 LINE UserId
 *    - SPREADSHEET_ID: 執行 setupSheets() 後取得的試算表 ID
 * 4. 執行 setupSheets() 建立資料庫
 * 5. 部署為 Web App（每次編輯後需重新部署）
 * 6. 將 Web App 網址填入 LINE Developers Console Webhook
 */

// ===== CORS 工具函式 =====
function makeCorsTextOutput(text) {
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.TEXT)
    .addHeader('Access-Control-Allow-Origin', '*');
}

function makeCorsJsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .addHeader('Access-Control-Allow-Origin', '*');
}

// ===== OPTIONS（處理 CORS preflight）=====
function doOptions(e) {
  return ContentService.createTextOutput('')
    .addHeader('Access-Control-Allow-Origin', '*')
    .addHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .addHeader('Access-Control-Allow-Headers', 'Content-Type')
    .addHeader('Access-Control-Max-Age', '3600');
}

// ===== HTTP 請求分派（統一的 doPost）=====
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');

    // LINE Webhook（有 events 陣列）
    if (data.events && Array.isArray(data.events)) {
      handleLineWebhook(data);
      return makeCorsTextOutput('OK');
    }

    // LIFF 點餐 API
    if (data.action === 'order') {
      return handleOrderApi(data);
    }

    // 廚房更新訂單狀態
    if (data.action === 'kitchenUpdate') {
      return handleKitchenUpdateApi(data);
    }

    // 未知請求
    return makeCorsJsonOutput({ success: false, error: 'unknown request type' });

  } catch (err) {
    console.error('[DO_POST_ERROR]', err);
    return makeCorsJsonOutput({ success: false, error: err.toString() });
  }
}

// ===== GET 請求分派 =====
function doGet(e) {
  // CORS preflight
  if (e.parameter['cors'] === '1') {
    return makeCorsTextOutput('pong');
  }

  // Kitchen 面板（HTML 頁面）
  if (e.parameter.panel === '1') {
    return handleKitchenPanel();
  }

  // Kitchen API（JSON，給廚房面板 fetch 用）
  if (e.parameter.action === 'kitchenOrders') {
    return handleKitchenOrdersApi();
  }

  if (e.parameter.action === 'kitchenUpdate') {
    return handleKitchenUpdateApi({
      orderId: e.parameter.orderId,
      status: e.parameter.status
    });
  }

  // 健康檢查
  if (e.parameter.test === 'ping') {
    return makeCorsTextOutput('pong');
  }

  // 顯示說明
  const tokenSet = LINE_ACCESS_TOKEN ? '✅ 已設定' : '❌ 未設定';
  const userIdSet = LINE_USER_ID ? '✅ 已設定' : '❌ 未設定';
  const ssSet = SPREADSHEET_ID ? '✅ 已設定' : '❌ 未設定（請執行setupSheets()）';

  return HtmlService.createHtmlOutput(`
    <h1>粉紅超跑點餐系統 v4 (GAS)</h1>
    <ul>
      <li>LINE Webhook: <code>${ScriptApp.getScriptUrl()}</code></li>
      <li>廚房面板: <code>${ScriptApp.getScriptUrl()}?panel=1</code></li>
      <li>健康檢查: <code>${ScriptApp.getScriptUrl()}?test=ping</code></li>
    </ul>
    <h2>狀態</h2>
    <ul>
      <li>LINE_ACCESS_TOKEN: ${tokenSet}</li>
      <li>LINE_USER_ID: ${userIdSet}</li>
      <li>SPREADSHEET_ID: ${ssSet}</li>
    </ul>
  `);
}

// ===== 初始化試算表（第一次設定時執行一次）=====
function setupSheets() {
  const ss = SpreadsheetApp.create('LINE點餐系統_資料庫');
  const ssId = ss.getId();

  // 儲存到指令碼屬性
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ssId);

  // 顧客資料表
  const customerSheet = ss.getSheetByName('顧客') || ss.insertSheet('顧客');
  customerSheet.getRange('A1:F1').setValues([['電話', 'LINE UserId', '姓名', '建立時間', '更新時間', '備註']]);
  customerSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#ff6b9d').setFontColor('#ffffff');
  customerSheet.setFrozenRows(1);
  customerSheet.setColumnWidth(1, 120);
  customerSheet.setColumnWidth(2, 220);
  customerSheet.setColumnWidth(3, 100);

  // 訂單資料表
  const orderSheet = ss.getSheetByName('訂單') || ss.insertSheet('訂單');
  orderSheet.getRange('A1:J1').setValues([['訂單ID', '電話', 'LINE UserId', '姓名', '品項', '總金額', '外送地點', '狀態', '建立時間', '更新時間']]);
  orderSheet.getRange('A1:J1').setFontWeight('bold').setBackground('#ff6b9d').setFontColor('#ffffff');
  orderSheet.setFrozenRows(1);
  orderSheet.setColumnWidth(1, 100);
  orderSheet.setColumnWidth(5, 200);

  console.log('✅ 試算表建立完成！ID：\n' + ssId);

  return ssId;
}

// ===== 測試 LINE 推播 =====
function testLinePush() {
  if (!LINE_USER_ID) {
    console.log('LINE_USER_ID 未設定');
    return;
  }
  linePush(LINE_USER_ID, '✅ GAS 推播測試成功！\n時間：' + new Date());
}

// ===== 讀取指令碼屬性（確保 GAS 重啟後還能讀到）=====
function getScriptProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// 在 Cold Start 時主動讀取
const LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN');
const LINE_USER_ID = PropertiesService.getScriptProperties().getProperty('LINE_USER_ID');
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');