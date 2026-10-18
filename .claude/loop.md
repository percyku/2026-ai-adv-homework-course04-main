# Issue Loop

每輪依序判斷，做完一件事就結束本輪。只看自己開的 open Issue（--author @me --state open）。

1. 有 in-progress：上一輪沒有正常結束，在 Issue 留言說明，改為 needs-human
2. 有 in-review：用 gh pr checks 查 PR 的 CI
   - 失敗：用 gh run view <run id> --log-failed 取得 log，交給 test-runner 分析，修正後推送
   - 執行中或已通過：等待人工合併，本輪不領新的 Issue
3. 有 ready：取建立時間最早的一個，執行 /work-issue <編號>
4. 都沒有：本輪不做事，等待下一輪（作業完成後再手動取消排程）

## 邊界

- 同時只處理一個 Issue，只處理自己開的 Issue
- 修正輪數以 Issue 上的回報留言計算，合計超過 3 輪就改為 needs-human
- 不得合併 PR，不得修改 tests/acceptance/

## 每輪回報

本輪有動作，就在該 Issue 留言：
Loop 回報｜Issue #<編號>｜第 <N> 輪

- 本輪動作：
- CI 狀態：
- 下一步：
