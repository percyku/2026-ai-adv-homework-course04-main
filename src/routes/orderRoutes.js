const express = require('express');
const db = require('../database');
const authMiddleware = require('../middleware/authMiddleware');
const { queryTradeInfo } = require('../utils/ecpay');
const { SHIPPING_METHODS, calculateShipping } = require('../utils/shipping');
const { CouponError, applyCoupon } = require('../utils/coupon');
const {
  StockInsufficientError,
  serializeOrder,
  findOrderById,
  findOrderForUser,
  listOrdersForUser,
  getOrderItems,
  getOrderItemSummaries,
  getCheckoutItems,
  findInsufficientItems,
  createOrderFromCart
} = require('../services/orderService');
const { isTradePaid, markOrderPaid } = require('../services/paymentService');
const { isNonEmptyString, parsePositiveInteger } = require('../utils/validators');

const router = express.Router();

router.use(authMiddleware);

// Mock payment is test-only; otherwise any member could mark their own order as paid
function testEnvOnly(req, res, next) {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '找不到該資源' });
  }
  next();
}

// Express 4 ignores rejected promises, so pass async errors on to errorHandler
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * @openapi
 * /api/orders:
 *   post:
 *     summary: 從購物車建立訂單
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientName, recipientEmail, recipientAddress, shippingMethod, isRemoteArea, isExpress]
 *             properties:
 *               recipientName:
 *                 type: string
 *               recipientEmail:
 *                 type: string
 *                 format: email
 *               recipientAddress:
 *                 type: string
 *               shippingMethod:
 *                 type: string
 *                 enum: [home_delivery, convenience_store]
 *               isRemoteArea:
 *                 type: boolean
 *               isExpress:
 *                 type: boolean
 *               couponCode:
 *                 type: string
 *                 description: 選填優惠碼（不分大小寫；空字串視同未使用）
 *                 example: FLOWER100
 *     responses:
 *       201:
 *         description: 訂單建立成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     subtotal:
 *                       type: integer
 *                     coupon_code:
 *                       type: string
 *                       nullable: true
 *                       description: 使用的優惠碼（大寫），未使用為 null
 *                     discount:
 *                       type: integer
 *                       description: 折扣金額，未使用優惠碼為 0
 *                     shipping_fee:
 *                       type: integer
 *                     shipping_method:
 *                       type: string
 *                       enum: [home_delivery, convenience_store]
 *                     is_remote_area:
 *                       type: boolean
 *                     is_express:
 *                       type: boolean
 *                     total_amount:
 *                       type: integer
 *                       description: subtotal - discount + shipping_fee
 *                     status:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                     created_at:
 *                       type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 購物車為空、購物車數量不是正整數、庫存不足、收件資訊缺失，或優惠碼無效、已失效、未達門檻（INVALID_COUPON）
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/', (req, res) => {
  const {
    recipientName,
    recipientEmail,
    recipientAddress,
    shippingMethod,
    isRemoteArea,
    isExpress,
    couponCode
  } = req.body;
  const userId = req.user.userId;

  if (!isNonEmptyString(recipientName) || !isNonEmptyString(recipientEmail) || !isNonEmptyString(recipientAddress)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '收件人姓名、Email 和地址為必填欄位'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'Email 格式不正確'
    });
  }

  if (!Object.values(SHIPPING_METHODS).includes(shippingMethod)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'shippingMethod 必須為 home_delivery 或 convenience_store'
    });
  }

  if (typeof isRemoteArea !== 'boolean' || typeof isExpress !== 'boolean') {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'isRemoteArea 與 isExpress 必須為 boolean'
    });
  }

  if (couponCode !== undefined && couponCode !== null && typeof couponCode !== 'string') {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'couponCode 必須為字串'
    });
  }

  const cartItems = getCheckoutItems(userId);

  if (cartItems.length === 0) {
    return res.status(400).json({
      data: null,
      error: 'CART_EMPTY',
      message: '購物車為空'
    });
  }

  // Cart rows saved before PATCH validated quantities may hold decimals
  if (cartItems.some(item => parsePositiveInteger(item.quantity) === null)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '購物車商品數量必須為正整數，請重新設定數量'
    });
  }

  const insufficientItems = findInsufficientItems(cartItems);
  if (insufficientItems.length > 0) {
    const names = [...new Set(insufficientItems.map(i => i.product_name))].join(', ');
    return res.status(400).json({
      data: null,
      error: 'STOCK_INSUFFICIENT',
      message: `以下商品庫存不足：${names}`
    });
  }

  // Calculate the subtotal, coupon discount and server-authoritative shipping fee.
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.product_price * item.quantity, 0
  );

  let coupon;
  try {
    coupon = applyCoupon({ subtotal, couponCode });
  } catch (err) {
    if (err instanceof CouponError) {
      return res.status(400).json({ data: null, error: 'INVALID_COUPON', message: err.message });
    }
    throw err;
  }

  // The free-shipping threshold uses the discounted subtotal
  const shipping = calculateShipping({
    subtotal: coupon.discountedSubtotal,
    method: shippingMethod,
    isRemoteArea,
    isExpress
  });

  let orderId;
  try {
    orderId = createOrderFromCart({
      userId,
      recipient: { name: recipientName, email: recipientEmail, address: recipientAddress },
      delivery: { method: shippingMethod, isRemoteArea, isExpress },
      cartItems,
      subtotal,
      coupon,
      shipping
    });
  } catch (err) {
    if (err instanceof StockInsufficientError) {
      return res.status(400).json({ data: null, error: 'STOCK_INSUFFICIENT', message: err.message });
    }
    throw err;
  }

  const order = findOrderById(orderId);
  const orderItems = getOrderItemSummaries(orderId);

  res.status(201).json({
    data: {
      id: order.id,
      order_no: order.order_no,
      subtotal: order.subtotal,
      coupon_code: order.coupon_code,
      discount: order.discount,
      shipping_fee: order.shipping_fee,
      shipping_method: order.shipping_method,
      is_remote_area: Boolean(order.is_remote_area),
      is_express: Boolean(order.is_express),
      total_amount: order.total_amount,
      status: order.status,
      items: orderItems,
      created_at: order.created_at
    },
    error: null,
    message: '訂單建立成功'
  });
});

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: 自己的訂單列表
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           order_no:
 *                             type: string
 *                           subtotal:
 *                             type: integer
 *                           coupon_code:
 *                             type: string
 *                             nullable: true
 *                           discount:
 *                             type: integer
 *                           shipping_fee:
 *                             type: integer
 *                           shipping_method:
 *                             type: string
 *                           total_amount:
 *                             type: integer
 *                           status:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', (req, res) => {
  const orders = listOrdersForUser(req.user.userId);

  res.json({
    data: { orders: orders.map(serializeOrder) },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     summary: 訂單詳情
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     recipient_name:
 *                       type: string
 *                     recipient_email:
 *                       type: string
 *                     recipient_address:
 *                       type: string
 *                     subtotal:
 *                       type: integer
 *                     coupon_code:
 *                       type: string
 *                       nullable: true
 *                     discount:
 *                       type: integer
 *                     shipping_fee:
 *                       type: integer
 *                     shipping_method:
 *                       type: string
 *                       enum: [home_delivery, convenience_store]
 *                     is_remote_area:
 *                       type: boolean
 *                     is_express:
 *                       type: boolean
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           product_id:
 *                             type: string
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: 訂單不存在
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', (req, res) => {
  const order = findOrderForUser(req.params.id, req.user.userId);

  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  const items = getOrderItems(order.id);

  res.json({
    data: { ...serializeOrder(order), items },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}/pay:
 *   patch:
 *     summary: 模擬付款（僅 NODE_ENV=test 開放，其他環境回 404）
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [success, fail]
 *     responses:
 *       200:
 *         description: 付款狀態更新成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: action 無效或訂單狀態不是 pending
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: 訂單不存在，或非測試環境
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id/pay', testEnvOnly, (req, res) => {
  const { action } = req.body;
  const userId = req.user.userId;

  const actionMap = { success: 'paid', fail: 'failed' };
  if (!action || !actionMap[action]) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'action 必須為 success 或 fail'
    });
  }

  const order = findOrderForUser(req.params.id, userId);
  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  if (order.status !== 'pending') {
    return res.status(400).json({
      data: null,
      error: 'INVALID_STATUS',
      message: '訂單狀態不是 pending，無法付款'
    });
  }

  const newStatus = actionMap[action];
  db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'pending'").run(newStatus, order.id);

  const updated = findOrderById(order.id);
  const items = getOrderItems(order.id);

  res.json({
    data: { ...serializeOrder(updated), items },
    error: null,
    message: action === 'success' ? '付款成功' : '付款失敗'
  });
});

/**
 * @openapi
 * /api/orders/{id}/check-payment:
 *   post:
 *     summary: 透過綠界 QueryTradeInfo API 查詢付款狀態
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 查詢成功（已付款、尚未付款，或訂單已非 pending 時回傳目前狀態）
 *       400:
 *         description: 此訂單無綠界交易編號（NO_TRADE_NO）
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: 訂單不存在
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: 綠界查詢失敗，或回應的 CheckMacValue、交易編號、金額驗證不符（ECPAY_QUERY_ERROR）
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/:id/check-payment', asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const order = findOrderForUser(req.params.id, userId);
  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  if (order.status !== 'pending') {
    const items = getOrderItemSummaries(order.id);
    return res.json({
      data: { ...serializeOrder(order), items },
      error: null,
      message: order.status === 'paid' ? '此訂單已付款' : '此訂單付款失敗'
    });
  }

  if (!order.merchant_trade_no) {
    return res.status(400).json({ data: null, error: 'NO_TRADE_NO', message: '此訂單無綠界交易編號' });
  }

  try {
    const result = await queryTradeInfo(order.merchant_trade_no);

    if (isTradePaid(order, result)) {
      markOrderPaid(order.id);
      const updated = findOrderById(order.id);
      const items = getOrderItemSummaries(order.id);
      return res.json({
        data: { ...serializeOrder(updated), items },
        error: null,
        message: '付款成功'
      });
    }

    const items = getOrderItemSummaries(order.id);
    return res.json({
      data: { ...serializeOrder(order), items, ecpay_trade_status: result.TradeStatus },
      error: null,
      message: '尚未完成付款，請稍後再查詢'
    });
  } catch (err) {
    console.error('[ECPay] QueryTradeInfo error:', err.message);
    return res.status(500).json({
      data: null,
      error: 'ECPAY_QUERY_ERROR',
      message: '查詢綠界付款狀態失敗，請稍後再試'
    });
  }
}));

module.exports = router;
