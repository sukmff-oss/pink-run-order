/**
 * Google Sheets 資料庫操作
 */

// ===== 取得試算表 =====
function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID 未設定！請先執行 setupSheets() 並設定屬性。');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ===== 初始化試算表結構 =====
function setupSheets() {
  const ss = SpreadsheetApp.create('粉紅超跑點餐資料庫');
  const ssId = ss.getId();
  
  // 儲存到腳本屬性
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ssId);
  
  // ===== 顧客資料表 =====
  const customerSheet = ss.getSheetByName('顧客') || ss.insertSheet('顧客');
  customerSheet.getRange('A1:F1').setValues([['電話', 'LINE UserId', '姓名', '建立時間', '更新时间', '備註']]);
  customerSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#ff6b9d').setFontColor('#ffffff');
  customerSheet.setFrozenRows(1);
  
  // ===== 訂單資料表 =====
  const orderSheet = ss.getSheetByName('訂單') || ss.insertSheet('訂單');
  orderSheet.getRange('A1:J1').setValues([['訂單ID', '電話', 'LINE UserId', '姓名', '品項', '總金額', '外送地點', '狀態', '建立時間', '更新时间']]);
  orderSheet.getRange('A1:J1').setFontWeight('bold').setBackground('#ff6b9d').setFontColor('#ffffff');
  orderSheet.setFrozenRows(1);
  
  console.log('✅ 試算表建立完成！');
  console.log('試算表 ID：' + ssId);
  console.log('請將此 ID 設定到 SPREADSHEET_ID');
  
  return ssId;
}

// ===== 顧客資料操作 =====

// 查詢顧客（以電話為 key）
function getCustomerByPhone(phone) {
  if (!phone) return null;
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('顧客');
  const data = sheet.getDataRange().getValues();
  
  // 找表頭
  const headers = data[0];
  const phoneIdx = headers.indexOf('電話');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][phoneIdx] == phone) {
      return {
        phone: data[i][phoneIdx],
        line_user_id: data[i][headers.indexOf('LINE UserId')] || '',
        name: data[i][headers.indexOf('姓名')] || '',
        created_at: data[i][headers.indexOf('建立時間')] || ''
      };
    }
  }
  return null;
}

// 查詢顧客（以 LINE UserId 為 key）
function getCustomerByLineUid(lineUserId) {
  if (!lineUserId) return null;
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('顧客');
  const data = sheet.getDataRange().getValues();
  
  const headers = data[0];
  const uidIdx = headers.indexOf('LINE UserId');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][uidIdx] == lineUserId) {
      return {
        phone: data[i][headers.indexOf('電話')] || '',
        line_user_id: data[i][uidIdx],
        name: data[i][headers.indexOf('姓名')] || '',
        created_at: data[i][headers.indexOf('建立時間')] || ''
      };
    }
  }
  return null;
}

// 新增或更新顧客（以電話為 key）
function upsertCustomer(phone, lineUserId, name = '') {
  if (!phone || !lineUserId) return false;
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('顧客');
  const now = new Date();
  
  // 檢查是否已存在
  const existing = getCustomerByPhone(phone);
  
  if (existing) {
    // 更新
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const phoneIdx = headers.indexOf('電話');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][phoneIdx] == phone) {
        sheet.getRange(i + 1, headers.indexOf('LINE UserId') + 1).setValue(lineUserId);
        sheet.getRange(i + 1, headers.indexOf('姓名') + 1).setValue(name || existing.name);
        sheet.getRange(i + 1, headers.indexOf('更新时间') + 1).setValue(now);
        break;
      }
    }
    console.log('[DB] Customer updated: phone=' + phone + ' line_user_id=' + lineUserId);
  } else {
    // 新增
    sheet.appendRow([phone, lineUserId, name, now, now, '']);
    console.log('[DB] Customer created: phone=' + phone + ' line_user_id=' + lineUserId);
  }
  return true;
}

// ===== 訂單資料操作 =====

// 儲存訂單
function saveOrder(order) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('訂單');
  const now = new Date();
  
  // 品項轉字串
  const itemsStr = order.items.map(i => i.name + 'x' + i.qty).join('、');
  
  sheet.appendRow([
    order.id,
    order.phone || '',
    order.user_id || '',
    order.name || '',
    itemsStr,
    order.total,
    order.location || '',
    order.status || 'pending',
    order.created_at || now,
    now
  ]);
  
  console.log('[DB] Order saved: ' + order.id);
  return true;
}

// 查詢訂單（以訂單ID）
function getOrderById(orderId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('訂單');
  const data = sheet.getDataRange().getValues();
  
  const headers = data[0];
  const idIdx = headers.indexOf('訂單ID');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] == orderId) {
      return {
        id: data[i][idIdx],
        phone: data[i][headers.indexOf('電話')] || '',
        user_id: data[i][headers.indexOf('LINE UserId')] || '',
        name: data[i][headers.indexOf('姓名')] || '',
        items_str: data[i][headers.indexOf('品項')] || '',
        total: data[i][headers.indexOf('總金額')] || 0,
        location: data[i][headers.indexOf('外送地點')] || '',
        status: data[i][headers.indexOf('狀態')] || '',
        created_at: data[i][headers.indexOf('建立時間')] || ''
      };
    }
  }
  return null;
}

// 更新訂單狀態
function updateOrderStatus(orderId, newStatus) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('訂單');
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  const headers = data[0];
  const idIdx = headers.indexOf('訂單ID');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] == orderId) {
      sheet.getRange(i + 1, headers.indexOf('狀態') + 1).setValue(newStatus);
      sheet.getRange(i + 1, headers.indexOf('更新时间') + 1).setValue(now);
      console.log('[DB] Order ' + orderId + ' status updated to ' + newStatus);
      return true;
    }
  }
  return false;
}

// 查詢未完成訂單
function getActiveOrders() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('訂單');
  const data = sheet.getDataRange().getValues();
  
  const headers = data[0];
  const statusIdx = headers.indexOf('狀態');
  const result = [];
  
  for (let i = 1; i < data.length; i++) {
    const status = data[i][statusIdx];
    if (status !== 'delivered' && status !== 'cancelled') {
      result.push({
        id: data[i][headers.indexOf('訂單ID')],
        phone: data[i][headers.indexOf('電話')] || '',
        user_id: data[i][headers.indexOf('LINE UserId')] || '',
        name: data[i][headers.indexOf('姓名')] || '',
        items_str: data[i][headers.indexOf('品項')] || '',
        total: data[i][headers.indexOf('總金額')] || 0,
        location: data[i][headers.indexOf('外送地點')] || '',
        status: status,
        created_at: data[i][headers.indexOf('建立時間')] || ''
      });
    }
  }
  return result;
}

// ===== 測試資料庫 =====
function testDatabase() {
  console.log('=== 測試資料庫 ===');
  
  // 測試顧客
  upsertCustomer('0912345678', 'U42399a8c32c2980e1df24f3a22e3146d', '測試顧客');
  const customer = getCustomerByPhone('0912345678');
  console.log('顧客查詢：', customer);
  
  // 測試訂單
  const testOrder = {
    id: 'TEST' + Date.now(),
    phone: '0912345678',
    user_id: 'U42399a8c32c2980e1df24f3a22e3146d',
    name: '測試顧客',
    items: [{ name: '排骨便當', qty: 2 }],
    total: 200,
    location: '大園區',
    status: 'pending',
    created_at: new Date()
  };
  saveOrder(testOrder);
  const order = getOrderById(testOrder.id);
  console.log('訂單查詢：', order);
  
  console.log('=== 測試完成 ===');
}