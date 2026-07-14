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
- 若好友在同一天同作品已有紀錄，這次同步整筆不成立，不是略過該好友繼續存。

### 日曆

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
- 清單內若同一天有多筆已看紀錄，排序需用最新那筆觀看紀錄的建立時間做 tie-break；後新增的排前面。
- TV / Anime 若尚未播出且使用者還沒有任何觀看紀錄，清單卡片文字顯示「尚未播出」，不要寫成「尚未觀看任何集數」。
- `watchlist_tv_states` 的提醒欄位屬於可持久化的 state / cache，不只是前端記憶體狀態。
- TV / Anime 作品完全移出清單且沒有其他分區項目時，需一併清除該作品的 `watchlist_tv_states`，避免重新加入後沿用舊提醒。
- TV / Anime 若加入清單時尚未播出，首集播出後顯示「已開始播出」並置頂；新集數與首播提醒都在集數清單成功載入後視為已讀並清除，未開啟前持續顯示。
- 新集數與首播提醒只出現在清單，因此只有使用者從清單提醒入口開啟作品，且集數清單成功載入後才標記已讀；從首頁、搜尋、Header 或其他詳情入口查看集數時，不清除清單提醒。
- `season lookup` 失敗時先重試一次；若仍失敗，沿用上一輪狀態，並顯示「暫時無法確認最新集數」。
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
- revision 簽章快取的 TTL（目前 5 分鐘）是「漏通知時的自我修復上限」，不是即時性來源：即時性由「資料變更必發 watch update 事件 → 新鮮度檢查立刻作廢快取」保證。因此任何會改到簽章涵蓋欄位（清單、觀看紀錄、分享、tv_states）的寫入路徑都必須 publish watch update，包含 cron / 維運腳本這類不經一般 API 的路徑；做不到的路徑等於接受最長一個 TTL 的跨裝置延遲與衝突檢查鈍化。調大 TTL 前需先盤點所有寫入路徑都有 publish。
- `REDIS_URL` 目前是 Vercel 與 Railway **共用同一顆 Upstash Redis**（透過 Vercel Marketplace 的 Upstash 整合建立，帳號不在 upstash.io 走一般註冊流程，容易忘記它的存在），與 `DATABASE_URL` / `AUTH_DATABASE_URL` 共用同一個 Neon 資料庫是同樣的架構模式（2026-07 確認，Railway log 已驗證 `transport mode: redis`）。這代表 Vercel 上的 cron 清理補發的 watch update 通知，理論上可以透過同一顆 Redis 的 pub/sub 即時傳給 Railway 正式站上正在連線的使用者，不需要等 revision TTL 兜底；若之後任一邊的 `REDIS_URL` 跟另一邊不同步（例如只改了其中一邊），會讓這個即時傳遞失效，只退回各自的 TTL / DB fallback（不會壞掉，只是變慢）。
- Upstash 是依「指令次數」計費／限額的代管服務，不是傳統自建 Redis 常見的「記憶體上限」；評估要不要把更高頻的資料（例如 TMDB 快取）也搬上 Redis 前，需先在 Vercel 後台 Storage 分頁或 Upstash 主控台確認目前方案的指令次數額度與用量，避免撞到額度或產生非預期費用。
- 若某個修正方案雖然更嚴格，但會明顯降低整站可用性，尤其是 `auth / session / rate limit / realtime`，需先說明取捨，不直接套用。
- 若同一段邏輯的 review 一直在同一個產品取捨上來回拉扯，先停下來對齊規則，不要持續 patch。

---

## TMDB 文件

進行 TMDB 相關開發時，請先閱讀 `docs/tmdb` 目錄中的文件，至少包含：

- `TMDB_TERMS.txt`
- `TMDB_API_TERMS.txt`

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
- 頁面在背景或使用者長時間未互動時，允許暫停 SSE / polling 以節省資源；恢復互動後再自動恢復同步。
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

