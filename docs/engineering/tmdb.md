# TMDB、集數資料與公開快取

修改 TMDB 端點、語言 fallback、集數計算、快取或限流時，依影響查閱對應章節。卡片呈現規則見 [清單與詳情](watchlist-ui.md)，桌面身份隔離見 [桌面版](desktop.md)。

## 公開內容與官方文件

- 搜尋、首頁推薦、TMDB 公開內容目前允許匿名查看，不要直接改成必須登入。

按變更類型查官方最新文件，不使用 repository 的離線副本作為外部規範依據：

| 變更類型 | 查閱文件 |
| --- | --- |
| API 端點或參數 | [TMDB API 文件](https://developer.themoviedb.org/)，再定位實際端點 |
| 限流、重試或併發 | [Rate Limiting](https://developer.themoviedb.org/docs/rate-limiting) |
| 保存期限、來源標示或授權 | [使用條款](https://www.themoviedb.org/terms-of-use)、[API 條款](https://www.themoviedb.org/api-terms-of-use)、[FAQ](https://developer.themoviedb.org/docs/faq) 的相關部分 |

遵守適用授權與既有快取策略，保留 TMDB 來源標示。API key 僅供 server 使用，不寫死於程式或放入安裝檔。純排版／文案變更若未涉及 API 行為或上述規範，不需為此重讀全部文件。

## 保存上限

- TMDB 公開資料與可能混有 TMDB 內容的桌面快取不得超過 6 個月。
- `watchlist_tv_states` 內的 TMDB 衍生欄位同樣不得保留超過 180 天；期限只能依 `tmdb_metadata_fetched_at`（既有資料 fallback `created_at`）計算，觀看、已讀、一般 row 更新不得延長。每日 cleanup 需清除 stale 集名、播出日期、集數快照與提醒 generation，但保留使用者觀看進度及首播已讀語意，避免舊提醒重新出現。
- 含 TMDB 內容的瀏覽器 section snapshot 必須保存固定 `tmdbExpiresAt`；一般畫面或使用者狀態更新只能更新 `storedAt`，不得滑動延長 180 天期限。舊 snapshot 以原 `storedAt + 180 天` 相容。

## 作品標題與語言

- 作品標題與觀看紀錄必須是**兩個獨立的快取生命週期**，不可再把標題烤進資料回應裡。觀看紀錄由 revision 判定（沒變就一直用本機），標題走 `/api/media/titles`、以 `movie:123` / `tv:456` 為單位共用，桌面端存在 `media-titles/`（`api-cache.mjs` 的 `handleMediaTitles`）：命中就只把本機沒有或已到期的 id 送上網路，所以同一部作品跨月份、跨清單不會重複下載。端點必須用 `getCalendarMetadataBatch` 一次批次讀 Neon，不能退回逐 id 的快取查詢；回應的 `refresh_after_ms` 是伺服器 backoff 的剩餘時間，網站與桌面端都必須沿用，不能用較長的本機固定 TTL 遮蔽繁中標題的重查時機。這是為了讓 TMDB 補上的繁中標題能及時反映——舊做法把標題包在 `month-data` 的整包快取裡，標題要等整包過期才會更新，那是**正確性**問題不是新鮮度問題，不可用「縮短整包 TTL」來替代。`month-data` 目前仍回傳標題作為 fallback（階段 2 會移除）；前端 `resolveCardLabel` 在標題未到時只顯示集數，不顯示 `TMDB <id>`。
- TMDB 文字欄位語言優先序一律是繁體中文、原文；不要抓簡體中文作為 fallback。英文 `en-US` 只能用來補年份、海報、runtime、狀態等非文字 metadata，不能拿來覆蓋片名、簡介、集名等文字。`calendar-meta` 預設可長快取；疑似缺繁中名稱 / 只拿到原文時需用漸進 backoff 重查，從 24 小時開始逐步延長、最多回到 150 天。detail refresh 成功時需同步覆寫；使用者打開詳情或 TV state 有集數 / 下一集 / 進度等語意變更時，也可只針對仍缺繁中名稱且已冷卻到期的作品順手重查。

## 伺服器快取與 Redis

- server 端 TMDB `season` / `detail` 快取採播出日感知 TTL（`src/server/tmdb/cacheTtl.ts`）：season 有未播出集數時，快取活到下一集播出日的台北凌晨（clamp 1 小時 ~ 7 天）；全部播出且最後一集超過 30 天、TV 已完結 / 已取消、電影上映超過一年，放寬到 7 天；其餘維持 24 小時。任何一集缺播出日視為資料不完整，維持 24 小時。播出日語意以台北時間為準，與推薦快取的每日刷新一致。
- `readTmdbCache` / `writeTmdbCache`（`src/server/tmdb/cache.ts`）在有 `REDIS_URL` 時優先走 Redis（key 前綴 `tmdb-cache:`，與 `watch:updates:` / `watch:revision-state:` 隔開避免撞名），Neon 仍是 source of truth；Redis miss / 失敗一律 fallback Neon，回填用 NX 避免蓋掉併發寫入的新資料，寫入時的鏡像寫 Redis 不 await（不拖慢已在等 TMDB fetch 的回應）。共用的 read-through 邏輯抽在 `src/server/realtime/redis.ts` 的 `readThroughRedis`；`readLatestWatchUpdate`（呼叫形狀略有不同）與 revision 簽章快取（Redis 啟用時完全不 fallback DB cache，語意不同）目前仍各自手寫，未套用同一個 helper。不是「TMDB 快取」、只是借用 `tmdb_cache` 表存 key-value 的呼叫端（例如 cron 執行摘要）應傳 `{ skipRedisMirror: true }`，避免污染 `tmdb-cache:` 命名空間、也省下沒人會透過 Redis 讀取的白工寫入。`readManyTmdbCache` / `readManyTmdbCacheIncludingExpired`（calendarMetadata / watchlistCardMetadata 用）刻意不套 Redis：後者需要「回傳已過期但仍可用」的 stale-while-revalidate 語意，Neon 靠 grace period 保留過期列才辦得到，Redis 原生 TTL 到期會整筆消失，無法比照；這兩支流量遠低於 detail/season 熱路徑，先維持 Neon-only。

## 前端完整資料期限

- `resolveSeasonEpisodesClientTtlMs` 控制 `tv:<id>:season:<n>` 的完整集數清單：已完結／已取消的舊季度最多七天；近期播畢、含未來或缺少日期的季度仍最多六小時，播出中或狀態未知也用六小時。桌面 renderer 是常駐 session，不能讓播出中作品沿用長快取而卡住新集數。
- TV 作品前端詳情最多六小時；桌面已完結詳情最多七天，讀取舊 30／90 天快取也需套用此上限。
- 這些期限是回查週期，服務端仍有播出日感知 TTL；不能保證 TMDB 新增資料在各層立即可見，離線／上游失敗也不能標為最新。

## 集數計算與補查

- 卡片、詳情視窗及季數選單使用 `episodeTotals.ts` 共用已播出計算。全部已知非特別篇季（集數為 null／0 的預建空殼季除外）的集數清單載入且數量一致時，逐集按播出日期與台北日期計算：有效日期已到才計入，未定日期（null／未提供）或未來日期不計入，不因預建下一季的未定日期而讓整部作品待確認；缺季、無效日期、數量不符或已看數超過已播出數時，不使用已知總數替代。不得把未載入季當成零、只憑季數推定已播畢或截斷使用者觀看數；數量標籤、提示與輔助閱讀文字須一致。清單只為已有觀看紀錄的作品補查，詳情僅在已登入、開啟且未閒置／編輯時補查；每部逐季、共用四個請求名額，失敗交給既有檢查週期。
- 清單、詳情與即將播出共用 `tmdbDetailCache` 的作品／季資料與進行中請求；資料寫入通知只觸發本機重算，不能觸發整個清單重新查詢。共用層只放公開作品資料，不放使用者觀看紀錄。
- `useEpisodeDataClock` 活動期間每分鐘只更新本機時鐘；六小時時段變更才喚起既有掃描。背景、閒置或詳情正在編輯集數／日期時暫停；恢復實際操作後檢查，單純 focus 不算操作。已知播出日期跨日可直接重算，不必為日期變化強制刷新 TMDB。
- `last_total_aired` 與詳情寫入 TV state 的總數仍保持既有「已知總數」語意，不能直接改寫成已播出數，以免影響首頁、漏集判斷或既有資料。新分母僅為顯示層派生值。詳情恢復活動或定期檢查時須採用其他畫面已更新的共用詳情，內容未變時保留原參考，避免觸發觀看紀錄重查。
- 已播出分母使用 `episodeDateCache.ts` 的獨立公開日期摘要（不含使用者紀錄、集名或圖片），在網站與桌面 renderer 的 localStorage 保存；最多 1000 筆／100 萬字元，過期或容量超限會淘汰。季摘要最多六小時；日期全部有效且最後一集播出超過 30 天的季度可保留 30 天，其餘最多六小時。已載入季度的未定日期以 null 保存，同樣六小時到期，不因缺日期反覆補查；缺集、重複編號或格式錯誤不可保存為有效摘要。只在共用 loader 寫入回應時設定期限，一般讀取、同步與跨日重算不得續期。取得較新回應時覆蓋；目前季摘要集數不符時禁止沿用舊分母。這是日期計數摘要的期限，不延長完整集名清單的快取。
- 日期摘要的補查沿用 `/api/tmdb/season`、既有伺服器 Redis／Neon 共用快取及 TMDB 限流；不新增資料庫欄位、背景排程或使用者資料寫入。原下一集掃描先完成，補查不能因快取版本更新而整輪重跑；隱藏頁面、開啟詳情或離開元件後停止繼續排新的清單補查。過期資料在下一次實際使用／既有檢查時更新，仍可能經過伺服器與桌面 HTTP 快取的回查期限，不能宣稱 TMDB 修正會即時顯示。
- 清單的上次已播出分母存於既有公開日期摘要，來源快取到期後最多保留七天；只存作品 id／已播出數／日期與固定期限，不存已看數或帳號資料。一般讀取不得續期，最新完整資料優先；目前已看數超過分母時不截斷、不拿舊值掩蓋矛盾。詳情仍要求當前完整資料；卡片在更新／失敗期間可保留已確認數字並清楚標示待更新，保留漏集警告。
- 季摘要與逐集清單數量不符時，前端可沿用 `season?refresh=1&repair=1` 只補查該季；共用四個請求名額與正常季快取，原本下一集掃描不因補查重跑。同季前端六小時冷卻（跨重開保存、最多 1000 筆），失敗也計入且不反覆自動重試。
- 季一致性補查必須登入；伺服器以自身快取的作品季摘要驗證，不信任 client 提供的預期集數。已一致或無可靠季摘要時回既有資料且不延長期限；確有不一致才使用 Redis 原子六小時冷卻，同季跨使用者共用。Redis 不可用時採每程序最多 5000 筆的冷卻，容量滿不淘汰活躍桶、不新增 Neon 冷卻表；TMDB 429 仍遵守既有冷卻。真正取得新回應才更新正常季快取，且寫入在同 key 的 in-flight 合併內完成。

## 併發、冷卻與推薦

- 瀏覽器端 TMDB detail / season loader 共用最多 4 個「真正執行中」的請求名額；快取命中與同 key 的 in-flight 共用不另占名額。Watchlist 的集數狀態掃描與「即將播出」屬 background，使用者主動開啟 DetailModal 的 detail / season 載入屬 foreground；名額釋放時 foreground 優先，若 foreground 正在等待同 key 的 background 工作，應升級原工作而不是重複發請求。這是刻意保留互動速度與背景吞吐量的取捨，不要再用調整外層 `runWithConcurrency` 數字猜實際請求乘積。
- TMDB 429 必須遵守 Retry-After；作品與季端點共用程序內冷卻，前端也共用冷卻以阻止原有立即重試再次送出。沿用上述四個請求名額、來源標示、server-only API key 與保存上限；官方規範見本文件的文件索引，不把目前上限當成永久配額。
- TMDB 推薦 upstream 任一分頁失敗時不得寫入正常推薦快取；詳情中文標題補查沿用 calendar metadata 的退避期限。
- 三種 TMDB 推薦只在快取 miss 時檢查共用冷卻；429 尊重 Retry-After，缺值預設 60 秒，一般 upstream 故障預設 15 秒。Redis 以原子操作只延長期限，每次 upstream 抓取前檢查共享期限，並合併同時發生的讀取，僅由請求觸發；Redis 不可用時保留本機冷卻，不新增 Neon 查詢或背景輪詢。
