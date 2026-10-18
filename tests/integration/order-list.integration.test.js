const { v4: uuidv4 } = require('uuid');
const request = require('supertest');
const app = require('../setup/testServer');
const { db, resetDatabase } = require('./helpers');

function expectEnvelope(response, status) {
  expect(response.status).toBe(status);
  expect(response.body).toHaveProperty('data');
  expect(response.body).toHaveProperty('error');
  expect(response.body).toHaveProperty('message');
}

async function registerMember(email) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', name: '訂單列表會員' });

  expectEnvelope(response, 201);
  return response.body.data;
}

let orderSequence = 0;

// Insert orders directly so created_at and status are fully controlled
function insertOrder(userId, { status = 'pending', createdAt = '2026-10-01 10:00:00' } = {}) {
  orderSequence += 1;
  const id = uuidv4();
  db.prepare(
    `INSERT INTO orders (
       id, order_no, user_id, recipient_name, recipient_email, recipient_address,
       subtotal, shipping_fee, total_amount, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    `ORD-20261001-LIST${String(orderSequence).padStart(5, '0')}`,
    userId,
    '列表測試收件人',
    'order-list@example.com',
    '台北市列表路 1 號',
    1000,
    120,
    1120,
    status,
    createdAt
  );
  return id;
}

function listOrders(token, query = '') {
  return request(app)
    .get(`/api/orders${query}`)
    .set('Authorization', `Bearer ${token}`);
}

function expectedIds(userId, status = null) {
  const where = status ? 'WHERE user_id = ? AND status = ?' : 'WHERE user_id = ?';
  const params = status ? [userId, status] : [userId];
  return db.prepare(
    `SELECT id FROM orders ${where} ORDER BY created_at DESC, rowid DESC`
  ).all(...params).map(row => row.id);
}

describe('Member order list filtering and pagination', () => {
  let member;

  beforeEach(async () => {
    resetDatabase();
    member = await registerMember('order-list-member@example.com');
  });

  afterEach(resetDatabase);

  it('sorts by created_at newest first regardless of insert order', async () => {
    const middle = insertOrder(member.user.id, { createdAt: '2026-10-02 09:00:00' });
    const oldest = insertOrder(member.user.id, { createdAt: '2026-10-01 09:00:00' });
    const newest = insertOrder(member.user.id, { createdAt: '2026-10-03 09:00:00' });

    const response = await listOrders(member.token);

    expectEnvelope(response, 200);
    expect(response.body.error).toBeNull();
    expect(response.body.data.orders.map(order => order.id)).toEqual([newest, middle, oldest]);
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 10, total: 3, totalPages: 1 });
  });

  it('keeps same-second orders in a stable order so pages never overlap', async () => {
    const inserted = [];
    for (let i = 0; i < 12; i++) {
      inserted.push(insertOrder(member.user.id, { createdAt: '2026-10-05 12:00:00' }));
    }

    const pages = [];
    for (const page of [1, 2, 3]) {
      const response = await listOrders(member.token, `?page=${page}&limit=5`);
      expectEnvelope(response, 200);
      expect(response.body.data.pagination).toEqual({ page, limit: 5, total: 12, totalPages: 3 });
      pages.push(response.body.data.orders.map(order => order.id));
    }

    expect(pages.map(ids => ids.length)).toEqual([5, 5, 2]);
    const allIds = pages.flat();
    expect(new Set(allIds).size).toBe(12);
    // The most recently inserted order comes first within the same second
    expect(allIds).toEqual([...inserted].reverse());
    expect(allIds).toEqual(expectedIds(member.user.id));
  });

  it('combines a status filter with pagination and counts only matching orders', async () => {
    const statuses = [
      'paid', 'pending', 'paid', 'failed', 'paid', 'pending', 'paid',
      'paid', 'pending', 'failed', 'paid', 'pending', 'paid'
    ];
    statuses.forEach((status, index) => {
      const minute = String(index).padStart(2, '0');
      insertOrder(member.user.id, { status, createdAt: `2026-10-06 08:${minute}:00` });
    });

    const paidIds = expectedIds(member.user.id, 'paid');
    expect(paidIds).toHaveLength(7);

    const lastPage = await listOrders(member.token, '?status=paid&page=3&limit=3');
    expectEnvelope(lastPage, 200);
    expect(lastPage.body.data.pagination).toEqual({ page: 3, limit: 3, total: 7, totalPages: 3 });
    expect(lastPage.body.data.orders.map(order => order.id)).toEqual(paidIds.slice(6));

    const firstPage = await listOrders(member.token, '?status=paid&limit=3');
    expect(firstPage.body.data.orders.map(order => order.id)).toEqual(paidIds.slice(0, 3));

    for (const status of ['pending', 'failed']) {
      const response = await listOrders(member.token, `?status=${status}`);
      expectEnvelope(response, 200);
      expect(response.body.data.orders.map(order => order.id)).toEqual(expectedIds(member.user.id, status));
      expect(response.body.data.orders.every(order => order.status === status)).toBe(true);
      expect(response.body.data.pagination.total).toBe(statuses.filter(s => s === status).length);
    }
  });

  it("never returns or counts another member's orders, with or without a status filter", async () => {
    const other = await registerMember('order-list-other@example.com');
    const mine = [
      insertOrder(member.user.id, { status: 'paid', createdAt: '2026-10-07 10:00:00' }),
      insertOrder(member.user.id, { status: 'pending', createdAt: '2026-10-07 11:00:00' })
    ];
    for (let i = 0; i < 4; i++) {
      insertOrder(other.user.id, { status: 'paid', createdAt: '2026-10-07 12:00:00' });
    }

    const all = await listOrders(member.token);
    expectEnvelope(all, 200);
    expect(all.body.data.pagination.total).toBe(2);
    expect(all.body.data.orders.map(order => order.id).sort()).toEqual([...mine].sort());

    const paid = await listOrders(member.token, '?status=paid');
    expect(paid.body.data.orders.map(order => order.id)).toEqual([mine[0]]);
    expect(paid.body.data.pagination.total).toBe(1);

    const othersView = await listOrders(other.token, '?status=paid');
    expect(othersView.body.data.pagination.total).toBe(4);
    expect(othersView.body.data.orders.some(order => mine.includes(order.id))).toBe(false);
  });

  it('caps limit at 50 at the API layer', async () => {
    for (let i = 0; i < 55; i++) {
      insertOrder(member.user.id);
    }

    const response = await listOrders(member.token, '?limit=100');

    expectEnvelope(response, 200);
    expect(response.body.data.orders).toHaveLength(50);
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 50, total: 55, totalPages: 2 });

    const secondPage = await listOrders(member.token, '?limit=100&page=2');
    expect(secondPage.body.data.orders).toHaveLength(5);

    // A limit beyond Number's safe range is still a positive integer above 50
    const hugeLimit = await listOrders(member.token, '?limit=99999999999999999999');
    expectEnvelope(hugeLimit, 200);
    expect(hugeLimit.body.data.orders).toHaveLength(50);
    expect(hugeLimit.body.data.pagination.limit).toBe(50);
  });

  it('returns an empty page with real totals for pages past the end', async () => {
    for (let i = 0; i < 3; i++) {
      insertOrder(member.user.id);
    }

    for (const page of ['5', String(Number.MAX_SAFE_INTEGER)]) {
      const response = await listOrders(member.token, `?page=${page}`);
      expectEnvelope(response, 200);
      expect(response.body.data.orders).toEqual([]);
      expect(response.body.data.pagination).toEqual({ page: Number(page), limit: 10, total: 3, totalPages: 1 });
    }
  });

  it('returns zero pages for a member without orders', async () => {
    const response = await listOrders(member.token);

    expectEnvelope(response, 200);
    expect(response.body.data.orders).toEqual([]);
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it.each([
    ['?status=unknown', 'status'],
    ['?status=', 'status'],
    ['?status=paid&status=pending', 'status'],
    ['?page=0', 'page'],
    ['?page=-1', 'page'],
    ['?page=1.5', 'page'],
    ['?page=abc', 'page'],
    ['?limit=-1', 'limit'],
    ['?limit=0', 'limit'],
    ['?limit=', 'limit']
  ])('rejects %s with 400 VALIDATION_ERROR', async (query, field) => {
    insertOrder(member.user.id);

    const response = await listOrders(member.token, query);

    expectEnvelope(response, 400);
    expect(response.body.data).toBeNull();
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain(field);
  });

  it('requires a member JWT', async () => {
    const response = await request(app).get('/api/orders');

    expectEnvelope(response, 401);
    expect(response.body.data).toBeNull();
    expect(response.body.error).toBe('UNAUTHORIZED');
  });

  it('serves the orders page whose script reads the orders array from the paginated response', async () => {
    insertOrder(member.user.id, { status: 'paid' });

    const page = await request(app).get('/orders');
    expect(page.status).toBe(200);
    expect(page.type).toBe('text/html');
    expect(page.text).toContain('我的訂單');

    const script = await request(app).get('/js/pages/orders.js');
    expect(script.status).toBe(200);
    expect(script.text).toContain("apiFetch('/api/orders')");
    expect(script.text).toContain('res.data.orders');

    const response = await listOrders(member.token);
    expect(Array.isArray(response.body.data.orders)).toBe(true);
    expect(response.body.data.orders[0]).toMatchObject({ status: 'paid', total_amount: 1120 });
  });
});
