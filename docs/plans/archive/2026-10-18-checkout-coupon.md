# 2026-10-18 結帳優惠碼

對應 GitHub Issue #1（驗收測試：`tests/acceptance/coupon.test.js`）。

## User Story
作為會員，我希望結帳時輸入一組優惠碼折抵商品金額，以便用活動優惠購買花束。

## Spec
### API 規格
- `POST /api/orders`（JWT）：Request Body 新增選填 `couponCode`（string，不分大小寫；空字串或全為空白視同未使用）
- 建單成功 201：`data` 新增 `discount`（未使用為 0）與 `coupon_code`（大寫，未使用為 null），並保留 `subtotal`、`shipping_fee`、`total_amount`
- `GET /api/orders`、`GET /api/orders/:id`、後台訂單 API：回傳 `coupon_code` 與 `discount`
- 錯誤：`couponCode` 非字串 → 400 `VALIDATION_ERROR`；優惠碼不存在、已失效或未達門檻 → 400 `INVALID_COUPON`

### 資料庫變更
- `orders` 新增 `coupon_code TEXT`（可為 NULL）與 `discount INTEGER NOT NULL DEFAULT 0`
- 以 `PRAGMA table_info` 檢查後 `ALTER TABLE`，可重複執行；舊訂單維持 NULL / 0，總額不變

### 業務規則
| 優惠碼 | 折扣內容 | 使用條件 |
|--------|----------|----------|
| `FLOWER100` | 折抵 100 元 | 商品小計滿 800 元 |
| `SPRING10` | 商品小計打 9 折，最多折抵 300 元 | 無門檻 |
| `SUMMER50` | 折抵 50 元 | 已失效 |

- 每張訂單最多 1 組優惠碼；規則集中在 `src/utils/coupon.js`，不提供後台管理
- 只折抵商品小計，不折抵運費；免運門檻（1,500 元）以折扣後小計判斷
- 折扣四捨五入至整數；`total_amount = subtotal - discount + shipping_fee`
- 優惠碼檢查在 transaction 之前，失敗時不建立訂單、不扣庫存、不清空購物車

## Tasks
- [x] 建立 Coupon 模組 `src/utils/coupon.js`
- [x] `orders` 表新增 `coupon_code`、`discount` 與 migration
- [x] `createOrderFromCart` 寫入優惠碼快照並以 `subtotal - discount + shipping_fee` 計算總額
- [x] `POST /api/orders` 驗證與套用 `couponCode`，運費改用折扣後小計
- [x] 前台與後台訂單詳情顯示折扣
- [x] 撰寫測試：`tests/coupon.test.js`、`tests/integration/order-coupon.integration.test.js`
- [x] 更新文件與 `openapi.json`

## 不在本次範圍
- 後台管理優惠碼、使用次數上限、每人限用次數
- 前端結帳頁的優惠碼輸入欄位（選做，未實作）
