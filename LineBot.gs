/**
 * LINE Bot 訊息處理
 */

// ===== 處理文字訊息 =====
function handleTextMessage(event) {
  const userId = event.source?.userId || '';
  const replyToken = event.replyToken || '';
  const text = (event.message?.text || '').trim();
  const sourceType = event.source?.type || 'user'; // user / group / room
  
  if (!userId) return;
  
  // 取得用戶名稱
  const userName = getLineProfile(userId)?.displayName || '顧客';
  
  // ===== 綁定指令：支援「綁定 09xx」和純電話號碼 =====
  const bindMatch = text.match(/^(綁定)\s*(.+)$/) || text.match(/^(09\d{8})$/);
  if (bindMatch) {
    const phone = bindMatch[2]?.trim() || bindMatch[1];
    handleBindCommand(userId, phone, userName, replyToken);
    return;
  }
  
  // ===== @order 點餐指令 =====
  if (text.toLowerCase().startsWith('@order') || text.toLowerCase().startsWith('/order')) {
    handleOrderCommand(text, userId, userName, replyToken, sourceType);
    return;
  }
  
  // ===== 我的訂單 =====
  if (text === '我的訂單' || text === '/我的訂單') {
    handleMyOrders(userId, replyToken);
    return;
  }
  
  // ===== 聯絡我們 =====
  if (text === '聯絡我們' || text === '/聯絡我們') {
    handleContactCommand(replyToken);
    return;
  }
  
  // ===== 今日菜單 =====
  if (['今日菜單', '看菜單', 'menu'].includes(text)) {
    handleMenuCommand(replyToken);
    return;
  }
  
  // ===== 未知指令（私人DM才回覆）=====
  if (sourceType === 'user' && replyToken) {
    lineReply(replyToken, '📌 收到：' + text + '\n\n要點餐請傳「@order 品項x數量」\n例如：@order 排骨便當x2 + 涼麵x1\n\n或前往 LIFF 點餐頁面：\n' + LIFF_URL);
  }
}

// ===== 處理綁定 =====
function handleBindCommand(userId, phone, userName, replyToken) {
  upsertCustomer(phone, userId, userName);
  
  const msg = '✅ LINE 帳號綁定成功！\n' +
              '📞 電話：' + phone + '\n\n' +
              '未來點餐後，廚房狀態更新時您會收到 LINE 通知。\n\n' +
              '現在可以前往點餐頁面訂購餐點：\n' + LIFF_URL;
  
  lineReply(replyToken, msg);
  console.log('[BIND] userId=' + userId + ' bound to phone=' + phone + ' name=' + userName);
}

// ===== 處理點餐指令 =====
function handleOrderCommand(text, userId, userName, replyToken, sourceType) {
  const cmd = text.split(/\s+/).slice(1).join(' ').trim();
  if (!cmd) {
    lineReply(replyToken, '📝 請輸入餐點，例如：\n@order 排骨便當x2 + 涼麵x1');
    return;
  }
  
  // 解析品項
  const items = parseOrderItems(cmd);
  if (items.length === 0) {
    lineReply(replyToken, '❌ 找不太到「' + cmd + '」，請確認品名後再傳一次\n\n📝 範例：@order 排骨便當x2 + 涼麵x1');
    return;
  }
  
  // 自動綁定（如果是私人DM來的，順便綁定）
  if (sourceType === 'user') {
    // 暫時不明確電話，先建立 LINE userId 記錄
    console.log('[AUTO_BIND] userId=' + userId + ' name=' + userName);
  }
  
  // 建立訂單
  const orderId = generateOrderId();
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const now = new Date();
  const order = {
    id: orderId,
    phone: '', // 尚未填寫電話
    user_id: userId,
    name: userName,
    items: items,
    total: total,
    location: '外送',
    status: 'pending',
    created_at: formatDate(now)
  };
  
  saveOrder(order);
  
  // 回覆顧客
  let replyMsg = '✅ ' + userName + ' 已點餐\n' +
                 '📋 訂單 #' + orderId + '\n' +
                 '━━━━━━━━━━━━━━━\n';
  for (const item of items) {
    replyMsg += '- ' + item.name + ' x' + item.qty + ' = $' + (item.price * item.qty) + '\n';
  }
  replyMsg += '━━━━━━━━━━━━━━━\n' +
              '💰 合計：$' + total + '\n' +
              '⏳ 等待廚房確認中...';
  
  if (sourceType !== 'user') {
    lineReply(replyToken, replyMsg); // 群組才回覆公開訊息
  }
  
  // 推播廚房
  let pushToKitchen = '🏎 新訂單 from ' + userName + '\n' +
                      '📋 #' + orderId + '\n' +
                      '━━━━━━━━━━━━━━━\n';
  for (const item of items) {
    pushToKitchen += '- ' + item.name + ' x' + item.qty + '\n';
  }
  pushToKitchen += '━━━━━━━━━━━━━━━\n' +
                   '💰 合計：$' + total + '\n' +
                   '🕐 ' + formatDate(now);
  
  linePush(LINE_USER_ID, pushToKitchen);
  
  // 推播顧客確認
  if (userId) {
    linePush(userId, replyMsg);
  }
}

// ===== 處理我的訂單 =====
function handleMyOrders(userId, replyToken) {
  const allOrders = getActiveOrders();
  const myOrders = allOrders.filter(o => o.user_id === userId);
  
  if (myOrders.length === 0) {
    lineReply(replyToken, '📋 目前沒有未完成的訂單，歡迎點餐！\n傳「@order 品項x數量」即可下訂');
    return;
  }
  
  let msg = '📋 您的訂單列表\n━━━━━━━━━━━━━━━\n';
  for (const o of myOrders) {
    const statusDisplay = {
      'pending': '⏳ 待製作',
      'preparing': '👨‍🍳 製作中',
      'ready': '📢 待取餐'
    }[o.status] || o.status;
    
    msg += '#' + o.id + ' | ' + statusDisplay + '\n';
    msg += '  ' + o.items_str + '\n';
    msg += '  💰 $' + o.total + ' | 🕐 ' + o.created_at + '\n\n';
  }
  
  lineReply(replyToken, msg);
}

// ===== 處理聯絡我們 =====
function handleContactCommand(replyToken) {
  const msg = '📞 粉紅超跑聯絡資訊\n\n' +
              '🍗 粉絲專線：09-09-09-2299\n' +
              '💬 LINE：@923jheay\n' +
              '🚗 外送區域：蘆竹、大園、大湳、中壢\n' +
              '⏰ 營業時間：全天配送\n\n' +
              '感謝您對粉紅超跑的支持！';
  lineReply(replyToken, msg);
}

// ===== 處理今日菜單 =====
function handleMenuCommand(replyToken) {
  const msg = '📋 粉紅超跑完整菜單\n' +
              '━━━━━━━━━━━━━━━\n' +
              '🍜 麵食：泡麵 $60 / 涼麵 $50\n' +
              '🍚 飯類：排骨便當 $100 / 雞腿便當 $100\n' +
              '🍗 炸物：炸雞排 $70 / 薯條 $40 / 炸雞翅 $40\n' +
              '🥢 滷味：滷蛋 $20 / 豆干 $15 / 鴨頭 $30\n' +
              '🧋 飲料：冰飲 $35 / 咖啡 $40 / 手工搖飲 $50\n' +
              '📦 其他：香菸 $100 / 檳榔 $50\n' +
              '━━━━━━━━━━━━━━━\n' +
              '📝 點餐：@order 排骨便當x2 + 涼麵x1';
  lineReply(replyToken, msg);
}

// ===== 處理 Postback（Flex Message 按鈕）=====
function handlePostback(event) {
  const userId = event.source?.userId || '';
  const replyToken = event.replyToken || '';
  const data = event.postback?.data || '';
  
  if (data.startsWith('action=confirm_delivery')) {
    // 解析 order_id
    const match = data.match(/order_id=(.+)/);
    if (match) {
      const orderId = match[1];
      const order = getOrderById(orderId);
      
      if (order && order.user_id === userId && order.status === 'ready') {
        updateOrderStatus(orderId, 'delivered');
        lineReply(replyToken, '🚗 您的訂單已外送完成，祝您用餐愉快！⭐ 感謝您的5星好評');
      } else if (order) {
        lineReply(replyToken, '❌ 訂單 #' + orderId + ' 目前狀態為「' + order.status + '」，無法確認');
      } else {
        lineReply(replyToken, '❌ 找不到訂單 #' + orderId);
      }
    }
  }
}

// ===== 解析點餐文字 =====
function parseOrderItems(text) {
  const MENU = [
    { name: '泡麵', price: 60 },
    { name: '涼麵', price: 50 },
    { name: '排骨便當', price: 100 },
    { name: '雞腿便當', price: 100 },
    { name: '炸雞排', price: 70 },
    { name: '薯條', price: 40 },
    { name: '炸雞翅', price: 40 },
    { name: '滷蛋', price: 20 },
    { name: '豆干', price: 15 },
    { name: '鴨頭', price: 30 },
    { name: '冰飲', price: 35 },
    { name: '咖啡', price: 40 },
    { name: '手工搖飲', price: 50 },
    { name: '香菸', price: 100 },
    { name: '檳榔', price: 50 }
  ];
  
  const items = [];
  const parts = text.split(/[+,]/);
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    const m = trimmed.match(/(.+?)\s*[xX×]\s*(\d+)/);
    const name = m ? m[1].trim() : trimmed;
    const qty = m ? parseInt(m[2]) : 1;
    
    const matched = MENU.find(i => name.includes(i.name) || i.name.includes(name));
    if (matched) {
      items.push({ name: matched.name, price: matched.price, qty: qty });
    }
  }
  
  return items;
}

// ===== 取得 LINE 用戶資料 =====
function getLineProfile(userId) {
  if (!userId) return null;
  
  try {
    const url = 'https://api.line.me/v2/bot/profile/' + userId;
    const response = UrlFetchApp.fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
      },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    }
  } catch (err) {
    console.error('[GET_PROFILE_ERROR]', err);
  }
  
  return null;
}

// ===== 工具函式 =====
function generateOrderId() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function formatDate(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return (m < 10 ? '0' : '') + m + '/' + (d < 10 ? '0' : '') + d + ' ' + hh + ':' + mm;
}