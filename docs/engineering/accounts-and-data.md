# 帳號、觀看紀錄與資料一致性

修改 auth／profile／account、觀看紀錄與分享 API、交易鎖、TV state 寫入或私人資料讀取時，查閱對應章節。桌面身份快取另見 [桌面版](desktop.md)。

## 帳號與刪除範圍

- `watch` 現在已切到共用 `hanburger-auth`，`watch` 自己保留專案資料庫；修改 auth / profile / account 流程時，需明確區分 `AUTH_DATABASE_URL` 與 `DATABASE_URL`。
- `/account` 目前應理解為 `Watch` 專案資料與個人設定頁，不代表整個 HanBurger 平台帳號中心；整個平台帳號管理應集中到共用帳號管理頁。
- `identity mapping` 失敗時採 fail-closed，寧可登入失敗，也不要 fallback 到另一個 user id。
- `auth_user_map` 指向不存在 user 屬不可接受狀態；由於 `auth_user_map` 與使用者資料現分屬 `AUTH_DATABASE_URL` / `DATABASE_URL` 兩個獨立資料庫，無法用原生 FK 約束，改由應用層 fail-closed 阻擋（見 `src/auth.ts` identity mapping 邏輯）。

- 「只刪除本網站資料」（`/api/account/delete-site`）：清除 Watch 的清單、觀看紀錄、分享、好友／邀請與 TV state，保留共用帳號、個人資料及登入資格。
- 「刪除共用帳號」（`/api/account/delete`）：清除上述 Watch 業務資料，以及共用登入 mapping、session 與個人資料，使該帳號登入失效；此端點不清除其他網站的業務資料。
- 刪除文案與確認範圍必須對應上述兩種操作。共用帳號刪除涉及 Watch 與共用 Auth 兩個資料庫，不可只清單一 Watch 模組，也不可宣稱已清除整個平台各網站的業務資料。

- `watch_history` 刪除後，掛在其上的 `watch_history_shares` 不保留殘骸。
- owner 刪帳後，由他建立的分享紀錄與主觀看紀錄都應清掉。
- target 刪帳後，只移除該 target 的 share 關係，owner 主紀錄保留。
- 好友關係與好友邀請只要任一方刪帳，應一併消失。

## 觀看紀錄與進度

- `想看` 是清單中的未看狀態，不是可隨意丟棄的暫存 watchlist。
- 只要已有觀看紀錄，就不能直接從清單移除。
- 影集／動畫自己的紀錄與好友同步給自己的紀錄視為同等進度，DetailModal 也沿用此規則。
- 電影同一天同一部作品只能有一筆觀看紀錄。
- 影集／動畫的重複判斷以同一天、同作品、同季同集為範圍，涵蓋自己新增與同步紀錄；不同觀看日期可保留重看紀錄。這與進度計算的跨日期去重是兩件事。
- `watch_history.watched_at` 目前代表觀看日期，不是任意時間點；寫入時應固定為 UTC 午夜，避免月曆日期語意漂移。
- 電影觀看紀錄的 `season_number / episode_number` 必須固定為 `0 / 0`。
- `originalDate` 只要有帶，就必須是有效日期；不能把壞字串默默當成 `null`。
- 編輯觀看紀錄時，只要目標日期已存在同作品 / 同季同集紀錄，就直接擋下，不做自動合併。
- 若好友在同一天同作品已有紀錄，這次同步整筆不成立，不是略過該好友繼續存。
- 影集觀看進度以作品、季、集去重；重看與不同好友分享同一集仍算一集，最新觀看日期另外計算。
- 編輯或刪除觀看紀錄的 revision 衝突只比較清單項目、觀看紀錄與傳入／傳出分享關係；背景集數掃描寫入的 `watchlist_tv_states` 不得讓同一裝置誤判成觀看紀錄衝突。清單同步使用的完整 revision 仍需包含 TV state。

## 交易鎖與分享

- 好友分享授權必須在 transaction 內、取得 canonical friendship advisory lock 後讀取；send/accept/remove 與三個 history 分享寫入路徑共用小寫 UUID 排序後的 pair key。多組鎖須先去重排序，並先於 watchlist item / history target 鎖取得。
- 清單移除必須在 item lock 內重新查詢自己及好友分享的觀看紀錄；建立或分享紀錄須先取得所有相關使用者的 item lock，並在同一交易確保清單項目存在。新增好友清單不得覆寫其既有動畫分類；分類缺值時從 owner 清單推導。
- 三個 history 分享入口先驗證原始 friendIds 陣列最多 100 筆（重複值也計入），格式不符或超量整筆回 400，且不得進入資料庫交易；通過後才正規化與去重，不得截斷名單。
- 分享所需的 relationship / item advisory locks 必須先 canonical 排序去重，再各用一筆批次 SQL 依 ordinality 取得；ORDER BY 不得引用鎖函式本身。授權查詢仍須在鎖定完成後以另一個 statement 執行。好友清單補建使用批次 INSERT SELECT / NOT EXISTS / ON CONFLICT DO NOTHING，保留既有分類；owner 先補建，再供好友缺分類時推導。
- history-upsert 已在交易內建立觀看紀錄、分享與必要清單項目，前端不再補呼叫 history-sync-watchlist；刪紀錄亦不再追加清分享請求。舊端點保留相容性。
- 刪除單筆觀看紀錄須先取得與編輯相同的 item lock，再找紀錄、清分享、按已選定的 id 刪除並確認受影響筆數；失配需回滾交易，不能只刪掉分享。

## TV state 批次寫入

- TV state 單次最多 200 筆原始資料，不接受重複作品 id，在 DB／revision 查詢前拒絕超限。所有作品鎖用一筆依數字 id 排序的 SQL 取得。大型清單每批後重讀權威資料、重新計算剩餘差異，不得沿用舊計算結果搭配新 revision、略過衝突檢查或 force。last_known_status 不存於 TV state，不可單獨觸發回寫。
- TV state 在取得作品鎖、重新確認清單歸屬後，整批讀取現有狀態，再依作品 id 分組處理。保留個別作品的舊欄位相容、重複資料清理與已讀 generation 保護；不得為減少查詢而略過授權或混用其他作品的狀態。

顯示用已播出分母與持久化總數的差異見 [TMDB 與集數資料](tmdb.md#集數計算與補查)。

## 帳號隔離與讀取失敗

- AuthProvider 以 userId 作私有畫面的生命週期邊界；同帳號重驗不重掛。帳號切換時重設私有資料、編輯狀態與刪除確認。私有畫面用 useAccountFetch 中止舊請求與後續寫入；刪帳端點核對所帶的 x-watch-account-id，不接受另一個帳號的確認。
- `DetailModal` 內可接受短 TTL 快取以降低重複請求，但需避免跨使用者共用快取；涉及好友、分享、帳號資料時，快取至少要以 `session.user.id` 區分。
- 頁首成功登出統一使用 clearWatchUserCache 清理該帳號各版本的清單快取，保留其他帳號與公開資料；「即將播出」在元件卸載或工作被取代時必須使舊工作失效，避免登出後遲到的結果重建私人快照。
- 清單 section-data 必須完整讀取觀看紀錄與 TV state 才能回 200；任一失敗回 503，不得把失敗包成空紀錄。前端保留上次成功資料、顯示同步錯誤與重試，禁止依失敗資料回寫 TV state。桌面與前端清單快取採 v2 完整性標記／key，一次回查舊格式；不改使用者主資料，也不清除公開 TMDB 快取。
- 電影詳情觀看紀錄讀取失敗時保留同帳號、同作品最近成功的資料，顯示錯誤與手動重試；沒有成功資料時不得顯示「尚未建立觀看紀錄」或零筆。切換作品時不能沿用上一部的紀錄，不得為此新增常駐輪詢。
- 播出／上映判斷一律沿用台北日期；使用者自行記錄的觀看日期與其儲存格式不變。行事曆與好友頁在斷線時保留同範圍的成功資料、解除 loading 並提供重試；不得把查詢失敗當成空清單。

## 好友邀請限流

- 好友送出邀請以登入 userId 限制每 60 秒 10 次，失敗／無效請求也計數，未登入不查 Redis。Redis 原子計數；故障時使用各 instance 的有界本機計數（最多 5000 活躍桶，滿時拒絕新桶且不淘汰現有桶）。不得為限流新增 Neon 寫入或背景輪詢。

## Migration

- 修改核心資料規則、交易或 migration 時，先簡述受影響資料與驗證方式；符合既有規則且已獲授權的本機修正可繼續執行。新增 auth／session／cache／state 結構也需依實際影響判斷，不能只因名稱而略過資料檢查。
- 可在任務範圍內修改 schema、產生 migration 檔並檢查 SQL；可能影響舊資料時，說明轉換範圍、風險及復原方式。
- 產生／提交 migration 檔與套用資料庫是不同操作。只有已明確授權的目標環境才能執行 migration 或 `db:push`；未取得套用授權時，仍應完成可供審查的檔案與本機驗證。
- 需要新的產品取捨時，依 [協作指引](../../AGENTS.md#執行範圍與完成條件) 處理。
