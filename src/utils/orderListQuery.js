const { parsePositiveInteger } = require('./validators');

const ORDER_STATUSES = Object.freeze(['pending', 'paid', 'failed']);

const ORDER_LIST_PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 50
});

class OrderListQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OrderListQueryError';
  }
}

// A page beyond Number's safe range cannot be represented exactly, so it is rejected
function parsePageParam(value) {
  if (value === undefined) {
    return ORDER_LIST_PAGINATION.DEFAULT_PAGE;
  }

  const parsed = parsePositiveInteger(value);
  if (parsed === null || !Number.isSafeInteger(parsed)) {
    throw new OrderListQueryError('page 必須為正整數');
  }
  return parsed;
}

// Any limit above MAX_LIMIT is capped, even a digit string too long for Number (Infinity)
function parseLimitParam(value) {
  if (value === undefined) {
    return ORDER_LIST_PAGINATION.DEFAULT_LIMIT;
  }

  const isHugeDigitString = typeof value === 'string' && /^\d+$/.test(value) && Number(value) === Infinity;
  const parsed = isHugeDigitString ? Infinity : parsePositiveInteger(value);
  if (parsed === null) {
    throw new OrderListQueryError('limit 必須為正整數');
  }
  return Math.min(parsed, ORDER_LIST_PAGINATION.MAX_LIMIT);
}

/**
 * Validate the member order list query (status, page, limit).
 * Only an absent parameter falls back to its default, so "?page=" is rejected like "?page=0".
 * Throws OrderListQueryError for an unknown status or a page/limit that is not a positive integer.
 * A limit above MAX_LIMIT is capped instead of rejected.
 */
function parseOrderListQuery(query = {}) {
  const { status } = query;

  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    throw new OrderListQueryError(`status 必須為 ${ORDER_STATUSES.join('、')} 其中之一`);
  }

  const page = parsePageParam(query.page);
  const limit = parseLimitParam(query.limit);

  return Object.freeze({
    status: status === undefined ? null : status,
    page,
    limit,
    offset: (page - 1) * limit
  });
}

function buildPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

module.exports = {
  ORDER_STATUSES,
  ORDER_LIST_PAGINATION,
  OrderListQueryError,
  parseOrderListQuery,
  buildPagination
};
