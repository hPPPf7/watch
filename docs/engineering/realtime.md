# 即時同步、活動狀態與 revision

修改 SSE、Redis Pub/Sub、fallback polling、活動判斷或 revision 失效通知時查閱。Redis 部署與容量評估見 [部署與發布](deployment.md#共用資源與維運)。

## 連線與 fallback

- Watchlist 與好友通知在有 `REDIS_URL` 時優先使用 Redis Pub/Sub。未設定或不可用時，watchlist 使用同一 server instance 共用的 DB poller，好友通知保留低頻 fallback，避免部署尚未補齊就中斷更新。
- 前端即時連線正常時不另加 connected polling；首頁狀態、好友頁與 watchlist 皆沿用此原則。斷線時才啟用低頻保險，不把 fallback 改成常態同步主路徑。
- 同一分頁的頁首、清單、詳細資料視窗共用一條 watchlist SSE；連線正常不另行輪詢。詳細資料停止 20 秒輪詢，斷線時才以五分鐘 fallback 補查，編輯期間暫停。伺服器解除訂閱必須可重複呼叫；休眠前的請求完成後，仍須交付恢復操作後排入的更新。

## 活動、閒置與 session 重驗

- 頁面在背景或使用者長時間未互動時，允許暫停 SSE / polling 以節省資源；恢復互動後再自動恢復同步。這裡的「恢復互動」指使用者真的有動作（`mousedown` / `wheel` / `touchstart` / 於輸入元件按鍵），**不包含**分頁單純變回可見或視窗被 focus——純用鍵盤切回分頁、或視窗被叫到前景卻沒操作，都不該觸發補查 / 重連，避免來回切焦點時的無謂用量。此判斷集中在 `usePageActivityState`，SSE / 集數補查等消費端一律沿用它的 `pageInactive`。
- `next-auth` 的 `SessionProvider` 仍需在視窗取得焦點時重驗 session，才能及時反映過期、撤銷與跨分頁登入狀態；`AuthProvider` 必須依實際 user 欄位穩定輸出的 `session` 參考，避免相同內容的重驗結果讓月曆 / 好友等相依 effect 白白重跑。

集數本機時鐘與六小時掃描週期見 [TMDB 與集數資料](tmdb.md#集數計算與補查)。

## Revision 與通知

- 短命 key（revision 簽章快取、`watch:updates:<userId>` latest record）在有 `REDIS_URL` 時優先走 Redis，不再借用 Neon 的 `tmdb_cache` 表；Redis 讀取失敗一律視為 cache miss 並 fallback 回 DB 路徑，不能因 Redis 掛掉而中斷功能。latest watch update 的 DB 寫入仍是 source of truth，Redis 只是讀取熱路徑的快取；從 DB 回填 Redis 時必須用 NX（ifAbsent），避免舊資料蓋掉併發寫入的新紀錄。
- revision 簽章快取的 TTL（目前 5 分鐘）是「漏通知時的自我修復上限」，不是即時性來源：即時性由「資料變更必發 watch update 事件 → 新鮮度檢查立刻作廢快取」保證。因此任何會改到簽章涵蓋欄位（清單、觀看紀錄、分享、tv_states）的寫入路徑都必須 publish watch update，包含 cron / 維運腳本這類不經一般 API 的路徑；做不到的路徑等於接受最長一個 TTL 的跨裝置延遲與衝突檢查鈍化。調大 TTL 前需先盤點所有寫入路徑都有 publish。
