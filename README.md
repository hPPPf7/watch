# Watch

Watch 是一個用來管理影視觀看清單與觀看紀錄的網站與桌面版應用程式。

正式網站：

https://watch.han-burger.com

桌面版下載：

https://github.com/hPPPf7/watch/releases

## 功能

- 管理電影、影集、動畫清單
- 記錄觀看進度、觀看日期、集數狀態
- 顯示即將播出、即將上映與推薦列表
- 支援 Google 登入
- 支援好友與共享觀看紀錄
- 桌面版可使用本機快取加快常用資料讀取

## 技術

- Next.js
- React
- Auth.js / NextAuth
- Neon Postgres
- Drizzle ORM
- Electron
- GitHub Releases 自動更新

## 環境變數

必要：

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `DATABASE_URL`

選用：

- `AUTH_DATABASE_URL`：如果帳號資料使用另一個資料庫，未設定時會使用 `DATABASE_URL`
- `TMDB_API_KEY`：啟用 TMDB 搜尋、詳細資料、推薦列表等功能
- `REDIS_URL`：啟用 Redis Pub/Sub 即時更新；未設定時會降級為輪詢
- `CRON_SECRET`：保護 cron API

不要把任何 secret 寫進 repository 或桌面版安裝檔。

## 開發

安裝依賴：

```bash
npm install
```

啟動網站開發伺服器：

```bash
npm run dev
```

檢查程式：

```bash
npm run lint
npm test
npm run build
```

## 資料庫

產生 Drizzle migration：

```bash
npm run db:generate
```

套用 migration：

```bash
npm run db:migrate
```

本次桌面版相關變更沒有新增資料庫 migration。

## 桌面版

桌面版是 Electron 外殼，預設載入正式網站：

```text
https://watch.han-burger.com
```

使用者帳號與網站版相同，資料仍以正式網站與 Neon 資料庫為準。桌面版不會建立另一套帳號系統。

本機開發啟動桌面版：

```bash
npm run desktop:dev
```

若要讓桌面版載入本機網站：

```powershell
$env:WATCH_DESKTOP_URL="http://localhost:3000"
npm run desktop:dev
```

打包 Windows 安裝檔：

```bash
npm run desktop:dist
```

打包產物會輸出到：

```text
dist-desktop/
```

## 桌面版更新

正式打包的桌面版啟動時會先檢查 GitHub Releases：

- 沒有網路時不允許啟動
- 更新檢查失敗時不允許啟動
- 如果有新版本，會先下載並安裝新版，再開啟應用程式

發布新版桌面版時需要：

1. 更新 `package.json` 版本號
2. 執行 `npm run desktop:dist`
3. 建立對應版本的 git tag
4. 將 `dist-desktop` 內的安裝檔、blockmap、`latest.yml` 上傳到 GitHub Release

Release 內的檔名必須與 `latest.yml` 一致，否則自動更新會找不到檔案。

## 桌面版快取

桌面版會使用兩種快取：

- Electron / Chromium 一般 HTTP 快取：圖片與靜態資源
- main process API 快取：部分登入使用者相關 API

API 快取會依照使用者 `userId` 分開儲存，避免多帳號資料混用。登入、登出、切換帳號或修改觀看紀錄時，會清除或刷新相關快取。

Windows 上快取通常位於：

```text
%APPDATA%\Watch\
```

桌面 API 快取位於：

```text
%APPDATA%\Watch\api-cache\
```

可能包含 TMDB 內容的快取不得超過 180 天。

## TMDB 快取

首頁推薦列表會在台北時間每天 05:00 後刷新，不再以「上次抓取後 24 小時」作為唯一刷新時間。

TMDB 相關使用需遵守 TMDB API 規範，尤其是：

- 不要把 TMDB API key 放進前端或桌面安裝檔
- 不要快取 TMDB 內容超過 6 個月
- 必須保留 TMDB 來源與授權要求

## 部署注意

一般網站部署只需要推送 GitHub，部署平台會重新 build。

如果有修改以下內容，還需要同步處理外部服務：

- `drizzle/` 或 `src/server/db/schema.ts`：需要處理 Neon migration
- 環境變數需求：需要同步設定部署平台
- 桌面版版本：需要建立 GitHub Release

目前 repository 不應包含任何 `.env`、資料庫連線字串、API key 或私密憑證。
