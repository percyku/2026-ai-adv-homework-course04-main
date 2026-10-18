const DISCOUNT_TYPES = Object.freeze({
  FIXED: 'fixed',
  PERCENTAGE: 'percentage'
});

const COUPON_ERROR_REASONS = Object.freeze({
  NOT_FOUND: 'not_found',
  EXPIRED: 'expired',
  MIN_SUBTOTAL_NOT_MET: 'min_subtotal_not_met'
});

// Codes are stored upper-case; lookups normalize user input first
const COUPONS = Object.freeze({
  FLOWER100: Object.freeze({ type: DISCOUNT_TYPES.FIXED, amount: 100, minSubtotal: 800, isActive: true }),
  SPRING10: Object.freeze({ type: DISCOUNT_TYPES.PERCENTAGE, percentOff: 10, maxDiscount: 300, minSubtotal: 0, isActive: true }),
  SUMMER50: Object.freeze({ type: DISCOUNT_TYPES.FIXED, amount: 50, minSubtotal: 0, isActive: false })
});

class CouponError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'CouponError';
    this.reason = reason;
  }
}

function normalizeCouponCode(couponCode) {
  return couponCode.trim().toUpperCase();
}

function assertValidInput({ subtotal, couponCode }) {
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new TypeError('subtotal 必須為非負有限數');
  }

  if (couponCode !== null && couponCode !== undefined && typeof couponCode !== 'string') {
    throw new TypeError('couponCode 必須為字串');
  }
}

function findCoupon(code) {
  return Object.prototype.hasOwnProperty.call(COUPONS, code) ? COUPONS[code] : null;
}

// Integer arithmetic before rounding avoids float drift such as 1234 * 0.1
function calculateDiscount(coupon, subtotal) {
  const rawDiscount = coupon.type === DISCOUNT_TYPES.PERCENTAGE
    ? Math.min(Math.round((subtotal * coupon.percentOff) / 100), coupon.maxDiscount)
    : coupon.amount;
  return Math.min(rawDiscount, subtotal);
}

function noCoupon(subtotal) {
  return Object.freeze({ couponCode: null, discount: 0, discountedSubtotal: subtotal });
}

/**
 * Apply an optional coupon to a goods subtotal. Discounts never touch shipping.
 * Throws CouponError for unknown, expired or below-threshold coupons.
 */
function applyCoupon({ subtotal, couponCode = null }) {
  assertValidInput({ subtotal, couponCode });

  if (couponCode === null || couponCode.trim() === '') {
    return noCoupon(subtotal);
  }

  const code = normalizeCouponCode(couponCode);
  const coupon = findCoupon(code);

  if (!coupon) {
    throw new CouponError(COUPON_ERROR_REASONS.NOT_FOUND, '優惠碼無效');
  }

  if (!coupon.isActive) {
    throw new CouponError(COUPON_ERROR_REASONS.EXPIRED, '優惠碼已失效');
  }

  if (subtotal < coupon.minSubtotal) {
    throw new CouponError(
      COUPON_ERROR_REASONS.MIN_SUBTOTAL_NOT_MET,
      `商品小計需滿 ${coupon.minSubtotal} 元才能使用此優惠碼`
    );
  }

  const discount = calculateDiscount(coupon, subtotal);

  return Object.freeze({
    couponCode: code,
    discount,
    discountedSubtotal: subtotal - discount
  });
}

module.exports = {
  DISCOUNT_TYPES,
  COUPON_ERROR_REASONS,
  COUPONS,
  CouponError,
  normalizeCouponCode,
  applyCoupon
};
