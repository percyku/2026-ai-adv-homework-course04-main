const { v4: uuidv4 } = require('uuid');
const db = require('../database');

function generateOrderNo() {
  // Use Taipei date so the order number matches ECPay MerchantTradeDate
  const dateStr = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
    .replace(/-/g, '');
  // 9 hex chars keep MerchantTradeNo (order_no without hyphens) at ECPay's 20-char limit
  const random = uuidv4().replace(/-/g, '').slice(0, 9).toUpperCase();
  return `ORD-${dateStr}-${random}`;
}

class StockInsufficientError extends Error {
  constructor(productName) {
    super(`以下商品庫存不足：${productName}`);
    this.name = 'StockInsufficientError';
  }
}

function serializeOrder(order) {
  return {
    ...order,
    is_remote_area: Boolean(order.is_remote_area),
    is_express: Boolean(order.is_express)
  };
}

function findOrderById(orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function findOrderForUser(orderId, userId) {
  return db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
}

function listOrdersForUser(userId) {
  return db.prepare(
    `SELECT id, order_no, subtotal, coupon_code, discount, shipping_fee, shipping_method,
            is_remote_area, is_express, total_amount, status, created_at
     FROM orders WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId);
}

function getOrderItems(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
}

function getOrderItemSummaries(orderId) {
  return db.prepare(
    'SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?'
  ).all(orderId);
}

// Cart items joined with the current product price and stock
function getCheckoutItems(userId) {
  return db.prepare(
    `SELECT ci.id, ci.product_id, ci.quantity,
            p.name as product_name, p.price as product_price, p.stock as product_stock
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = ?`
  ).all(userId);
}

// Sum quantities per product so duplicate cart rows cannot each pass the check
function findInsufficientItems(cartItems) {
  const totals = new Map();
  for (const item of cartItems) {
    totals.set(item.product_id, (totals.get(item.product_id) || 0) + item.quantity);
  }
  return cartItems.filter(item => totals.get(item.product_id) > item.product_stock);
}

/**
 * Create an order from the member's cart in one transaction:
 * insert order → snapshot items → deduct stock → clear cart.
 * Amounts must already be calculated by the caller; `coupon` is the applyCoupon result, if any.
 * Throws StockInsufficientError (and rolls back) if stock dropped after the caller's check.
 */
function createOrderFromCart({ userId, recipient, delivery, cartItems, subtotal, coupon = null, shipping }) {
  const orderId = uuidv4();
  const orderNo = generateOrderNo();
  const merchantTradeNo = orderNo.replace(/-/g, '');
  const couponCode = coupon ? coupon.couponCode : null;
  const discount = coupon ? coupon.discount : 0;
  const totalAmount = subtotal - discount + shipping.shippingFee;

  const insertOrder = db.prepare(
    `INSERT INTO orders (
       id, order_no, user_id, recipient_name, recipient_email, recipient_address,
       subtotal, coupon_code, discount, shipping_fee, shipping_method, is_remote_area, is_express,
       total_amount, merchant_trade_no
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
  const removeCartItem = db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?');

  db.transaction(() => {
    insertOrder.run(
      orderId,
      orderNo,
      userId,
      recipient.name,
      recipient.email,
      recipient.address,
      subtotal,
      couponCode,
      discount,
      shipping.shippingFee,
      delivery.method,
      delivery.isRemoteArea ? 1 : 0,
      delivery.isExpress ? 1 : 0,
      totalAmount,
      merchantTradeNo
    );

    for (const item of cartItems) {
      insertItem.run(uuidv4(), orderId, item.product_id, item.product_name, item.product_price, item.quantity);
      const stockResult = updateStock.run(item.quantity, item.product_id, item.quantity);
      if (stockResult.changes !== 1) {
        throw new StockInsufficientError(item.product_name);
      }
    }

    // Only remove the cart rows this order was built from
    for (const item of cartItems) {
      removeCartItem.run(item.id, userId);
    }
  })();

  return orderId;
}

module.exports = {
  StockInsufficientError,
  generateOrderNo,
  serializeOrder,
  findOrderById,
  findOrderForUser,
  listOrdersForUser,
  getOrderItems,
  getOrderItemSummaries,
  getCheckoutItems,
  findInsufficientItems,
  createOrderFromCart
};
