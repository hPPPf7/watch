# 專案協作指引

## 基本原則

- 專案介面文字以中文為主，避免混入英文提示。
- 修改功能時，優先保留既有 UI 文案與使用流程。
- 任何會影響部署或資料一致性的改動，需先本機驗證。
- 產品邏輯優先。若 review 指出的「問題」會改變既有產品定義，需先對齊，不直接修改。
- 資料正確性優先於短暫可用性，尤其要避免刪帳復活、寫到錯帳號、auth fallback 造出另一個 user id。
- 只要有產品邏輯、資料規則、重要取捨或協作流程上的變更，修改程式時要順便更新 `AGENT.md`，避免規則只留在聊天紀錄裡。

---

## 產品規則

### 觀看紀錄與清單

- `想看` 是清單中的未看狀態，不是可隨意丟棄的暫存 watchlist。
- 只要已有觀看紀錄，就不能直接從清單移除。
- 影集 / 動畫的 shared history 與自己的 history 視為同等進度。
- 電影同一天同一部作品只能有一筆觀看紀錄。
- 影集 / 動畫同一季同一集只能有一筆觀看紀錄，不論是自己新增或同步進來都一樣。
- TV / Anime 詳細資料彈窗內，自己的紀錄與同步給自己的紀錄視為同一份進度。
- 電影觀看紀錄的 `season_number / episode_number` 必須固定為 `0 / 0`。
- `originalDate` 只要有帶，就必須是有效日期；不能把壞字串默默當成 `null`。
- 編輯觀看紀錄時，只要目標日期已存在同作品 / 同季同集紀錄，就直接擋下，不做自動合併。
- 若好友在同一天同作品已有紀錄，這次同步整筆不成立，不是略過該好友繼續存。

### 日曆

- 日曆的 `watched_at`、月份邊界、跳月判斷一律用 `date-only` 語意處理，不做本地時區換算。
- 月曆 `selectedFriendId` 不只要是 UUID，還必須是目前 viewer 可見的好友；不能繞過前端 picker 查任意人。
- 月曆「所有紀錄」模式可以保留該筆共同觀看的完整資料關係，但 API 回前端的 participant 只能帶 viewer 可見好友。
- 月曆 UI 顯示 participant 時不顯示自己，只顯示目前好友；若之後才成為好友，既有紀錄可自動補顯示。

### 清單狀態與提醒

- `已看 X / Y` 只有在全部看完時，文字才變綠色；其他樣式不動。
- 「已看完目前已播出集數」在首頁 badge 也視為 `completed`，不能和清單文字打架。
- TV / Anime 若有 `有新集數播出` 提醒，應排在 `正在觀看` 清單最前面。
- TV / Anime 若尚未播出且使用者還沒有任何觀看紀錄，清單卡片文字顯示「尚未播出」，不要寫成「尚未觀看任何集數」。
- `watchlist_tv_states` 的提醒欄位屬於可持久化的 state / cache，不只是前端記憶體狀態。
- `season lookup` 失敗時先重試一次；若仍失敗，沿用上一輪狀態，並顯示「暫時無法確認最新集數」。
- 自動刷新詳情彈窗內容時，要保留 history 區塊原本的捲動位置；只限自動刷新，不影響開啟時預設捲動，也不要動畫。
- 電影日期選擇器與 TV / Anime 一樣，使用者正在開啟日期選擇器時要暫停自動刷新，避免選擇器被刷新關掉。

### 搜尋與公開內容

- 搜尋、首頁推薦、TMDB 公開內容目前允許匿名查看，不要直接改成必須登入。
- 正式部署前提以 Vercel 為主；若在非 Vercel / Cloudflare 或未明確信任 proxy header 的環境部署，匿名 TMDB proxy 限流不保證有效，現階段以告警為主，不直接 fail-closed。

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
- `auth_user_map` 指向不存在 user 屬不可接受狀態，DB 應阻擋。

---

## Realtime / SSE / 限流取捨

- 目前 watchlist SSE 採 shared poller，優先降低同一個 server instance 內的重複 DB 輪詢。
- 現階段接受輪詢式即時更新；若未來流量成長、DB 壓力明顯上升，再評估 Redis Pub/Sub 或其他 realtime 基礎設施。
- 若已提供 `REDIS_URL`，watchlist SSE 應優先走 Redis Pub/Sub；未提供時維持 shared poller fallback，避免部署環境未補齊就中斷更新。
- 若已提供 `REDIS_URL`，好友通知也應優先走 Redis Pub/Sub；未提供時維持低頻 polling fallback。
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
