# 2026-10-18 我的訂單篩選與分頁

對應 GitHub Issue #3（驗收測試：`tests/acceptance/order-filter.test.js`）。

## User Story
作為會員，我希望查詢自己的訂單時可以依狀態篩選並分頁，以便在訂單變多時快速找到想看的訂單。

## Spec
### API 規格
- `GET /api/orders`（JWT）新增 Query 參數：
  - `status`：`pending` / `paid` / `failed`，省略時不篩選
  - `page`：正整數，預設 1
  - `limit`：正整數，預設 10，超過 50 以 50 計
- 回應沿用後台訂單列表格式：`{ data: { orders: [...], pagination: { page, limit, total, totalPages } }, error, message }`
- 錯誤：`status` 不在允許值內，或 `page`、`limit` 不是正整數 → 400 `VALIDATION_ERROR`（`data: null`）

### 資料庫變更
- 無

### 業務規則
- 只回傳自己的訂單（查詢條件含 `user_id`），`total` 只計算自己且符合狀態的訂單
- 依建立時間由新到舊；`created_at` 只精確到秒，同秒訂單以 `rowid DESC` 排序，確保換頁時不重複、不遺漏
- 只有「未帶參數」才套用預設值；`?status=`、`?page=`、`?limit=` 空字串與重複帶入的參數都視為無效
- 頁碼超過最後一頁回傳空陣列，`pagination` 仍為實際的 `total`、`totalPages`；超出 JS 安全整數範圍的頁碼視為無效
- `totalPages = ceil(total / limit)`，沒有訂單時為 0
- 參數驗證放在 `src/utils/orderListQuery.js`，查詢放在 `orderService.listOrdersForUser`，路由只負責轉成 400 與組合回應

## Tasks
- [x] 建立 `src/utils/orderListQuery.js`（status 白名單、page/limit 驗證與上限、pagination 組裝）
- [x] `listOrdersForUser` 支援 status 篩選、分頁與 total 計算
- [x] `GET /api/orders` 驗證參數並回傳 `pagination`，更新 OpenAPI JSDoc
- [x] 確認前台訂單頁 `orders.js` 讀取 `res.data.orders`，與新格式相容
- [x] 撰寫測試：`tests/orderListQuery.test.js`、`tests/integration/order-list.integration.test.js`，並在 `tests/orders.test.js` 斷言 `pagination`
- [x] 更新文件與 `openapi.json`

## 不在本次範圍
- 後台訂單列表（`GET /api/admin/orders`）的調整
- 依日期區間或關鍵字搜尋
- 前端訂單頁的篩選與分頁 UI（選做，未實作；前台目前只顯示最新 10 筆）
