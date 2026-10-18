const request = require('supertest');
const app = require('../setup/testServer');
const { verifyCheckMacValue, ECPAY_CONFIG } = require('../../src/utils/ecpay');
const { db, resetDatabase, createProduct } = require('./helpers');

const ORDER_PAYLOAD = {
  recipientName: '優惠碼整合測試',
  recipientEmail: 'coupon.integration@example.com',
  recipientAddress: '台北市中山區優惠路 8 號',
  shippingMethod: 'home_delivery',
  isRemoteArea: false,
  isExpress: false
};

function expectEnvelope(response, status) {
  expect(response.status).toBe(status);
  expect(response.body).toHaveProperty('data');
  expect(response.body).toHaveProperty('error');
  expect(response.body).toHaveProperty('message');
}

async function registerMember(email) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: '優惠碼會員' });

  expectEnvelope(response, 201);
  return response.body.data;
}

async function addProductToCart(token, productId, quantity) {
  const response = await request(app)
    .post('/api/cart')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, quantity });

  expectEnvelope(response, 200);
  return response.body.data;
}

function placeOrder(token, extra = {}) {
  return request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...ORDER_PAYLOAD, ...extra });
}

function parseHiddenInputs(html) {
  const params = {};
  const pattern = /<input type="hidden" name="([^"]+)" value="([^"]*)">/g;
  for (const match of html.matchAll(pattern)) {
    params[match[1]] = match[2].replace(/&amp;/g, '&');
  }
  return params;
}

describe('Order coupon integration flow', () => {
  let product;

  beforeEach(() => {
    resetDatabase();
    product = createProduct({ name: '優惠碼測試花束', price: 700, stock: 10 });
  });

  afterEach(() => {
    resetDatabase();
  });

  afterAll(() => {
    db.close();
  });

  it('persists the coupon snapshot and charges ECPay the discounted total', async () => {
    const member = await registerMember('coupon-persist@example.com');
    await addProductToCart(member.token, product.id, 2);

    const response = await placeOrder(member.token, { couponCode: ' flower100 ' });

    expectEnvelope(response, 201);
    expect(response.body.error).toBeNull();
    expect(response.body.data).toMatchObject({
      subtotal: 1400,
      coupon_code: 'FLOWER100',
      discount: 100,
      shipping_fee: 120,
      total_amount: 1420
    });

    const orderId = response.body.data.id;
    const storedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    expect(storedOrder).toMatchObject({
      user_id: member.user.id,
      subtotal: 1400,
      coupon_code: 'FLOWER100',
      discount: 100,
      shipping_fee: 120,
      total_amount: 1420,
      status: 'pending'
    });
    expect(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock).toBe(8);
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM cart_items WHERE user_id = ?'
    ).get(member.user.id).count).toBe(0);

    const listResponse = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${member.token}`);
    expectEnvelope(listResponse, 200);
    expect(listResponse.body.data.orders[0]).toMatchObject({
      id: orderId,
      coupon_code: 'FLOWER100',
      discount: 100,
      total_amount: 1420
    });

    const paymentPage = await request(app).get(`/ecpay/payment/${orderId}`);
    expect(paymentPage.status).toBe(200);
    const params = parseHiddenInputs(paymentPage.text);
    expect(params.TotalAmount).toBe('1420');
    expect(verifyCheckMacValue(params, ECPAY_CONFIG.hashKey, ECPAY_CONFIG.hashIV)).toBe(true);
  });

  it('stores a NULL coupon and zero discount when no coupon is used', async () => {
    const member = await registerMember('coupon-none@example.com');
    await addProductToCart(member.token, product.id, 2);

    const response = await placeOrder(member.token, { couponCode: '' });

    expectEnvelope(response, 201);
    expect(response.body.data).toMatchObject({
      subtotal: 1400,
      coupon_code: null,
      discount: 0,
      shipping_fee: 120,
      total_amount: 1520
    });
    expect(db.prepare(
      'SELECT coupon_code, discount, total_amount FROM orders WHERE id = ?'
    ).get(response.body.data.id)).toEqual({ coupon_code: null, discount: 0, total_amount: 1520 });
  });

  it.each([
    ['unknown', 'NOT-A-COUPON', 2],
    ['expired', 'SUMMER50', 2],
    ['below the minimum subtotal', 'FLOWER100', 1]
  ])('rejects an %s coupon without touching orders, stock or the cart', async (_label, couponCode, quantity) => {
    const member = await registerMember(`coupon-reject-${couponCode.toLowerCase()}-${quantity}@example.com`);
    const cartItem = await addProductToCart(member.token, product.id, quantity);

    const response = await placeOrder(member.token, { couponCode });

    expectEnvelope(response, 400);
    expect(response.body.data).toBeNull();
    expect(response.body.error).toBe('INVALID_COUPON');
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count).toBe(0);
    expect(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock).toBe(10);
    expect(db.prepare('SELECT quantity FROM cart_items WHERE id = ?').get(cartItem.id).quantity).toBe(quantity);
  });

  it('rejects a couponCode that is not a string', async () => {
    const member = await registerMember('coupon-type@example.com');
    await addProductToCart(member.token, product.id, 2);

    const response = await placeOrder(member.token, { couponCode: 100 });

    expectEnvelope(response, 400);
    expect(response.body.data).toBeNull();
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(0);
    expect(db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id).stock).toBe(10);
  });
});
