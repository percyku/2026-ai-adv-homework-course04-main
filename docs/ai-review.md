# AI 程式碼審查報告：訂單、付款、運費、購物車

- 審查日期：2026-10-18
- 審查基準：`main` 分支，commit `72bdbab`
- 審查範圍：訂單、付款（綠界 ECPay）、運費、購物車，以及相關測試
- 審查階段只記錄問題、沒有修改程式碼；之後同日依本報告修正，各項的處理結果見總覽表的「狀態」欄與[修正紀錄](#修正紀錄)

## 審查方式

| 角色 | 負責內容 |
|------|----------|
| security-reviewer | 權限控管、JWT / X-Session-Id、綠界驗簽與金額、輸入驗證、庫存並發 |
| code-reviewer | 業務邏輯與邊界條件、規範遵循、測試品質、文件與實作是否一致 |
| test-runner | 執行 `npm run test:unit`、`npm run test:integration`，比對 `database.sqlite` 是否被改動 |

兩份審查結果合併去重後，再由主 session 抽查程式碼，並在記憶體 DB 上重現最嚴重的幾項。下文「驗證」欄位的意思：

- **實測**：在 `DATABASE_PATH=:memory:` 下實際送出請求，重現了問題
- **讀碼**：主 session 讀過該段程式碼，與審查描述一致
- **審查者讀碼**：只有審查 agent 讀過，主 session 沒有逐行再確認
- **推測**：需要特定環境或部署設定才會發生，沒有實際觸發

## 測試執行結果（修正前）

| 指令 | 通過 | 失敗 | 跳過 | 耗時 |
|------|------|------|------|------|
| `npm run test:unit` | 54 | 0 | 1 | 1.66s |
| `npm run test:integration` | 10 | 0 | 0 | 0.34s |

- 被跳過的是 `tests/shipping.test.js:29`「商品小計 1,500 元時免基本運費」（`it.skip`），它掩蓋的是 H2
- 執行前後專案根目錄都沒有 `database.sqlite`、`-wal`、`-shm`、`-journal`，測試沒有碰到開發 DB
- 沒有 unhandled rejection、open handle 或對外網路連線
- 唯一的警告是 Vite 的 `The CJS build of Vite's Node API is deprecated`，與測試本身無關

**全部測試通過，但不代表沒有問題**：下面的 C1、H1、H2、M1 都已實測重現，現有測試卻沒有一個抓到。

## 問題總覽

| ID | 嚴重度 | 問題 | 來源 | 驗證 | 狀態 |
|----|--------|------|------|------|------|
| C1 | Critical | 購物車 PATCH 接受小數、0、負數，可以用低價買到商品 | 兩者 | 實測 | ✅ 已修正 |
| H1 | High | `GET /api/orders/:id` 沒有檢查擁有者（IDOR） | 兩者 | 實測 | ✅ 已修正 |
| H2 | High | 免運門檻用 `>`，剛好 1,500 元仍收運費 | 兩者 | 實測 | ✅ 已修正 |
| H3 | High | 1,500 元邊界測試被 `it.skip`，讓 H2 一直沒被發現 | code | 讀碼 | ✅ 已修正 |
| M1 | Medium | 綠界查詢結果沒有 CheckMacValue 時直接跳過驗簽 | 兩者 | 實測 | ✅ 已修正 |
| M2 | Medium | 庫存永遠不回補、pending 訂單不會過期，可被用來鎖住庫存 | 兩者 | 審查者讀碼 | ⏸ 暫緩，併入 Issue B |
| M3 | Medium | 角色取自 JWT payload，JWT_SECRET 沒有強度檢查 | security | 讀碼 | ◐ 部分修正 |
| M4 | Medium | 種子管理員有寫死的預設密碼 `12345678` | security | 讀碼 | ⏸ 暫緩，需決定部署政策 |
| L1 | Low | 庫存檢查在 transaction 外，扣庫存沒有條件保護 | 兩者 | 審查者讀碼／推測 | ✅ 已修正 |
| L2 | Low | 綠界金鑰與環境的 fallback、模擬付款只靠 `NODE_ENV` | security | 讀碼 | ⏸ 暫緩，需決定部署政策 |
| L3 | Low | X-Session-Id 沒有格式驗證、不會輪替，訪客購物車沒有上限 | security | 審查者讀碼 | ⏸ 暫緩，需重新設計 |
| L4 | Low | 付款表單頁不需登入 | security | 審查者讀碼 | ⏸ 暫緩，需重新設計 |
| L5 | Low | 訂單編號只有 5 碼 hex，撞號時回 500 | 兩者 | 審查者讀碼 | ✅ 已修正 |
| L6 | Low | 綠界回傳非 `'1'` 的狀態一律當成尚未付款 | code | 審查者讀碼 | ⏸ 暫緩，併入 Issue B |
| L7 | Low | check-payment 在 try 之外的錯誤沒有被接住 | code | 推測 | ✅ 已修正 |
| L8 | Low | `cart_items` 沒有唯一約束，庫存逐列檢查 | code | 推測 | ✅ 已修正（未加唯一索引） |
| L9 | Low | price、stock、數量沒有上限 | security | 審查者讀碼 | ⏸ 暫緩，需決定上限 |
| L10 | Low | 頁面渲染失敗時回傳 `err.message` | security | 審查者讀碼 | ✅ 已修正 |
| L11 | Low | OpenAPI JSDoc 缺少 401 / 403 / 500 與錯誤回應格式 | code | 審查者讀碼 | ✅ 已修正 |
| L12 | Low | 文件寫 55 項測試，但其中 1 項被 skip | code | 讀碼 | ✅ 已修正 |
| L13 | Low | integration、E2E 測試檔名不符 camelCase 規範 | code | 審查者讀碼 | ✅ 已修正（文件註明例外） |

測試缺口另外整理在 [測試缺口](#測試缺口)。

### 評級不同時的處理

| 項目 | security | code | 採用 | 理由 |
|------|----------|------|------|------|
| C1 | Critical | High | Critical | 實測可用一半價格建立訂單，送往綠界的金額就是這個數字，付款驗證也只比對金額是否一致，屬於直接的金流損失 |
| H2 | Low | High | High | 客人實際被收的錢比結帳頁顯示的多 120 元，且違反規格。對應的測試還被 skip |
| L1 | Low | Medium | Low | 目前是單一 Node 行程加 better-sqlite3 同步 API，handler 中間不會被插隊，實際上不會超賣。改成多行程部署時應提升到 Medium |

## 修正紀錄

修正日期：2026-10-18。

### 修正後測試結果

| 指令 | 通過 | 失敗 | 跳過 |
|------|------|------|------|
| `npm run test:unit` | 67 | 0 | 0 |
| `npm run test:integration` | 15 | 0 | 0 |
| `npm run test:acceptance` | 3 | 19 | 0 |

驗收測試是第四場三個 Issue 尚未實作的功能，修正前後都是 3 項通過、19 項失敗，通過的是同樣 3 項，沒有被本次修正影響。

為了確認新測試真的能抓到問題，把 `src/` 與 `app.js` 暫時還原成修正前的版本再跑一次新測試：Unit 有 6 項失敗、Integration 有 6 項失敗，分別對應 C1、H1、H2、H3、M1、M3、L5、L7、L8 與 L1。其中 L7 的測試在修正前會卡住，跑滿 10 秒後逾時，就是審查描述的症狀。

### 已修正

| ID | 修改 | 測試 |
|----|------|------|
| C1 | `src/routes/cartRoutes.js`：PATCH 改用 `parsePositiveInteger`。`src/routes/orderRoutes.js`：建單時購物車若有非正整數數量（修正前留下的舊資料），回 400 `VALIDATION_ERROR` | `tests/cart.test.js`：0、-1、0.5、1e-300、`'abc'`、`''`、`null`、`true`、`[2]` 都回 400，DB 數量不變。整合測試：DB 數量為 0.5 時無法建單 |
| H1 | `src/routes/orderRoutes.js`：改用 `findOrderForUser` | `tests/orders.test.js`：他人訂單回 404 |
| H2 | `src/utils/shipping.js`：`>` 改為 `>=` | `tests/shipping.test.js`：1,500（宅配、超商）、1,501。`tests/orders.test.js`：API 層 1,499 / 1,500 / 1,501 |
| H3 | `tests/shipping.test.js`：移除 `it.skip`，`tests/` 內已沒有任何 skip | 同上 |
| M1 | `src/services/paymentService.js`：一律驗證 CheckMacValue，缺少簽章時 `verifyCheckMacValue` 回 false | 整合測試：缺少簽章、交易編號不符都回 500，訂單維持 pending |
| M3（部分） | `src/middleware/authMiddleware.js`、`src/routes/cartRoutes.js`（dualAuth）：email 與 role 改從 DB 讀取 | `tests/adminOrders.test.js`：一般會員用自簽的 `role: 'admin'` Token 存取後台回 403 |
| L1 | `src/services/orderService.js`：UPDATE 加上 `AND stock >= ?` 並檢查 `changes`，不符時拋出 `StockInsufficientError` 並整筆回滾，路由轉成 400；只刪除本次結帳讀到的購物車品項。讀購物車仍在 transaction 外，但價格與數量以讀到的快照為準，扣庫存有條件保護，不會超賣，也不會誤刪新加入的品項 | 整合測試直接呼叫 `createOrderFromCart`：庫存在檢查後被扣走時回滾；快照後新加入的品項保留 |
| L5 | `src/services/orderService.js`：亂數段改為 9 碼，MerchantTradeNo 為綠界上限 20 碼 | 整合測試的格式斷言改為 9 碼 |
| L7 | `src/routes/orderRoutes.js`：check-payment 用 `asyncHandler` 包住，rejected promise 交給 errorHandler | 整合測試：查詢訂單時拋錯，回標準 500 格式，不呼叫綠界 |
| L8 | `src/services/orderService.js`：`findInsufficientItems` 依 `product_id` 加總數量；錯誤訊息中的商品名稱去重。沒有加 DB 唯一索引，因為既有 DB 需要 migration，而 L1 的條件 UPDATE 已經能擋住超賣 | 整合測試：同商品兩列各 6 件、庫存 10，回 400 |
| L10 | `src/routes/pageRoutes.js`、`app.js`：改回「伺服器內部錯誤」，錯誤只寫進 log | — |
| L11 | `swagger-config.js` 新增 `ErrorResponse` schema 與 `Unauthorized` / `Forbidden` / `InternalError` 回應；訂單、購物車、後台訂單的 11 個端點補齊 401（後台加 403、建單加 500），既有 400 / 404 / 500 補上 schema；重新產生 `openapi.json`，並確認 `npm run postman` 可正常轉換 | — |
| L12 | `docs/FEATURES.md`、`docs/TESTING.md`、`docs/README.md` 更新為 67 / 15 項 | — |
| L13 | `docs/DEVELOPMENT.md` 註明 integration 與 E2E 測試檔的命名例外 | — |

T5 中，`tests/orders.test.js` 的空購物車、未登入，以及 `tests/adminOrders.test.js` 的 403，改為斷言精確錯誤碼；`tests/adminOrders.test.js` 也補上 401 測試。其餘斷言過鬆、依賴前一個測試的問題，以及 E2E 的運費斷言，這次沒有處理。

### 暫緩

| ID | 原因 |
|----|------|
| M2、L6 | 「取消訂單並回補庫存」是第四場 Issue B 的作業內容，已有驗收測試（`tests/acceptance/cancel-order.test.js`）定義行為。failed 狀態是否回補庫存、綠界失敗狀態碼如何對應，應在實作 Issue B 時一起設計。rate limit 需要新增套件 |
| M3（JWT_SECRET 強度檢查）、M4、L2 | 都屬於「正式環境設定漏了就 fail-open」，修法是讓伺服器在正式環境拒絕啟動。但驗收測試、E2E 與文件都使用 `admin@hexschool.com / 12345678`，部署環境也可能刻意使用綠界 staging。是否在正式環境拒絕啟動、`NODE_ENV=production` 時要檢查哪些變數，需要先決定部署政策 |
| L3 | 改由伺服器簽發並輪替 session id，需要同時修改前端 `public/js/auth.js` 與登入合併流程 |
| L4 | 付款頁由瀏覽器直接導向，帶不了 Bearer token，需要另外設計一次性付款 token |
| L9 | 需要先決定商品價格、庫存與單品數量的合理上限 |

---

## Critical

### C1. `PATCH /api/cart/:itemId` 接受小數、0 與負數

- **位置**：`src/routes/cartRoutes.js:296-299`、`:311`、`:315`。後續流向 `src/routes/orderRoutes.js:178-180`、`src/services/orderService.js:59`、`:104-105`、`src/utils/ecpay.js:84`、`:111`
- **問題**：PATCH 只用 `Number(quantity)` 搭配 `Number.isNaN` 檢查，沒有沿用 POST 已經在用的 `parsePositiveInteger`（`src/utils/validators.js:15`）。文件（`docs/FEATURES.md:191`、`:202`）規定數量必須是正整數，否則回 400；`docs/CHANGELOG.md:42` 也宣稱已改成嚴格正整數驗證，實作和文件不一致。DB 的 `CHECK(quantity > 0)` 擋不住小數；SQLite 的 INTEGER 欄位遇到無法無損轉成整數的值，會直接存成 REAL。
- **實測結果**（記憶體 DB，商品「經典紅玫瑰花束」單價 3,980 元、庫存 15）：

  | 操作 | 結果 |
  |------|------|
  | PATCH `{"quantity": 0.5}` | 200，`cart_items.quantity = 0.5`，`typeof = real` |
  | 接著建單 | 201，`subtotal = 1990`、`total_amount = 1990` |
  | 建單後庫存 | `14.5`，`typeof = real` |
  | PATCH `{"quantity": 0}` | **500** INTERNAL_ERROR（應為 400） |
  | PATCH `{"quantity": -1}` | **500** INTERNAL_ERROR（應為 400） |

- **影響**：
  - 會員可以用任意比例的價格下單。綠界收到的 `TotalAmount` 就是被壓低後的金額，付款後 `isTradePaid` 比對金額一致，訂單會被標成 `paid`
  - 庫存和 `order_items.quantity` 出現小數，違反「金額與數量一律為整數」的規範
  - security-reviewer 另外推算，用極小的數量（例如 `1e-300`）可以讓小計趨近 0，總額只剩運費，庫存也幾乎不會扣。這一點**沒有實測**
  - `true`、`[2]`、`"1e1"` 也會被 `Number()` 轉成 1、2、10 而接受（審查者讀碼）
- **建議修正方向**：
  - PATCH 改用 `parsePositiveInteger`，錯誤時回 400 `VALIDATION_ERROR`，並設定合理上限
  - 建單前再檢查一次購物車數量都是整數，多一道防線
  - 考慮在 DB 加上 `CHECK(typeof(quantity) = 'integer')`，`products.stock` 與 `order_items.quantity` 也一樣
- **相關測試缺口**：`tests/cart.test.js` 只測了 POST 的 1.9、`'3abc'`、`[5]`，PATCH 完全沒有邊界測試

## High

### H1. `GET /api/orders/:id` 沒有檢查訂單擁有者（IDOR）

- **位置**：`src/routes/orderRoutes.js:351`
- **問題**：這支路由用的是 `findOrderById`，而不是同一個 service 裡已經有的 `findOrderForUser`。`docs/FEATURES.md:291` 寫明「查詢條件含 `user_id`，他人訂單視為 404」。同一個檔案的 `pay`（`:446`）和 `check-payment`（`:499`）都有正確使用 `findOrderForUser`。
- **實測結果**：會員 B 帶自己的 JWT 讀取會員 A 的訂單，得到 **200**，回應內容包含 A 的收件人姓名。
- **影響**：回應包含收件人姓名、Email、地址、品項、`user_id`、`merchant_trade_no`。訂單 UUID 會出現在送給綠界的 ClientBackURL、`/orders/:id` 與 `/ecpay/payment/:id` 的網址、瀏覽器歷史紀錄與分享的連結裡。UUIDv4 無法暴力猜測，這點有降低風險，但仍屬於存取控制失效。
- **建議修正方向**：改用 `findOrderForUser(req.params.id, req.user.userId)`，查不到時回 404，並補上「他人訂單回 404」的測試。

### H2. 免運門檻用了 `>`，剛好 1,500 元仍收運費

- **位置**：`src/utils/shipping.js:40`
- **問題**：程式是 `return subtotal > SHIPPING_RATES.FREE_SHIPPING_THRESHOLD;`。規格寫「滿 1,500 元」（`docs/FEATURES.md:232`、`docs/ARCHITECTURE.md:420`、`docs/CHANGELOG.md:73`），應該用 `>=`。前端也是用 `>=`：`public/js/pages/checkout.js:28` 是 `cartTotal.value >= 1500`，`views/pages/cart.ejs:17` 是 `total < 1500`。
- **實測結果**：

  | 小計 | 是否免運 | 運費 |
  |------|----------|------|
  | 1,499 | false | 120 |
  | **1,500** | **false** | **120** |
  | 1,501 | true | 0 |

- **影響**：小計剛好 1,500 元時，結帳頁顯示運費 0、總額 1,500；後端卻存成 `shipping_fee = 120`、`total_amount = 1620`，送到綠界的金額也是 1,620。客人被收的錢比畫面顯示的多 120 元（超商取貨多 60 元）。
- **建議修正方向**：改成 `>=`。補上 1,500 和 1,501 的邊界測試，宅配與超商取貨兩種都要測。另外加一筆 API 層測試：自建單價 1,500 的商品下單，斷言運費。長期來說，前端最好改用伺服器回傳的試算結果，不要自己再算一次。

### H3. 1,500 元邊界測試被 `it.skip`

- **位置**：`tests/shipping.test.js:29`
- **問題**：`it.skip('商品小計 1,500 元時免基本運費', ...)`。拿掉 skip，這個測試會因為 H2 而失敗。整個 `tests/` 只有這一處用了 `.skip` / `.only` / `.todo`。另外沒有 1,501 的測試，「剛好等於」和「+1」兩個邊界都沒有實際執行到。
- **影響**：CI 全綠，門檻錯誤卻一直留在程式裡。
- **建議修正方向**：修好 H2 後拿掉 `.skip`，並補上 1,501 的案例。可以考慮在 CI 加一道檢查，禁止 `.skip` / `.only` 合併進主線。

## Medium

### M1. 綠界查詢結果沒有 CheckMacValue 時直接跳過驗簽

- **位置**：`src/services/paymentService.js:15`
- **問題**：條件是 `if (tradeInfo.CheckMacValue && !verifyCheckMacValue(...))`，回應沒帶簽章就完全不驗。後面只核對 `MerchantTradeNo` 和 `TradeAmt`，這兩個值都不是秘密。`docs/FEATURES.md:380` 與 `docs/CHANGELOG.md:36` 都宣稱標記已付款前一定會驗簽。
- **實測結果**：傳入 `{ TradeStatus: '1', MerchantTradeNo: <正確值>, TradeAmt: <正確金額> }`，不帶 CheckMacValue，`isTradePaid` 回傳 **`true`**。
- **影響**：只要攻擊者能竄改或偽造 QueryTradeInfo 的回應（不安全的出站 proxy、DNS 劫持，或 `queryTradeInfoUrl` 設錯），沒付款的訂單就會被標成 `paid`。要實際利用需要網路位置或設定錯誤，這部分是推測。
- **建議修正方向**：狀態為已付款時，CheckMacValue 為必填，缺少就視為驗證失敗。順便核對 `MerchantID` 是否等於設定值。補上「缺少簽章」與「MerchantTradeNo 不符」的整合測試。

### M2. 庫存永遠不回補、pending 訂單不會過期

- **位置**：
  - `src/routes/orderRoutes.js:459-460`：`fail` 只改狀態，不回補庫存
  - `src/database.js:66`：訂單狀態只允許 `pending` / `paid` / `failed`
  - `src/services/orderService.js:105`：建單時就扣庫存
  - `src/routes/adminProductRoutes.js:357-369`：商品只要出現在任何 pending 訂單裡，就無法刪除（409）
  - `app.js`：沒有 rate limit
- **問題**：狀態只會從 pending 轉成 paid 或 failed，而且有 `WHERE status = 'pending'` 防止倒退，這部分是對的。但轉成 failed 時不會回補庫存，pending 訂單也沒有逾期機制。每筆訂單的 MerchantTradeNo 是固定的（文件已列為已知限制），使用者放棄付款後只能重新下單，舊訂單會一直占住庫存。
- **影響**：
  - 一般情境：使用者下單 2 件，在綠界頁面放棄付款後重新下單，庫存被扣了 4 件，舊訂單永遠是 pending，該商品也永遠刪不掉
  - 惡意情境：註冊不需要驗證 Email，建單也沒有頻率限制。腳本可以大量註冊帳號，把每個商品的全部庫存放進購物車後建單但不付款，讓所有商品庫存歸零。管理員補貨後可以馬上重複
- **建議修正方向**：這和第四場 Issue「取消訂單並回補庫存」（`tests/acceptance/cancel-order.test.js`）直接相關。轉成 failed 或 cancelled 時，在同一個 transaction 內依 `order_items` 回補庫存；pending 訂單加上逾期機制；限制每人未付款訂單數量；對 auth、cart、orders 加上 rate limit。

### M3. 角色取自 JWT payload，JWT_SECRET 沒有強度檢查

- **位置**：`src/middleware/authMiddleware.js:18`、`:27-31`；`.env.example:6`（`JWT_SECRET=your-jwt-secret-key-here`）
- **問題**：authMiddleware 已經查了 DB，但只 `SELECT id`，`role` 直接採用 token 裡的值。啟動時也沒有檢查 secret 的長度，或是否還是範本值。
- **影響**：
  - 部署時直接複製 `.env.example`，攻擊者用公開的範本字串簽出 `{ userId: 自己的 id, role: 'admin' }`，就能通過 authMiddleware 與 adminMiddleware，讀取所有訂單的收件個資
  - 管理員在 DB 被降權後，舊 token 在 7 天內仍保有 admin 權限
  - 能否利用取決於部署設定，這部分是推測
- **建議修正方向**：authMiddleware 改從 DB 讀取 role，以 DB 為準。啟動時檢查 `JWT_SECRET` 存在、長度足夠且不是範本值，否則拒絕啟動。

### M4. 種子管理員有寫死的弱預設密碼

- **位置**：`src/database.js:116-117`（`process.env.ADMIN_PASSWORD || '12345678'`）；`.env.example:16-17`
- **問題**：沒有設定環境變數時，系統會自動建立 `admin@hexschool.com / 12345678` 這組管理員帳號。
- **影響**：正式環境忘了設 `ADMIN_PASSWORD`，任何人都能用預設帳密登入後台，讀取所有訂單個資並修改商品價格與庫存。
- **建議修正方向**：非測試環境缺少 `ADMIN_PASSWORD`，或密碼仍是預設值時，拒絕 seed 或拒絕啟動。也可以改成首次登入強制修改密碼。

## Low

### L1. 庫存檢查在 transaction 外，扣庫存沒有條件保護

- **位置**：`src/routes/orderRoutes.js:157-175`（讀購物車、檢查庫存）；`src/services/orderService.js:83`（`UPDATE products SET stock = stock - ? WHERE id = ?`）、`:105`（沒有檢查 `changes`）、`:108`（清空該使用者全部品項）
- **問題**：讀購物車與檢查庫存都在 `db.transaction()` 之外，transaction 內也沒有重新驗證。目前是單一行程加同步 API，所以實際上安全；負庫存也會被 `CHECK(stock >= 0)` 擋下。
- **影響**（多行程才會發生，例如 PM2 cluster 或多個實例共用同一個 SQLite 檔）：
  - 兩筆訂單同時搶最後的庫存，後到的那筆撞上 CHECK，回 500 而不是 400 `STOCK_INSUFFICIENT`
  - 商品在檢查後被刪除時，UPDATE 影響 0 列也不會報錯，訂單照樣成立，但沒有扣庫存
  - 其他行程在中間新加入購物車的品項，會被 `clearCart` 一起刪掉
- **建議修正方向**：把「讀購物車、檢查庫存、扣庫存」都放進同一個 transaction（用 IMMEDIATE）。UPDATE 加上 `AND stock >= ?` 並檢查 `changes === 1`，不符時拋出可辨識的錯誤，轉成 400。清空購物車時只刪這次快照到的品項。

### L2. 綠界與模擬付款的預設值會 fail-open

- **位置**：`src/utils/ecpay.js:3-8`；`src/routes/orderRoutes.js:25-30`
- **問題**：
  - `ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV` 都 fallback 到綠界公開的 staging 值，`ECPAY_ENV` 預設是 staging。正式環境漏設時會靜默使用測試環境，客人用測試卡「付款」後訂單照樣變成 paid，但實際上沒收到錢
  - 模擬付款端點只靠 `NODE_ENV === 'test'` 開關。正式環境若誤設成 test，任何會員都能把自己的訂單標成已付款
- **建議修正方向**：非測試環境缺少 ECPay 變數時拒絕啟動，不使用 fallback 值；正式環境明確禁止 `NODE_ENV=test`。

### L3. X-Session-Id 沒有格式驗證、不會輪替

- **位置**：`src/middleware/sessionMiddleware.js:2-5`；`src/routes/authRoutes.js:14-41`、`:145`、`:245`；`public/js/auth.js:34-41`
- **問題**：伺服器接受任何字串當 session id（例如 `"1"`），沒有長度或格式限制，登入後也不換發新的。前端用 `crypto.randomUUID()` 產生，熵是足夠的。訪客的 `cart_items` 沒有過期機制，也沒有頻率限制。
- **影響**：知道受害者 session id 的人（例如共用電腦時讀 localStorage）可以預先塞商品，讓受害者登入時合併進會員購物車；也可以用受害者的 session id 登入自己的帳號，把對方的訪客購物車拿走。匿名者還能用隨機 session id 無限新增 `cart_items`。利用門檻高。
- **建議修正方向**：驗證 UUID 格式；改由伺服器簽發 session id，登入合併後作廢舊 id；訪客購物車設 TTL 並加 rate limit。

### L4. 付款表單頁不需登入

- **位置**：`src/routes/pageRoutes.js:61-72`
- **問題**：知道訂單 UUID 的人都能取得綠界表單，內容包含 ItemName、TotalAmount、MerchantTradeNo。不含收件資料，文件已列為已知限制。
- **建議修正方向**：要求 JWT 並比對擁有者，或改用短效的一次性付款 token。

### L5. 訂單編號只有 5 碼 hex，撞號時回 500

- **位置**：`src/services/orderService.js:4-11`；`src/database.js:55`（`order_no UNIQUE`）
- **問題**：每天只有 16⁵（約 105 萬）種組合。以生日問題估算，單日約 1,000 筆訂單時當天撞號的機率約 38%。撞號時 INSERT 失敗、transaction 回滾，回 500，沒有重試。`merchant_trade_no` 由 order_no 推導，同樣受影響。
- **建議修正方向**：撞號時重試，或加長亂數段（綠界 MerchantTradeNo 上限 20 字元，還有空間）。

### L6. 綠界回傳非 `'1'` 的狀態一律當成尚未付款

- **位置**：`src/routes/orderRoutes.js:531-536`
- **問題**：交易失敗的狀態碼，或無法解析的回應（`TradeStatus` 是 undefined），都會回 200「尚未完成付款」，訂單永遠停在 pending，讓 M2 更嚴重。
- **建議修正方向**：把綠界明確代表失敗的狀態對應成 failed；回應缺少 `TradeStatus` 時視為查詢錯誤。綠界各狀態碼的語意需要再對照官方文件確認。

### L7. check-payment 在 try 之外的錯誤沒有被接住

- **位置**：`src/routes/orderRoutes.js:496-502`
- **問題**：這是 async handler，而 Express 4 不會處理 rejected promise。`findOrderForUser` 寫在 try 之外，若它拋錯，就會變成 unhandled rejection，請求卡住沒有回應，也不會套用統一的錯誤格式。
- **建議修正方向**：讓 try/catch 包住整個 handler，或用 async wrapper 把錯誤交給 `next(err)`。
- **驗證**：推測，需要 DB 實際拋錯才會發生。

### L8. `cart_items` 沒有唯一約束，庫存逐列檢查

- **位置**：`src/database.js:43-51`；`src/services/orderService.js:58-60`
- **問題**：「同一商品只有一列」只靠應用程式邏輯維持，DB 沒有約束；`findInsufficientItems` 也是逐列檢查，不會依商品加總。
- **影響**：若同一使用者出現兩列各 6 件、庫存只有 10，兩列都會通過檢查，扣庫存時撞上 CHECK 回 500。目前的程式路徑不會產生重複列。
- **建議修正方向**：加上 `(user_id, product_id)` 與 `(session_id, product_id)` 的部分唯一索引，或檢查庫存時依 `product_id` 加總。

### L9. 金額與數量沒有上限

- **位置**：`src/routes/adminProductRoutes.js:181-185`、`:286-290`；`src/routes/orderRoutes.js:178-180`
- **問題**：price 和 stock 只檢查 `Number.isInteger`，沒有上限。`price * quantity` 可能超過 `Number.MAX_SAFE_INTEGER` 而失去精度，也可能超過綠界的單筆金額上限。這些值只有管理員能設定。
- **建議修正方向**：為 price、stock、單品數量設定合理上限；建單時檢查 `total_amount` 是安全整數，且在金流允許範圍內。

### L10. 頁面渲染失敗時回傳 `err.message`

- **位置**：`src/routes/pageRoutes.js:9`、`:17`；`app.js:50`
- **問題**：EJS 渲染出錯時直接 `res.status(500).send(err.message)`，可能洩漏模板路徑或內部訊息。一般使用者輸入不容易觸發。
- **建議修正方向**：交給 errorHandler，或固定回傳通用錯誤頁。

### L11. OpenAPI JSDoc 缺少錯誤狀態碼與回應格式

- **位置**：`src/routes/orderRoutes.js`（所有端點缺 401，POST 缺 500）；`src/routes/cartRoutes.js`（缺 401）；`src/routes/adminOrderRoutes.js`（缺 401、403）
- **問題**：`docs/DEVELOPMENT.md:241-242` 規定要列出所有可能的狀態碼，錯誤回應也要有 `{ data, error, message }` 格式。目前 400 和 404 只有 description，沒有 schema。產生的 `openapi.json` 與 Postman Collection 都看不到這些錯誤回應。
- **建議修正方向**：補齊 JSDoc 後執行 `npm run openapi`。

### L12. 文件的測試數量把 skip 的也算進去

- **位置**：`docs/FEATURES.md:17`、`docs/TESTING.md:16`
- **問題**：文件寫「55 項 Unit/API」，實際是 54 項執行、1 項 skip。
- **建議修正方向**：修好 H2、H3 後數字自然一致；之後若新增測試，記得同步更新。

### L13. integration 與 E2E 測試檔名不符命名規則

- **位置**：`tests/integration/order-checkout.integration.test.js`、`tests/e2e/ecpay-atm-payment.spec.js`
- **問題**：`docs/DEVELOPMENT.md:10` 規定測試檔名用 camelCase，這兩個檔案是 kebab-case。`docs/ARCHITECTURE.md` 已經照這兩個檔名記錄，屬於輕微不一致。
- **建議修正方向**：統一命名，或在 `docs/DEVELOPMENT.md` 註明這兩類測試是例外。

---

## 測試缺口

C1、H1、H2、M1 都能通過 CI，原因是對應的情境沒有被測到，或測試被 skip。依優先順序：

### T1. `tests/cart.test.js`

- PATCH 數量為 `0`、`-1`、`0.5`、`"abc"`、`null`，應回 400 `VALIDATION_ERROR`（對應 C1）
- POST 與 PATCH 超過庫存（`STOCK_INSUFFICIENT`），以及剛好等於庫存
- 同一商品重複 POST，應合併成一列並累加數量（目前只在登入合併時間接涵蓋）
- 用別人的 session 或 JWT 去 PATCH / DELETE 某品項，應回 404
- Bearer token 無效時回 401；兩個 header 都沒帶時回 401
- 合併訪客購物車時，庫存為 0 的品項會被捨棄；庫存為 0 的商品加入購物車

### T2. `tests/orders.test.js`

- 用 B 的 token 讀 A 的訂單，應回 404（對應 H1）；對他人訂單呼叫 `pay`、`check-payment` 也應回 404
- 只帶 X-Session-Id、不帶 JWT 建單，應回 401（現有的 `should fail to create order without auth` 兩個 header 都沒帶）
- 模擬付款 `action: 'fail'` 轉成 failed、無效的 action
- `shippingMethod` 非法、`isRemoteArea` / `isExpress` 不是 boolean、Email 格式錯誤
- 自建單價 1,499、1,500、1,501 的商品下單並斷言運費（對應 H2）。目前用的是種子資料的 `products[0]`，價格不在門檻附近，而且種子商品的 `created_at` 相同，`ORDER BY created_at DESC` 遇到同值時，取到哪個商品不一定

### T3. `tests/integration/order-checkout.integration.test.js`

- 缺少 CheckMacValue、MerchantTradeNo 不符（對應 M1）。目前只測了簽章被竄改與金額不符（`:426-436`）
- 下單後商品改價、改名，訂單品項仍是下單當時的快照
- 建單只清空自己的購物車，其他會員與訪客的購物車不受影響
- check-payment 遇到非 pending 訂單、`NO_TRADE_NO`、他人訂單，以及重複呼叫時的冪等性
- 回滾目前只驗證「寫入品項失敗」，沒有驗證「扣庫存失敗」
- 斷言庫存與數量不會出現小數

### T4. 認證

- JWT 過期、簽章被竄改、`alg: none` 或非 HS256、已刪除使用者的 token
- `/api/admin/orders` 不帶 token 應回 401

### T5. 斷言過鬆與測試間的順序依賴

| 位置 | 問題 |
|------|------|
| `tests/orders.test.js:64-81` | 「空購物車」測試依賴前一個測試把購物車清空，只斷言 400 與 `error` 存在，沒確認是 `CART_EMPTY` |
| `tests/orders.test.js:83-95` | 「未登入」只斷言 `error` 不是 null |
| `tests/orders.test.js:121` 附近 | `shipping_fee` 只檢查欄位存在；`items` 只檢查是陣列，沒檢查內容與長度 |
| `tests/adminOrders.test.js:20-32` | `beforeAll` 沒有斷言建單成功 |
| `tests/adminOrders.test.js:50-60` | 篩選結果是空陣列時會直接通過，也沒確認剛建立的訂單有出現；沒有測 paid / failed 篩選、非法 status、分頁 |
| `tests/adminOrders.test.js:83-92` | 403 只檢查 `error` 不是 null，沒確認 `FORBIDDEN` 與 `data: null` |
| `tests/cart.test.js:27`、`:41-43`、`:73-86` | `quantity` 只檢查欄位存在；`total` 沒斷言金額；會員加入購物車沒斷言數量是 2 |
| `tests/cart.test.js:46` | PATCH 與 DELETE 依賴第一個測試產生的 `cartItemId` |
| `tests/e2e/ecpay-atm-payment.spec.js:169` | 運費只斷言 `toBeGreaterThanOrEqual(0)`，但 `docs/TESTING.md` 說會「以 API 核對配送費與總額」 |

建議每個測試自己準備資料，並斷言精確的錯誤碼、數值與 DB 狀態。

### T6. 其他

- 沒有並發或搶最後一件庫存的測試
- E2E 用種子管理員帳號當買家（`tests/e2e/ecpay-atm-payment.spec.js:3-4`），屬於測試習慣問題，不是弱點

---

## 已檢查、未發現問題

**權限與認證**
- 後台路由在所有路由之前都掛了 `authMiddleware, adminMiddleware`（`adminOrderRoutes.js:9`、`adminProductRoutes.js:11`）
- 建單只接受 JWT：`orderRoutes.js:22` 是 `router.use(authMiddleware)`，只帶 X-Session-Id 會回 401
- 購物車 GET、PATCH、DELETE 都用 `owner.field` 限定擁有者；會員品項的 `session_id` 是 NULL，用 session 模式查不到
- dualAuth 先看 JWT；帶了無效的 Bearer 會直接回 401，不會退回 session 模式
- JWT 驗證限定 `algorithms: ['HS256']`、7 天過期、錯誤訊息通用、會查 DB 確認使用者存在、沒有 secret fallback

**綠界**
- CheckMacValue 的產生方式（不分大小寫排序、整串轉小寫、.NET 風格 URL encode、SHA256 轉大寫）正確，比對用 `timingSafeEqual` 加長度檢查
- 付款驗證會核對 MerchantTradeNo 與 TradeAmt；`markOrderPaid` 只更新 pending 訂單，具冪等性；paid 與 failed 都不能經 check-payment 轉成 paid
- 沒有 ReturnURL 或 OrderResultURL 的 handler，因此不存在沒驗簽的 callback 入口

**金額與訂單**
- 總額與運費只在伺服器計算，前端送來的金額不會被採用，價格取自 DB 的即時值
- `total_amount = subtotal + shipping_fee` 在計算、寫入、回應與綠界 TotalAmount 之間都一致（前提是數量為整數，見 C1）
- 品項快照在 transaction 內寫入下單當時的 `product_name` 與 `product_price`
- 建單 transaction 順序是「建立訂單 → 寫品項 → 扣庫存 → 清空購物車」，符合規範；寫入品項失敗會整筆回滾，已有整合測試驗證；清空購物車只刪 `WHERE user_id = ?`

**購物車**
- POST 重複加入同一商品會合併成一列並累加數量；數量驗證嚴格，累加後也會檢查庫存；商品不存在回 404
- 刪除商品時，會在 transaction 中先清掉所有購物車裡的該商品
- 訪客購物車合併：同商品相加、以庫存為上限、庫存為 0 的品項捨棄，最後刪掉訪客品項

**輸入、輸出與規範**
- SQL 全部參數化；`${owner.field}` 只會是兩個常數之一，admin 的 status 有白名單
- errorHandler 回 `{ data: null, error, message }`，500 一律回「伺服器內部錯誤」，不帶 stack 或 SQL 錯誤
- `/api` 的 404 與各路由錯誤路徑都符合統一格式（`/ecpay/payment/:orderId` 回純文字，但它是頁面路由）
- XSS：EJS 一律用 `<%= %>`，`<%- %>` 只用在 include 與 body；Vue 用 `{{ }}`；header 的使用者名稱用 `textContent`；綠界表單有 `escapeHtml`
- CSRF：API 用 Bearer header 而不是 cookie，CORS 限定來源
- better-sqlite3 一律用同步 API

**測試與 CI**
- unit、integration、acceptance 三個設定都透過 `setupFiles` 載入 `tests/setup/testEnvironment.js`，在 import app 之前把 `DATABASE_PATH` 設成 `:memory:`；integration 另有雜湊比對守衛。test-runner 實際執行後也確認沒有產生 `database.sqlite`
- 除了 H3，`tests/` 裡沒有其他 `.skip`、`.only`、`xit`、`.todo` 或被註解掉的測試
- `.github/workflows/test.yml` 只跑 `npm ci`、`test:unit`、`test:integration`
- `playwright.config.js` 沒有 `webServer`；`tests/e2e/global-setup.js` 只探測服務是否在線

---

## 建議修正順序

1. **C1、H1**：直接影響金額與個資，修法也最小：改用現成的 `parsePositiveInteger` 與 `findOrderForUser`，並補 T1、T2 對應的測試
2. **H2、H3**：一個字元的修正，加上取消 skip 與補邊界測試
3. **M1**：CheckMacValue 改為必填，並補 T3 的兩個案例
4. **M3、M4、L2**：都是「部署設定漏了就 fail-open」，可以一起做成啟動時的設定檢查
5. **M2**：和第四場「取消訂單」Issue 一起設計庫存回補與訂單逾期
6. 其餘 Low 與 T5 斷言強化，可以排進後續整理
