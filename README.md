# Watch

**把想看的作品、看過的故事，整理在同一個地方。**

Watch 是以繁體中文為主的影視清單與觀看紀錄工具，涵蓋電影、影集與動畫，支援好友一起看，以及與網站共用帳號資料的 Windows 桌面版。

[開啟 Watch](https://watch.han-burger.com) · [下載桌面版](https://github.com/hPPPf7/watch/releases) · [協作與產品規則](AGENT.md)

---

## 功能一覽

| 功能 | 說明 |
| --- | --- |
| 影視清單 | 分類管理電影、影集與動畫，搜尋目前清單內的片名 |
| 觀看紀錄 | 記錄觀看日期、季與集數，保留重看與共同觀看資訊 |
| 進度與提醒 | 下一集與集名、漏集提醒、新集數通知、電影上映倒數 |
| 觀看月曆 | 按日期回顧自己的觀看紀錄與好友一起看的作品 |
| 好友分享 | 分享觀看紀錄、查看共同觀看資訊 |
| 桌面應用程式 | Electron 外殼、本機快取與 GitHub Releases 自動更新 |

### 進度數字如何閱讀

- **已播出集數**：已取得完整且一致的季資料，依 TMDB 播出日期與台北日期計算；不代表各串流平台的即時上架時間。
- **已知總集數**：資料仍不足以確認播出總數，分母可能包含尚未播出的集數。
- **淡藍色**表示尚未看完，**綠色**表示已達目前分母，**黃色**表示漏集或集數資料不完整。

清單、作品詳情與即將播出頁面共用已取得的集數資料。為控制用量，不會只為補齊進度條而查遍所有季。

## 架構

| 層級 | 技術與用途 |
| --- | --- |
| 網頁 | Next.js App Router、React、TypeScript、Tailwind CSS |
| 登入 | Auth.js／NextAuth、Google 登入、共用帳號資料庫 |
| 專案資料 | Neon Postgres、Drizzle ORM |
| 即時同步與快取 | Redis Pub/Sub、SSE、Redis／Postgres TMDB 快取 |
| 正式部署 | Railway，提供網站與 API |
| 排程 | Vercel Cron，每日呼叫快取清理端點 |
| 桌面版 | Electron，載入正式網站並共用網站帳號與資料 |

> Vercel 部署用於排程，正式網站在 Railway。不要把正式網站服務改成 Railway Cron 服務，否則網站將不再常駐。

## 本機開發

需要 Node.js **20.9 以上**、npm，以及可用的資料庫與登入設定。

```bash
npm ci
npm run dev
```

將環境變數放入未追蹤的 `.env.local`。請使用適合開發的資料庫，不要把正式環境憑證提交至 Git。

### 環境變數

| 變數 | 用途 |
| --- | --- |
| `AUTH_SECRET` | 登入工作階段安全金鑰，必要 |
| `AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET` | Google OAuth 設定 |
| `DATABASE_URL` | Watch 專案資料庫，必要 |
| `AUTH_DATABASE_URL` | 共用帳號資料庫，必要；未設定時拒絕啟動相關連線，不退回專案資料庫 |
| `TMDB_API_KEY` | TMDB 搜尋、作品詳情與推薦功能所需；僅供伺服器使用 |
| `REDIS_URL` | Redis 即時通知與快取；未設定時部分同步降級為低頻輪詢 |
| `CRON_SECRET` | 保護排程 API |
| `TMDB_RATE_LIMIT_TRUST_PROXY_HEADERS` | 僅在確認代理會覆寫來源 IP 標頭後設為 `1`；正式 Railway 使用此設定 |

兩個資料庫變數可指向同一資料庫，但必須明確設定；共用登入帳號與 Watch 業務資料仍應分清楚。

### 驗證指令

```bash
npm run lint
npm run check:locale
npm test
npm run build
```

涉及 API 或資料流程時，還需驗證登入、清單、觀看紀錄與好友操作。更完整的規則請見 [AGENT.md](AGENT.md)。

## 資料與同步

- 網站與桌面版使用同一份伺服器資料；桌面版不支援離線寫入觀看紀錄。
- 使用者快取依帳號隔離；寫入後透過資料版本與即時通知更新。
- TMDB 公開作品資料與私人觀看紀錄分開快取；公開資料的更新不應重寫使用者紀錄。
- 活動期間每六小時檢查集數資料是否需要回查；本機跨日重算不等於新增網路請求。背景、閒置及編輯中會暫停，恢復操作後再檢查。
- 前端播出中季資料快取六小時，已完結季七天；桌面已完結詳情最多七天。伺服器另有播出日感知快取，因此上游修正可能需要經過各層回查才顯示；查詢失敗或資料不完整時不宣稱已確認最新播出總數。

### 資料庫變更

```bash
npm run db:generate
npm run db:migrate
```

先審查產生的 migration，再對指定環境套用。提交程式碼不代表資料庫已完成遷移，請避免以 `db:push` 取代正式環境的變更審查。

## Windows 桌面版

```bash
npm run desktop:dev
npm run desktop:dist
```

桌面版預設開啟正式網站。若要連到本機開發伺服器：

```powershell
$env:WATCH_DESKTOP_URL="http://localhost:3000"
npm run desktop:dev
```

安裝檔輸出至 `dist-desktop/`，本機 API 快取通常位於 `%APPDATA%\Watch\api-cache\`。

正式桌面版啟動時會先檢查網路與更新；無網路、更新失敗或新版尚未安裝時，不載入網站內容。安裝檔不可包含資料庫連線資訊或 API 金鑰。

## 發布與維運

1. 完成檢查，使用中文 commit；需要調整版本時，以版本變更作為最後一筆 commit。
2. 將整理好的 commits 一次推送，避免多次觸發部署。
3. 有資料結構變更時，另外套用經確認的 migration。
4. 有桌面程式變更時，從對應 tag 的 commit 打包，將安裝檔、blockmap 與 `latest.yml` 上傳 GitHub Release。

Release 版本、tag、安裝檔與 `latest.yml` 必須一致；已發布 tag 不移動。僅網頁變更通常不需要重新打包桌面外殼。

```bash
npm audit
npm run cron:status
```

發布前另需檢查 GitHub 依賴安全警報。排程狀態工具會讀取最近一次清理摘要，供維運確認。

## TMDB 資料來源

作品資料與圖片來自 [The Movie Database](https://www.themoviedb.org)。

> This product uses the TMDB API but is not endorsed or certified by TMDB.

保留應用程式中的 TMDB 標誌與來源聲明，遵守 [API 使用條款](https://www.themoviedb.org/api-terms-of-use)、[來源標示要求](https://developer.themoviedb.org/docs/faq) 與 [限流規範](https://developer.themoviedb.org/docs/rate-limiting)。收到 429 時遵守 Retry-After；不將六個月保存上限當成日常更新週期。商業使用須另確認適用授權。
