/**
 * LIFF 網頁點餐 API + 廚房面板
 * 注意：不要在這裡定義 doPost，統一在 Code.gs 分派路由
 */

// ===== /order - 接收 LIFF 網頁點餐資料 =====
function handleOrderApi(data) {
  try {
    const phone = data.phone || '';
    const items = data.items || [];
    const total = data.total || 0;
    const lineUserId = data.line_user_id || '';
    const name = data.name || '';
    const location = data.location || '';

    if (!phone || items.length === 0) {
      return makeCorsJsonOutput({ success: false, error: '缺少必要欄位（電話或品項）' });
    }

    // 產生訂單 ID
    const orderId = generateOrderId();
    const now = new Date();

    // 用電話查 LINE userId
    let userId = lineUserId;
    if (!userId && phone) {
      const customer = getCustomerByPhone(phone);
      if (customer && customer.line_user_id) {
        userId = customer.line_user_id;
      }
    }

    // 建立訂單
    const order = {
      id: orderId,
      phone: phone,
      user_id: userId || 'web_user',
      name: name || '（未填寫）',
      items: items,
      total: total,
      location: location || '（未填寫）',
      status: 'pending',
      created_at: formatDate(now)
    };

    saveOrder(order);

    // 通知管理員
    let pushLines = [
      '🚗 粉紅超跑新訂單！',
      '━━━━━━━━━━━━━━━',
      '📞 ' + phone,
      '━━━━━━━━━━━━━━━'
    ];
    for (const item of items) {
      const itemTotal = (item.price || 0) * (item.qty || 1);
      pushLines.push('• ' + item.name + ' x' + item.qty + ' = $' + itemTotal);
    }
    pushLines.push(
      '━━━━━━━━━━━━━━━',
      '💰 合計：$' + total,
      '🕐 ' + formatDate(now),
      '🆔 #' + orderId
    );
    if (userId && userId !== 'web_user') {
      pushLines.push('LINE綁定：✅');
    } else {
      pushLines.push('LINE綁定：❌');
    }

    if (LINE_USER_ID) {
      linePush(LINE_USER_ID, pushLines.join('\n'));
    }

    // 通知顧客
    if (userId && userId !== 'web_user') {
      let confirmLines = [
        '✅ 訂單已收到！ #' + orderId,
        '━━━━━━━━━━━━━━━',
        '📞 ' + phone
      ];
      for (const item of items) {
        confirmLines.push('• ' + item.name + ' x' + item.qty);
      }
      confirmLines.push(
        '━━━━━━━━━━━━━━━',
        '💰 合計：$' + total,
        '━━━━━━━━━━━━━━━',
        '⏳ 廚房準備中，請等候通知'
      );
      linePush(userId, confirmLines.join('\n'));
    }

    return makeCorsJsonOutput({
      success: true,
      order_id: orderId,
      line_bound: !!(userId && userId !== 'web_user')
    });

  } catch (err) {
    console.error('[ORDER_API_ERROR]', err);
    return makeCorsJsonOutput({ success: false, error: err.toString() });
  }
}

// ===== kitchenOrders - 取得待製作訂單（JSON）=====
function handleKitchenOrdersApi() {
  try {
    const orders = getActiveOrders();
    return makeCorsJsonOutput({ orders: orders });
  } catch (err) {
    console.error('[KITCHEN_ORDERS_ERROR]', err);
    return makeCorsJsonOutput({ orders: [], error: err.toString() });
  }
}

// ===== kitchenUpdate - 廚房更新訂單狀態 =====
function handleKitchenUpdateApi(data) {
  try {
    const orderId = (data.orderId || data.order_id || '').toUpperCase();
    const newStatus = data.status || '';

    const validStatuses = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!validStatuses.includes(newStatus)) {
      return makeCorsJsonOutput({ success: false, error: '無效狀態' });
    }

    const order = getOrderById(orderId);
    if (!order) {
      return makeCorsJsonOutput({ success: false, error: '找不到訂單：' + orderId });
    }

    updateOrderStatus(orderId, newStatus);

    // 通知顧客
    let userId = order.user_id || '';
    if (!userId || userId === 'web_user') {
      if (order.phone) {
        const customer = getCustomerByPhone(order.phone);
        if (customer) {
          userId = customer.line_user_id;
        }
      }
    }

    if (userId && userId !== 'web_user') {
      if (newStatus === 'preparing') {
        linePush(userId, '👨‍🍳 您的訂單已開始製作，請稍候');
      } else if (newStatus === 'ready') {
        linePushWithQuickReply(userId,
          '✅ 您的餐點已備好，請取餐！🚗\n\n📋 訂單 #' + order.id + '\n💰 合計：$' + order.total + '\n\n請點下方按鈕確認取餐：',
          [
            { type: 'action', action: { type: 'postback', label: '✅ 已取餐確認', data: 'action=confirm_delivery&order_id=' + order.id, displayText: '✅ 已取餐確認' } }
          ]
        );
      } else if (newStatus === 'delivered') {
        linePush(userId, '🚗 您的訂單已外送完成，祝您用餐愉快！⭐');
      } else if (newStatus === 'cancelled') {
        linePush(userId, '❌ 您的訂單已取消');
      }
    }

    return makeCorsJsonOutput({ success: true });

  } catch (err) {
    console.error('[KITCHEN_UPDATE_ERROR]', err);
    return makeCorsJsonOutput({ success: false, error: err.toString() });
  }
}

// ===== 廚房面板 HTML（完整頁面）=====
function handleKitchenPanel() {
  const orders = getActiveOrders();

  const pending = orders.filter(o => o.status === 'pending');
  const preparing = orders.filter(o => o.status === 'preparing');
  const ready = orders.filter(o => o.status === 'ready');

  const makeCard = (o) => {
    const statusClass = o.status === 'pending' ? 'pending' : o.status === 'preparing' ? 'preparing' : 'ready';
    const statusLabel = o.status === 'pending' ? '⏳ 待製作' : o.status === 'preparing' ? '👨‍🍳 製作中' : '📢 待取餐';
    const itemsStr = Array.isArray(o.items)
      ? o.items.map(i => i.name + ' x' + i.qty).join('<br>')
      : (o.items_str || o.items || '');

    let btns = '';
    if (o.status === 'pending') {
      btns += '<button onclick="updateStatus(\'' + o.id + '\',\'preparing\')">▶ 開始製作</button>';
    }
    if (o.status === 'preparing') {
      btns += '<button onclick="updateStatus(\'' + o.id + '\',\'ready\')">📢 備好</button>';
    }
    if (o.status === 'ready') {
      btns += '<button onclick="updateStatus(\'' + o.id + '\',\'delivered\')">✅ 完成</button>';
    }
    btns += '<button class="cancel" onclick="updateStatus(\'' + o.id + '\',\'cancelled\')">❌ 取消</button>';

    return '<div class="card ' + statusClass + '">' +
      '<div class="order-id">#' + o.id + '</div>' +
      '<div class="customer">📞 ' + (o.phone || '-') + '</div>' +
      '<div class="items">' + itemsStr + '</div>' +
      '<div class="meta">💰 $' + (o.total || 0) + ' | 🕐 ' + (o.created_at || '') + '</div>' +
      '<div class="status">' + statusLabel + '</div>' +
      '<div class="btns">' + btns + '</div>' +
    '</div>';
  };

  const emptyMsg = '<div class="empty">目前沒有訂單</div>';

  const html = '<!DOCTYPE html>' +
    '<html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>粉紅超跑 - 廚房面板</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft JhengHei",sans-serif;padding:16px;background:#1a1a2e;color:#eee}' +
    'h1{text-align:center;color:#ff6b9d;margin-bottom:16px}' +
    '.summary{display:flex;gap:12px;margin-bottom:20px}' +
    '.summary .item{background:#16213e;padding:12px;border-radius:12px;flex:1;text-align:center;border:1px solid #ff6b9d}' +
    '.summary .num{font-size:28px;font-weight:bold;color:#ff6b9d}' +
    '.summary .label{color:#888;font-size:13px}' +
    '.section{margin-bottom:24px}' +
    '.section h2{color:#ff6b9d;font-size:16px;margin-bottom:12px}' +
    '.card{background:#16213e;padding:14px;border-radius:12px;margin-bottom:12px;border-left:4px solid #888}' +
    '.card.pending{border-color:#ffd700}' +
    '.card.preparing{border-color:#ff9800}' +
    '.card.ready{border-color:#4caf50}' +
    '.order-id{font-weight:bold;color:#ff6b9d;font-size:18px}' +
    '.customer{color:#aaa;margin:6px 0}' +
    '.items{color:#fff;font-size:15px;line-height:1.5}' +
    '.meta{color:#888;font-size:12px;margin:6px 0}' +
    '.status{color:#ff6b9d;font-size:13px;font-weight:bold;margin:6px 0}' +
    '.btns button{background:#ff6b9d;color:white;border:none;padding:8px 14px;border-radius:8px;margin-right:8px;cursor:pointer;font-size:14px}' +
    '.btns button.cancel{background:#555}' +
    '.empty{color:#666;text-align:center;padding:30px}' +
    '.refresh{background:#16213e;color:#ff6b9d;border:1px solid #ff6b9d;padding:10px;border-radius:8px;width:100%;font-size:15px;cursor:pointer;margin-bottom:16px}' +
    '</style></head><body>' +
    '<h1>🚗 粉紅超跑 - 廚房面板</h1>' +
    '<button class="refresh" onclick="location.reload()">🔄 刷新（全頁）</button>' +
    '<div class="summary">' +
      '<div class="item"><div class="num">' + pending.length + '</div><div class="label">待製作</div></div>' +
      '<div class="item"><div class="num">' + preparing.length + '</div><div class="label">製作中</div></div>' +
      '<div class="item"><div class="num">' + ready.length + '</div><div class="label">待取餐</div></div>' +
    '</div>' +
    '<div class="section">' +
    '<h2>⏳ 待製作（' + pending.length + '）</h2>' + (pending.length ? pending.map(makeCard).join('') : emptyMsg) +
    '</div>' +
    '<div class="section">' +
    '<h2>👨‍🍳 製作中（' + preparing.length + '）</h2>' + (preparing.length ? preparing.map(makeCard).join('') : emptyMsg) +
    '</div>' +
    '<div class="section">' +
    '<h2>📢 待取餐（' + ready.length + '）</h2>' + (ready.length ? ready.map(makeCard).join('') : emptyMsg) +
    '</div>' +
    '<script>' +
    'function updateStatus(id, status) {' +
    '  if (!confirm("更新訂單 #" + id + " 為「" + status + "」？")) return;' +
    '  var xhr = new XMLHttpRequest();' +
    '  xhr.open("POST", location.pathname + "?v=" + Date.now(), true);' +
    '  xhr.setRequestHeader("Content-Type", "application/json");' +
    '  xhr.onload = function() { location.reload(); };' +
    '  xhr.onerror = function() { alert("更新失敗"); };' +
    '  xhr.send(JSON.stringify({action:"kitchenUpdate",orderId:id,status:status}));' +
    '}' +
    '// 每30秒自動刷新' +
    'setTimeout(function(){location.reload()},30000);' +
    '</script></body></html>';

  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===== 工具函式 =====
function makeCorsJsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .addHeader('Access-Control-Allow-Origin', '*');
}

function makeCorsTextOutput(text) {
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.TEXT)
    .addHeader('Access-Control-Allow-Origin', '*');
}

function linePushWithQuickReply(userId, text, quickReplyItems) {
  if (!userId || userId === 'web_user' || !LINE_ACCESS_TOKEN) return;

  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: userId,
    messages: [{
      type: 'text',
      text: text,
      quickReply: { items: quickReplyItems }
    }]
  };

  try {
    UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('[LINE_PUSH_QR_ERROR]', err);
  }
}