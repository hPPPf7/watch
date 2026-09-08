# 專案協作指引

## 基本原則

- 專案介面文字以中文為主，避免混入英文提示。
- 修改功能時，優先保留既有 UI 文案與使用流程。
- 任何會影響部署或資料一致性的改動，需先本機驗證。
- 產品邏輯優先。若 review 指出的「問題」會改變既有產品定義，需先對齊，不直接修改。
- 資料正確性優先於短暫可用性，尤其要避免刪帳復活、寫到錯帳號、auth fallback 造出另一個 user id。
- 只要有產品邏輯、資料規則、重要取捨或協作流程上的變更，修改程式時要順便更新 `AGENT.md`，避免規則只留在聊天紀錄裡。

---

## 部署架構

- **正式網站跑在 Railway**，不是 Vercel。`package.json` 的 start script、`desktop/main.mjs` 預設載入的網域都是指向 Railway 上的正式部署。
- **`vercel.json` 是刻意保留的，不是殘留死碼**：專案另外有一個「隱形」的 Vercel 部署，沒有人實際瀏覽它，唯一用途是借用 Vercel 免費方案內建的 Cron 功能，每天定時打 `/api/cron/tmdb-cache-cleanup` 清理過期 TMDB 快取。這個 Vercel 部署的 `DATABASE_URL` / `AUTH_DATABASE_URL` 指向跟 Railway 正式站**同一個 Neon 資料庫**，所以清理動作對正式資料有效。
  - 如果之後要調整清理排程，改 `vercel.json` 裡的 `crons.schedule` 即可，不需要在 Railway 另外設定。
  - cron 每次執行完會把摘要（時間、清理筆數、通知使用者數）寫回共用 Neon 的 `tmdb_cache`（key：`watch:cron:tmdb-cache-cleanup:last-run`）；本機執行 `npm run cron:status` 即可確認 cron 是否正常運作（距上次執行超過 26 小時會警告），不需要登入 Vercel。這是純維運工具，網站上沒有任何入口，一般使用者看不到。
  - **不要在 Railway 的正式網站服務上開啟 Railway 自己的「Cron Schedule」功能**：Railway 的 Cron Schedule 會把服務從「一直開著」改成「只在排程時間點啟動、跑完 Start Command 就關掉」，如果套用在正式網站服務上會等於把網站關掉。若未來想把排程搬離 Vercel，需要另開一個獨立的 Railway 服務專門執行清理指令並排程，不能加在網站本體服務上。
  - `@vercel/analytics`、`@vercel/speed-insights` 這兩個套件已於 2026-07 移除（因為 Vercel 那份部署沒人瀏覽，分析功能沒有意義），移除後不影響 cron 排程本身。

---

## 產品規則

### 觀看紀錄與清單

- `DetailModal` 的觀看紀錄好友選擇器在桌面版使用 2 個直向欄位、每欄最多顯示 4 位的網格，超出 8 位後維持容器內垂直捲動；行動版同樣每列顯示 2 位並由外層內容捲動。好友名稱過長時允許截斷，但需保留完整名稱提示。

- `想看` 是清單中的未看狀態，不是可隨意丟棄的暫存 watchlist。
- 只要已有觀看紀錄，就不能直接從清單移除。
- 影集 / 動畫的 shared history 與自己的 history 視為同等進度。
- 電影同一天同一部作品只能有一筆觀看紀錄。
- 影集 / 動畫同一季同一集只能有一筆觀看紀錄，不論是自己新增或同步進來都一樣。
- `watch_history.watched_at` 目前代表觀看日期，不是任意時間點；寫入時應固定為 UTC 午夜，避免月曆日期語意漂移。
- TV / Anime 詳細資料彈窗內，自己的紀錄與同步給自己的紀錄視為同一份進度。
- 電影觀看紀錄的 `season_number / episode_number` 必須固定為 `0 / 0`。
- `originalDate` 只要有帶，就必須是有效日期；不能把壞字串默默當成 `null`。
- 編輯觀看紀錄時，只要目標日期已存在同作品 / 同季同集紀錄，就直接擋下，不做自動合併。
- 編輯或刪除觀看紀錄的 revision 衝突只比較清單項目、觀看紀錄與傳入／傳出分享關係；背景集數掃描寫入的 `watchlist_tv_states` 不得讓同一裝置誤判成觀看紀錄衝突。清單同步使用的完整 revision 仍需包含 TV state。
- 若好友在同一天同作品已有紀錄，這次同步整筆不成立，不是略過該好友繼續存。

### 日曆

- 月曆頁的月份、月份切換、紀錄篩選、檢視模式與媒體圖例在桌面寬度下需維持同一列；窄視窗可換行，不能為了硬塞單列而產生水平溢出。整組控制項作為 `SiteHeader` 下方的第二層 sticky 工具列，頁面內容捲動時不可跟著離開畫面；sticky 外框需以 `top-16` 貼齊 Header 下緣，且 z-index 必須低於 Header，不能與導覽列競爭同一堆疊層。透過工具列本身的緊湊上內距分隔兩列內容，避免留下會透出滾動內容的空隙。

- sticky 工具列吸頂**依賴 `globals.css` 的 `html, body { overflow-y: visible }`**：這行是承重設定，不能當成多餘樣式刪掉。若 `overflow-y` 變成 `auto`，CSS 會連帶把同層的 `overflow-x: clip` 算成 `hidden`，body 就變成捲動容器、實際捲動落在 `html` 上，凍結列會跟著 body 一起被捲走而失效。同理，工具列與內容之間不要再靠 `space-y` 之類的外距製造空隙（會讓吸頂時上緣透出捲動內容）。

- 桌機月曆格為無外框、滿版（`-mx-8`）呈現：上緣貼齊 sticky 工具列、下緣貼齊固定頁尾。下緣是用 `main` 的 `pb-[33px]`（= `SiteFooter` 目前高度）貼齊,屬**零裕度**設定；若日後 `SiteFooter` 高度改變，需同步調整此值,否則最後一列會被頁尾蓋住或露出縫隙。

- 月曆格內的卡片走 `src/lib/calendarLanes.ts` 的車道排版：連續日期看同一部（同 `groupKey` = owner + tmdb + 參與者組合）會接成一條跨格 bar。連續判斷是**跨整個月曆格**的，車道分配才是以**單週**為單位——週六到週日只是斷行、不是兩段紀錄，斷行處兩端維持方角並各自貼齊格線邊緣。演算法完全不看月份，所以補格的鄰月日期與當月首末日之間本來就會相連。可見格線的最外緣（約 14% 的月份 1 號剛好是週日 / 月末剛好是週六，完全沒有補格）則靠探針判斷：`scope: "grid"` 時查詢邊界各放寬一天，回傳在 `edge_rows`，前端還原成 `groupKey` 後透過 `buildLaneLayout` 的第三參數決定首末格要不要收邊。這兩天**不得**進 `metadataByKey`（TMDB 標題查詢是這支 API 最貴的部分，探針只需要 id 不需要標題），也**不得**混進 `rows`（會被畫成卡片）。這是「不查前端沒顯示的資料」的刻意例外：邊界資料有被用到，只是用於決定可見 bar 的收邊形狀而非自己成為一張卡片。四個不可破壞的前提：(1) 空車道**必須**渲染等高佔位，少一個相鄰格的 bar 就會錯位接不起來；(2) 車道高度固定（`h-9`），標題過長只能截斷、不能讓卡片自己長高，否則同一段在各格高度不同；(3) 列中間的接合靠右邊那天多吃 1px 往左蓋掉日格分隔線，方向不能反過來——日格是 `relative`、依 DOM 順序疊，左邊那天往右畫會被右邊那天的背景蓋掉；列首（`col === 0`）不能多吃這 1px，否則會超出滿版格線左緣。(4) bar 的水平幾何由 `CELL_PADDING` / `BAR_EDGE_GAP` / `BAR_TEXT_GAP` 推導，內距要補回端點位移量，讓相連格與獨立格的文字起點一致；日界線只能用 inset `box-shadow`，改回 `border` 會佔掉 1px 版面而讓文字錯開。
- 日曆的 `watched_at`、月份邊界、跳月判斷一律用 `date-only` 語意處理，不做本地時區換算。
- 月曆 API 若需要回傳 `watched_at` / edge date，應直接回 `date-only` 字串；不要先轉成 JS `Date` 再用 `toISOString()` 截日期。
- 月曆資料範圍需依 view mode 區分：格狀月曆用可見 `grid` 範圍，列表與手機版只用當月 `month` 範圍，不混入相鄰月份內容。
- `/api/calendar/month-data` 若同時服務月曆格與列表，需明確區分 `scope`，避免前端沒顯示的資料也被多查回來。
- 月曆 `selectedFriendId` 不只要是 UUID，還必須是目前 viewer 可見的好友；不能繞過前端 picker 查任意人。
- 月曆「所有紀錄」模式可以保留該筆共同觀看的完整資料關係，但 API 回前端的 participant 只能帶 viewer 可見好友。
- 月曆 UI 顯示 participant 時不顯示自己，只顯示目前好友；若之後才成為好友，既有紀錄可自動補顯示。

### 清單狀態與提醒

- `已看 X / Y` 只有在全部看完時，文字才變綠色；其他樣式不動。
- 「已看完目前已播出集數」在首頁 badge 也視為 `completed`，不能和清單文字打架。
- TV / Anime 若有 `有新集數播出` 提醒，應排在 `正在觀看` 清單最前面。
- 新集數提醒的「今天／幾天前」以 `next_episode_air_date` 的實際播出日計算，不以系統何時發現更新的 `alert_started_at` 計算；舊資料缺少播出日時才退回發現時間。首播提醒則以作品 `release_date` 計算。
- TV / Anime 應維持原有集數狀態掃描與快取行為，只在清單標題旁補上精簡提示：掃描進行中顯示「正在確認更新…」、有未讀的新集數 / 首播提醒時顯示發現更新的作品數，掃描成功且沒有更新時顯示「已完成更新檢查」。提示不得額外觸發定時重查、恢復補查或略過快取，也不要混入「已置頂」等實作細節。
- 清單內若同一天有多筆已看紀錄，排序需用最新那筆觀看紀錄的建立時間做 tie-break；後新增的排前面。
- TV / Anime 若尚未播出且使用者還沒有任何觀看紀錄，清單卡片文字顯示「尚未播出」，不要寫成「尚未觀看任何集數」。
- `watchlist_tv_states` 的提醒欄位屬於可持久化的 state / cache，不只是前端記憶體狀態。
- TV / Anime 作品完全移出清單且沒有其他分區項目時，需一併清除該作品的 `watchlist_tv_states`，避免重新加入後沿用舊提醒。
- TV / Anime 若加入清單時尚未播出，首集播出後顯示「已開始播出」並置頂；新集數與首播提醒都在集數清單成功載入後視為已讀並清除，未開啟前持續顯示。
- 新集數與首播提醒只出現在清單，因此只有使用者從清單提醒入口開啟作品，且集數清單成功載入後才標記已讀；從首頁、搜尋、Header 或其他詳情入口查看集數時，不清除清單提醒。
- `season lookup` 失敗時先重試一次；若仍失敗，沿用上一輪狀態，並顯示「暫時無法確認最新集數」。
- 「即將播出」分頁一部作品可能同時來自兩季：目前正在播、還有未播出集數的那一季，加上下一季已經有集數資料但還沒開播的情況（`src/lib/upcomingEpisodeSeasons.ts` 的 `getUpcomingCandidateSeasonNumbers`）。忽略 TMDB 續訂後先建的空殼季（`episode_count` 是 `null`/`0`），且最多只查最新兩個已知季——更早的季一定早就播畢，不會有未來的 `air_date`，不設上限會讓長壽劇退化回每次查全部季。
- 自動刷新詳情彈窗內容時，要保留 history 區塊原本的捲動位置；只限自動刷新，不影響開啟時預設捲動，也不要動畫。
- 電影日期選擇器與 TV / Anime 一樣，使用者正在開啟日期選擇器時要暫停自動刷新，避免選擇器被刷新關掉。

### 搜尋與公開內容

- 搜尋、首頁推薦、TMDB 公開內容目前允許匿名查看，不要直接改成必須登入。
- 正式網站實際跑在 Railway（見下方「部署架構」），不是 Vercel／Cloudflare，因此 `x-vercel-ip-address` / `cf-connecting-ip` 都不會出現。匿名 TMDB proxy 限流改為信任 Railway 邊緣代理蓋寫過的 `x-forwarded-for`（取第一段），已在 Railway 該服務的環境變數加上 `TMDB_RATE_LIMIT_TRUST_PROXY_HEADERS=1` 啟用（2026-07）。若之後更換代管平台或改走其他 CDN，需重新確認新平台的 forwarded header 是否同樣可信，再決定要不要沿用這個開關。

### 桌面版

- 桌面版是 Electron 外殼，預設載入 `https://watch.han-burger.com`；使用者帳號與資料來源仍是正式網站同一套 Auth / Neon，不另建本機帳號。
- 桌面端遠端網站內容必須跑在 isolated / sandboxed BrowserView；不得為了快取在遠端 renderer 內關閉 `contextIsolation` 或 `sandbox`。
- 桌面端可用 Electron / Chromium 一般 HTTP 快取（例如圖片與靜態資源），以及 main-process / session 層的明確 API response cache；使用者 API response cache 不可用 renderer monkey-patch 實作。
- 桌面 user-data API response cache 必須以 `user:<userId>` 分桶，命中前需用輕量 revision / freshness 檢查確認資料仍有效，登出、切帳號或 watchlist/history 寫入後需清除對應使用者快取，避免多帳號資料混用。
- 作品標題與觀看紀錄必須是**兩個獨立的快取生命週期**，不可再把標題烤進資料回應裡。觀看紀錄由 revision 判定（沒變就一直用本機），標題走 `/api/media/titles`、以 `movie:123` / `tv:456` 為單位共用，桌面端存在 `media-titles/`（`api-cache.mjs` 的 `handleMediaTitles`）：命中就只把本機沒有或已到期的 id 送上網路，所以同一部作品跨月份、跨清單不會重複下載。端點必須用 `getCalendarMetadataBatch` 一次批次讀 Neon，不能退回逐 id 的快取查詢；回應的 `refresh_after_ms` 是伺服器 backoff 的剩餘時間，網站與桌面端都必須沿用，不能用較長的本機固定 TTL 遮蔽繁中標題的重查時機。這是為了讓 TMDB 補上的繁中標題能及時反映——舊做法把標題包在 `month-data` 的整包快取裡，標題要等整包過期才會更新，那是**正確性**問題不是新鮮度問題，不可用「縮短整包 TTL」來替代。`month-data` 目前仍回傳標題作為 fallback（階段 2 會移除）；前端 `resolveCardLabel` 在標題未到時只顯示集數，不顯示 `TMDB <id>`。
- 桌面端不能離線寫入觀看紀錄、清單、好友或帳號資料。
- 正式打包的桌面端啟動時必須先完成網路與更新檢查；無網路、更新檢查失敗或有新版本尚未安裝時，不得載入正式網站內容。
- 本機測試可用 `WATCH_DESKTOP_SKIP_UPDATE_CHECK=1` 暫時略過更新閘門，但不得用於正式發行。
- TMDB 公開資料與可能混有 TMDB 內容的桌面快取不得超過 6 個月。
- `watchlist_tv_states` 內的 TMDB 衍生欄位同樣不得保留超過 180 天；期限只能依 `tmdb_metadata_fetched_at`（既有資料 fallback `created_at`）計算，觀看、已讀、一般 row 更新不得延長。每日 cleanup 需清除 stale 集名、播出日期、集數快照與提醒 generation，但保留使用者觀看進度及首播已讀語意，避免舊提醒重新出現。
- 含 TMDB 內容的瀏覽器 section snapshot 必須保存固定 `tmdbExpiresAt`；一般畫面或使用者狀態更新只能更新 `storedAt`，不得滑動延長 180 天期限。舊 snapshot 以原 `storedAt + 180 天` 相容。
- server 端 TMDB `season` / `detail` 快取採播出日感知 TTL（`src/server/tmdb/cacheTtl.ts`）：season 有未播出集數時，快取活到下一集播出日的台北凌晨（clamp 1 小時 ~ 7 天）；全部播出且最後一集超過 30 天、TV 已完結 / 已取消、電影上映超過一年，放寬到 7 天；其餘維持 24 小時。任何一集缺播出日視為資料不完整，維持 24 小時。播出日語意以台北時間為準，與推薦快取的每日刷新一致。
- TMDB 文字欄位語言優先序一律是繁體中文、原文；不要抓簡體中文作為 fallback。英文 `en-US` 只能用來補年份、海報、runtime、狀態等非文字 metadata，不能拿來覆蓋片名、簡介、集名等文字。`calendar-meta` 預設可長快取；疑似缺繁中名稱 / 只拿到原文時需用漸進 backoff 重查，從 24 小時開始逐步延長、最多回到 150 天。detail refresh 成功時需同步覆寫；使用者打開詳情或 TV state 有集數 / 下一集 / 進度等語意變更時，也可只針對仍缺繁中名稱且已冷卻到期的作品順手重查。
- 打包桌面版時不得把 `TMDB_API_KEY`、`DATABASE_URL`、`AUTH_DATABASE_URL` 或其他 server secret 放進安裝檔。

---

## 資料與 Migration 原則

- 只要會碰到既有核心資料：`觀看紀錄 / 清單 / 好友 / 分享`，修改前需先說明影響。
- 若只是新增 `auth / session / cache / state` 類結構，通常可以直接做。
- migration 只要可能改到舊資料，需先講清楚風險與影響。
- code commit 與 DB 套用是兩件事；除非明確同意，不自動套 migration。
- 刪整個帳號屬於跨 project 清資料，不能只清單一功能模組。
- `identity mapping` 失敗時採 fail-closed，寧可登入失敗，也不要 fallback 到另一個 user id。
- 真 bug / 一致性 / 安全性問題可以直接修；涉及設計取捨的問題，要先對齊再修。

### 已接受的 FK / 清資料方向

- `watch_history` 刪除後，掛在其上的 `watch_history_shares` 不保留殘骸。
- owner 刪帳後，由他建立的分享紀錄與主觀看紀錄都應清掉。
- target 刪帳後，只移除該 target 的 share 關係，owner 主紀錄保留。
- 好友關係與好友邀請只要任一方刪帳，應一併消失。
- `auth_user_map` 指向不存在 user 屬不可接受狀態；由於 `auth_user_map` 與使用者資料現分屬 `AUTH_DATABASE_URL` / `DATABASE_URL` 兩個獨立資料庫，無法用原生 FK 約束，改由應用層 fail-closed 阻擋（見 `src/auth.ts` identity mapping 邏輯）。

---

## Realtime / SSE / 限流取捨

- 目前 watchlist SSE 採 shared poller，優先降低同一個 server instance 內的重複 DB 輪詢。
- 現階段接受輪詢式即時更新；若未來流量成長、DB 壓力明顯上升，再評估 Redis Pub/Sub 或其他 realtime 基礎設施。
- 若已提供 `REDIS_URL`，watchlist SSE 應優先走 Redis Pub/Sub；未提供時維持 shared poller fallback，避免部署環境未補齊就中斷更新。
- 若已提供 `REDIS_URL`，好友通知也應優先走 Redis Pub/Sub；未提供時維持低頻 polling fallback。
- 短命 key（revision 簽章快取、`watch:updates:<userId>` latest record）在有 `REDIS_URL` 時優先走 Redis，不再借用 Neon 的 `tmdb_cache` 表；Redis 讀取失敗一律視為 cache miss 並 fallback 回 DB 路徑，不能因 Redis 掛掉而中斷功能。latest watch update 的 DB 寫入仍是 source of truth，Redis 只是讀取熱路徑的快取；從 DB 回填 Redis 時必須用 NX（ifAbsent），避免舊資料蓋掉併發寫入的新紀錄。
- `readTmdbCache` / `writeTmdbCache`（`src/server/tmdb/cache.ts`）在有 `REDIS_URL` 時優先走 Redis（key 前綴 `tmdb-cache:`，與 `watch:updates:` / `watch:revision-state:` 隔開避免撞名），Neon 仍是 source of truth；Redis miss / 失敗一律 fallback Neon，回填用 NX 避免蓋掉併發寫入的新資料，寫入時的鏡像寫 Redis 不 await（不拖慢已在等 TMDB fetch 的回應）。共用的 read-through 邏輯抽在 `src/server/realtime/redis.ts` 的 `readThroughRedis`；`readLatestWatchUpdate`（呼叫形狀略有不同）與 revision 簽章快取（Redis 啟用時完全不 fallback DB cache，語意不同）目前仍各自手寫，未套用同一個 helper。不是「TMDB 快取」、只是借用 `tmdb_cache` 表存 key-value 的呼叫端（例如 cron 執行摘要）應傳 `{ skipRedisMirror: true }`，避免污染 `tmdb-cache:` 命名空間、也省下沒人會透過 Redis 讀取的白工寫入。`readManyTmdbCache` / `readManyTmdbCacheIncludingExpired`（calendarMetadata / watchlistCardMetadata 用）刻意不套 Redis：後者需要「回傳已過期但仍可用」的 stale-while-revalidate 語意，Neon 靠 grace period 保留過期列才辦得到，Redis 原生 TTL 到期會整筆消失，無法比照；這兩支流量遠低於 detail/season 熱路徑，先維持 Neon-only。
- revision 簽章快取的 TTL（目前 5 分鐘）是「漏通知時的自我修復上限」，不是即時性來源：即時性由「資料變更必發 watch update 事件 → 新鮮度檢查立刻作廢快取」保證。因此任何會改到簽章涵蓋欄位（清單、觀看紀錄、分享、tv_states）的寫入路徑都必須 publish watch update，包含 cron / 維運腳本這類不經一般 API 的路徑；做不到的路徑等於接受最長一個 TTL 的跨裝置延遲與衝突檢查鈍化。調大 TTL 前需先盤點所有寫入路徑都有 publish。
- `REDIS_URL` 目前是 Vercel 與 Railway **共用同一顆 Upstash Redis**（透過 Vercel Marketplace 的 Upstash 整合建立，帳號不在 upstash.io 走一般註冊流程，容易忘記它的存在），與 `DATABASE_URL` / `AUTH_DATABASE_URL` 共用同一個 Neon 資料庫是同樣的架構模式（2026-07 確認，Railway log 已驗證 `transport mode: redis`）。這代表 Vercel 上的 cron 清理補發的 watch update 通知，理論上可以透過同一顆 Redis 的 pub/sub 即時傳給 Railway 正式站上正在連線的使用者，不需要等 revision TTL 兜底；若之後任一邊的 `REDIS_URL` 跟另一邊不同步（例如只改了其中一邊），會讓這個即時傳遞失效，只退回各自的 TTL / DB fallback（不會壞掉，只是變慢）。
- Upstash 是依「指令次數」計費／限額的代管服務，不是傳統自建 Redis 常見的「記憶體上限」；評估要不要把更高頻的資料（例如 TMDB 快取）也搬上 Redis 前，需先在 Vercel 後台 Storage 分頁或 Upstash 主控台確認目前方案的指令次數額度與用量，避免撞到額度或產生非預期費用。
- 瀏覽器端 TMDB detail / season loader 共用最多 4 個「真正執行中」的請求名額；快取命中與同 key 的 in-flight 共用不另占名額。Watchlist 的集數狀態掃描與「即將播出」屬 background，使用者主動開啟 DetailModal 的 detail / season 載入屬 foreground；名額釋放時 foreground 優先，若 foreground 正在等待同 key 的 background 工作，應升級原工作而不是重複發請求。這是刻意保留互動速度與背景吞吐量的取捨，不要再用調整外層 `runWithConcurrency` 數字猜實際請求乘積。
- 若某個修正方案雖然更嚴格，但會明顯降低整站可用性，尤其是 `auth / session / rate limit / realtime`，需先說明取捨，不直接套用。
- 若同一段邏輯的 review 一直在同一個產品取捨上來回拉扯，先停下來對齊規則，不要持續 patch。

---

## TMDB 文件

進行 TMDB 相關開發時，請直接查閱官方最新版文件，不使用 repository 內的離線副本，避免條款更新後本機文件過期：

- https://www.themoviedb.org/terms-of-use
- https://www.themoviedb.org/api-terms-of-use
- https://developer.themoviedb.org/docs/rate-limiting

重點：

1. 遵守授權與使用條款
2. 不要把 API key 寫死在程式碼
3. 快取策略需符合專案既有規則

---

## 驗證流程

每次提交前，至少執行：

```bash
npm run lint
```

如有 API / 資料流程調整，請再做手動功能驗證（登入、清單、觀看紀錄、好友流程）。

---

## check:locale 使用方式

此專案提供語系檢查腳本，用來避免：

- 介面文案出現亂碼（例如 `�`、可疑 `???`）
- 已知不該出現的英文 UI 字串混入

### 何時執行

1. 每次調整 UI 文案後
2. 每次 commit 前
3. CI（若之後加入 GitHub Actions）可納入同指令

### 指令

```bash
npm run check:locale
```

---

## 目前現況補充

- `watch` 現在已切到共用 `hanburger-auth`，`watch` 自己保留專案資料庫；修改 auth / profile / account 流程時，需明確區分 `AUTH_DATABASE_URL` 與 `DATABASE_URL`。
- `/account` 目前應理解為 `Watch` 專案資料與個人設定頁，不代表整個 HanBurger 平台帳號中心；整個平台帳號管理應集中到共用帳號管理頁。
- 即時更新目前以 realtime 為主、fallback 為輔：
  - realtime 連上後，不應再保留額外 connected polling。
  - fallback polling 僅作為 SSE / Redis 不可用時的低頻保險，不應作為常態同步主路徑。
- 頁面在背景或使用者長時間未互動時，允許暫停 SSE / polling 以節省資源；恢復互動後再自動恢復同步。這裡的「恢復互動」指使用者真的有動作（`mousedown` / `wheel` / `touchstart` / 於輸入元件按鍵），**不包含**分頁單純變回可見或視窗被 focus——純用鍵盤切回分頁、或視窗被叫到前景卻沒操作，都不該觸發補查 / 重連，避免來回切焦點時的無謂用量。此判斷集中在 `usePageActivityState`，SSE / 集數補查等消費端一律沿用它的 `pageInactive`。
  - `next-auth` 的 `SessionProvider` 仍需在視窗取得焦點時重驗 session，才能及時反映過期、撤銷與跨分頁登入狀態；`AuthProvider` 必須依實際 user 欄位穩定輸出的 `session` 參考，避免相同內容的重驗結果讓月曆 / 好友等相依 effect 白白重跑。
- `DetailModal` 內可接受短 TTL 快取以降低重複請求，但需避免跨使用者共用快取；涉及好友、分享、帳號資料時，快取至少要以 `session.user.id` 區分。
- 前端集數清單（`tv:<id>:season:<n>`）的 in-memory 快取壽命依作品狀態決定（`resolveSeasonEpisodesClientTtlMs`）：已完結 / 已取消用 30 天長快取，播出中或狀態未知一律用 6 小時短快取。桌面版 renderer 是常駐 session，播出中作品若吃長快取會讓新集數偵測與集數清單卡在舊資料。
- 朋友頁、首頁狀態、watchlist 區塊若已提供 realtime，同步修正時應避免再額外補上常駐輪詢，除非明確作為 fallback。

### 結果判讀

1. 顯示「語系檢查通過」：可繼續流程
2. 顯示「語系檢查失敗」：依輸出的檔案路徑逐一修正後重跑

### 建議搭配

```bash
npm run lint
npm run check:locale
```

---

## Commit 規範

提交前請先確認工作區變更：

```bash
git status -sb
```

建議：

1. commit 訊息使用中文
2. 一個 commit 聚焦一件事（避免混入不相關改動）
3. 若同時有重構與功能變更，建議拆成多筆 commit



## 程式碼審查修正的資料一致性約定

- 好友分享授權必須在 transaction 內、取得 canonical friendship advisory lock 後讀取；send/accept/remove 與三個 history 分享寫入路徑共用小寫 UUID 排序後的 pair key。多組鎖須先去重排序，並先於 watchlist item / history target 鎖取得。
- 清單移除必須在 item lock 內重新查詢自己及好友分享的觀看紀錄；建立或分享紀錄須先取得所有相關使用者的 item lock，並在同一交易確保清單項目存在。新增好友清單不得覆寫其既有動畫分類；分類缺值時從 owner 清單推導。
- 影集觀看進度以作品、季、集去重；重看與不同好友分享同一集仍算一集，最新觀看日期另外計算。
- TMDB 推薦 upstream 任一分頁失敗時不得寫入正常推薦快取；詳情中文標題補查沿用 calendar metadata 的退避期限。
- 桌面 API 攔截使用 protocol.handle；非快取回應直接串流，取消串流須明確 abort upstream fetch。刪除本網站或帳戶成功時清除 API、local history 與 title store，刪除前啟動的請求不得重新寫入快取。
- 本機桌面串流 smoke test 可用 Electron 執行 scripts/verify-desktop-stream.mjs；此腳本使用隱藏 sandbox 視窗、本機 HTTP fixture 與獨立暫存 userData，不會載入正式站。

- 三個 history 分享入口先驗證原始 friendIds 陣列最多 100 筆（重複值也計入），格式不符或超量整筆回 400，且不得進入資料庫交易；通過後才正規化與去重，不得截斷名單。
- 三種 TMDB 推薦只在快取 miss 時檢查共用冷卻；429 尊重 Retry-After，缺值預設 60 秒，一般 upstream 故障預設 15 秒。Redis 以原子操作只延長期限，每次 upstream 抓取前檢查共享期限，並合併同時發生的讀取，僅由請求觸發；Redis 不可用時保留本機冷卻，不新增 Neon 查詢或背景輪詢。

- 分享所需的 relationship / item advisory locks 必須先 canonical 排序去重，再各用一筆批次 SQL 依 ordinality 取得；ORDER BY 不得引用鎖函式本身。授權查詢仍須在鎖定完成後以另一個 statement 執行。好友清單補建使用批次 INSERT SELECT / NOT EXISTS / ON CONFLICT DO NOTHING，保留既有分類；owner 先補建，再供好友缺分類時推導。
