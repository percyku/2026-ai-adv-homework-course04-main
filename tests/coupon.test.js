const {
  COUPON_ERROR_REASONS,
  CouponError,
  applyCoupon
} = require('../src/utils/coupon');

function expectCouponError(input, reason) {
  let caught;
  try {
    applyCoupon(input);
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(CouponError);
  expect(caught.reason).toBe(reason);
  expect(caught.message.length).toBeGreaterThan(0);
}

describe('Coupon module', () => {
  describe('未使用優惠碼', () => {
    it.each([
      ['未提供', undefined],
      ['null', null],
      ['空字串', ''],
      ['全為空白', '   ']
    ])('%s時折扣為 0，小計不變', (_label, couponCode) => {
      const result = applyCoupon({ subtotal: 1000, couponCode });

      expect(result).toEqual({ couponCode: null, discount: 0, discountedSubtotal: 1000 });
    });
  });

  describe('FLOWER100：滿 800 折 100', () => {
    it('商品小計剛好 800 元可使用', () => {
      const result = applyCoupon({ subtotal: 800, couponCode: 'FLOWER100' });

      expect(result).toEqual({ couponCode: 'FLOWER100', discount: 100, discountedSubtotal: 700 });
    });

    it('商品小計 799 元未達門檻', () => {
      expectCouponError({ subtotal: 799, couponCode: 'FLOWER100' }, COUPON_ERROR_REASONS.MIN_SUBTOTAL_NOT_MET);
    });

    it('高於門檻時固定折抵 100 元', () => {
      const result = applyCoupon({ subtotal: 5000, couponCode: 'FLOWER100' });

      expect(result.discount).toBe(100);
      expect(result.discountedSubtotal).toBe(4900);
    });
  });

  describe('SPRING10：9 折、最多折 300', () => {
    it.each([
      [1000, 100],
      [1234, 123],
      [1235, 124],
      [3000, 300],
      [3500, 300],
      [1, 0]
    ])('商品小計 %i 元折抵 %i 元', (subtotal, discount) => {
      const result = applyCoupon({ subtotal, couponCode: 'SPRING10' });

      expect(result.discount).toBe(discount);
      expect(result.discountedSubtotal).toBe(subtotal - discount);
    });
  });

  it('SUMMER50 已失效', () => {
    expectCouponError({ subtotal: 1000, couponCode: 'SUMMER50' }, COUPON_ERROR_REASONS.EXPIRED);
  });

  it('拒絕不存在的優惠碼', () => {
    expectCouponError({ subtotal: 1000, couponCode: 'NOT-A-COUPON' }, COUPON_ERROR_REASONS.NOT_FOUND);
  });

  describe('優惠碼正規化', () => {
    it.each([
      ['小寫', 'flower100'],
      ['大小寫混合', 'Flower100'],
      ['前後空白', '  FLOWER100  ']
    ])('%s可正常使用，並以大寫記錄', (_label, couponCode) => {
      const result = applyCoupon({ subtotal: 800, couponCode });

      expect(result.couponCode).toBe('FLOWER100');
      expect(result.discount).toBe(100);
    });
  });

  describe('輸入驗證', () => {
    it.each([
      ['負數小計', { subtotal: -1, couponCode: 'FLOWER100' }],
      ['非有限數小計', { subtotal: Number.NaN }],
      ['非字串的優惠碼', { subtotal: 1000, couponCode: 100 }]
    ])('拒絕%s', (_label, input) => {
      expect(() => applyCoupon(input)).toThrow(TypeError);
    });
  });
});
