const {
  ORDER_STATUSES,
  ORDER_LIST_PAGINATION,
  OrderListQueryError,
  parseOrderListQuery,
  buildPagination
} = require('../src/utils/orderListQuery');

function expectQueryError(query, field) {
  let caught;
  try {
    parseOrderListQuery(query);
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(OrderListQueryError);
  expect(caught.message).toContain(field);
}

describe('Order list query module', () => {
  describe('預設值', () => {
    it.each([
      ['未提供 query', undefined],
      ['空 query', {}]
    ])('%s時為第 1 頁、每頁 10 筆、不篩選狀態', (_label, query) => {
      expect(parseOrderListQuery(query)).toEqual({ status: null, page: 1, limit: 10, offset: 0 });
    });

    it('預設值與上限常數符合規格', () => {
      expect(ORDER_LIST_PAGINATION).toEqual({ DEFAULT_PAGE: 1, DEFAULT_LIMIT: 10, MAX_LIMIT: 50 });
      expect(ORDER_STATUSES).toEqual(['pending', 'paid', 'failed']);
    });
  });

  describe('status', () => {
    it.each(['pending', 'paid', 'failed'])('允許 %s', status => {
      expect(parseOrderListQuery({ status }).status).toBe(status);
    });

    it.each([
      ['不在允許值內', 'unknown'],
      ['大小寫不同', 'PAID'],
      ['空字串', ''],
      ['重複帶入多個值', ['paid', 'pending']]
    ])('%s時拋出錯誤', (_label, status) => {
      expectQueryError({ status }, 'status');
    });
  });

  describe('page', () => {
    it.each([
      ['1', 1],
      ['2', 2],
      ['01', 1]
    ])('page=%s 解析為 %i', (page, expected) => {
      expect(parseOrderListQuery({ page }).page).toBe(expected);
    });

    it.each([
      ['0', '0'],
      ['負數', '-1'],
      ['小數', '1.5'],
      ['非數字', 'abc'],
      ['數字後接文字', '2abc'],
      ['科學記號', '1e2'],
      ['空字串', ''],
      ['重複帶入多個值', ['1', '2']],
      ['超過安全整數範圍', '9007199254740993']
    ])('%s時拋出錯誤', (_label, page) => {
      expectQueryError({ page }, 'page');
    });

    it('以頁碼與每頁筆數計算 offset', () => {
      expect(parseOrderListQuery({ page: '3', limit: '5' })).toMatchObject({ page: 3, limit: 5, offset: 10 });
    });
  });

  describe('limit', () => {
    it.each([
      ['1', 1],
      ['49', 49],
      ['50', 50],
      ['51', 50],
      ['100', 50],
      ['9007199254740993', 50],
      ['99999999999999999999', 50],
      ['1' + '0'.repeat(400), 50]
    ])('limit=%s 採用 %i（上限 50）', (limit, expected) => {
      expect(parseOrderListQuery({ limit }).limit).toBe(expected);
    });

    it('超過上限時 offset 以 50 計算', () => {
      expect(parseOrderListQuery({ page: '2', limit: '100' }).offset).toBe(50);
    });

    it.each([
      ['0', '0'],
      ['負數', '-1'],
      ['小數', '10.5'],
      ['非數字', 'ten'],
      ['空字串', ''],
      ['重複帶入多個值', ['5', '10']]
    ])('%s時拋出錯誤', (_label, limit) => {
      expectQueryError({ limit }, 'limit');
    });
  });

  describe('buildPagination', () => {
    it.each([
      [0, 10, 0],
      [1, 10, 1],
      [10, 10, 1],
      [11, 10, 2],
      [12, 5, 3]
    ])('total %i、limit %i 時 totalPages 為 %i', (total, limit, totalPages) => {
      expect(buildPagination({ page: 1, limit, total })).toEqual({ page: 1, limit, total, totalPages });
    });
  });
});
