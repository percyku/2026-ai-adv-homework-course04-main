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

// Only an absent parameter falls back to its default, so "?page=" is rejected like "?page=0"
function parsePositiveIntegerParam(value, name, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = parsePositiveInteger(value);
  if (parsed === null || !Number.isSafeInteger(parsed)) {
    throw new OrderListQueryError(`${name} 必須為正整數`);
  }
  return parsed;
}

/**
 * Validate the member order list query (status, page, limit).
 * Throws OrderListQueryError for an unknown status or a page/limit that is not a positive integer.
 * A limit above MAX_LIMIT is capped instead of rejected.
 */
function parseOrderListQuery(query = {}) {
  const { status } = query;

  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    throw new OrderListQueryError(`status 必須為 ${ORDER_STATUSES.join('、')} 其中之一`);
  }

  const page = parsePositiveIntegerParam(query.page, 'page', ORDER_LIST_PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(
    parsePositiveIntegerParam(query.limit, 'limit', ORDER_LIST_PAGINATION.DEFAULT_LIMIT),
    ORDER_LIST_PAGINATION.MAX_LIMIT
  );

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
