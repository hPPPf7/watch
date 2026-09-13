# 桌面版、身份快取與隔離驗證

修改 Electron 外殼、protocol 攔截、磁碟快取、桌面登入或更新閘門時查閱。TMDB 快取期限與標題載入見 [TMDB 與集數資料](tmdb.md)；發布安裝檔時查 [部署與發布](deployment.md#發布)。

## 執行環境與更新閘門

- 桌面版是 Electron 外殼，預設載入 `https://watch.han-burger.com`；使用者帳號與資料來源仍是正式網站同一套 Auth / Neon，不另建本機帳號。
- 桌面端遠端網站內容必須跑在 isolated / sandboxed BrowserView；不得為了快取在遠端 renderer 內關閉 `contextIsolation` 或 `sandbox`。
- 桌面端可用 Electron / Chromium 一般 HTTP 快取（例如圖片與靜態資源），以及 main-process / session 層的明確 API response cache；使用者 API response cache 不可用 renderer monkey-patch 實作。
- 桌面端不能離線寫入觀看紀錄、清單、好友或帳號資料。
- 正式打包的桌面端啟動時必須先完成網路與更新檢查；無網路、更新檢查失敗或有新版本尚未安裝時，不得載入正式網站內容。
- 本機測試可用 `WATCH_DESKTOP_SKIP_UPDATE_CHECK=1` 暫時略過更新閘門，但不得用於正式發行。
- 打包桌面版時不得把 `TMDB_API_KEY`、`DATABASE_URL`、`AUTH_DATABASE_URL` 或其他 server secret 放進安裝檔。

## 私人快取與串流

- 桌面 user-data API response cache 必須以 `user:<userId>` 分桶，命中前需用輕量 revision / freshness 檢查確認資料仍有效，登出、切帳號或 watchlist/history 寫入後需清除對應使用者快取，避免多帳號資料混用。
- 桌面 API 攔截使用 protocol.handle；非快取回應直接串流，取消串流須明確 abort upstream fetch。刪除本網站或帳戶成功時清除 API、local history 與 title store，刪除前啟動的請求不得重新寫入快取。
- 桌面版相同帳號的 session 重驗、CSRF 與 provider 查詢不得清空快取或延長既有期限；確認 session 為 null、成功登出／登入 callback、切換帳號或刪帳才清理。重驗失敗／格式錯誤保留磁碟資料，但作廢短期身份快取，下一次私人讀取須重新驗證。清理與新請求／寫檔須有順序屏障，較早開始的身份查詢與資料請求不得重新填入已清除的快取。
- 桌面下一集快取須連同已驗證的漏集判斷保存於既有清單快取，並核對觀看位置與計數再重用；補看或刪除後交回原掃描重算。舊快取缺少判斷或固定的新鮮度時間戳時走原檢查流程；以六小時時段與台北日期驗證有效性，一般同步不得延長有效期限。不新增 API 或資料庫欄位。

含 TMDB 內容的快取保存上限與固定到期時間見 [保存上限](tmdb.md#保存上限)，不能因使用者操作而續期。

## Electron 身份判斷與已知限制

- Electron protocol.handle 的 Cookie 標頭可能缺席；只有確認來自 Watch 同來源視窗、且攔截層可見的 credentials 不為 omit 的請求，才可讀本機 Cookie 儲存區產生身份快取指紋。指紋不得寫入磁碟或手動注入轉送請求；缺少來源或讀取失敗時走正常網路，不借用私人快取。登入重驗失敗須同時作廢進行中的身份查詢版本，不得由遲到的 profile 回應恢復舊身份。可用 scripts/verify-desktop-auth-cache.mjs 的隔離隱藏 Electron 視窗驗證，不使用正式帳號。
- Electron 目前重建 protocol.handle Request 時不保留 renderer 原始 credentials，隔離實測原版本的 credentials: omit 也會被轉送成帶登入的請求；因此不得用單元測試宣稱原生端到端匿名語意已修好。目前 Watch 無此產品流程，這項平台相容性限制另行記錄；真正登出以 server session null／signout 及清除身份版本驗證，不能以 credentials: omit 代替。

## 本機驗證

- 本機桌面串流 smoke test 可用 Electron 執行 scripts/verify-desktop-stream.mjs；此腳本使用隱藏 sandbox 視窗、本機 HTTP fixture 與獨立暫存 userData，不會載入正式站。

只有修改對應功能時才執行所需腳本：

```powershell
.\node_modules\.bin\electron.cmd scripts/verify-desktop-stream.mjs
.\node_modules\.bin\electron.cmd scripts/verify-desktop-auth-cache.mjs
```

這兩個腳本使用 127.0.0.1 HTTP fixture、獨立暫存 userData 與隱藏 sandbox 視窗，不使用正式帳號或載入正式站。可執行並修復本次變更造成的失敗，再重跑受影響腳本。

`npm run desktop:dev` 預設載入正式站，不屬於上述隔離測試；要測本機網站時，明確設定 `WATCH_DESKTOP_URL` 為本機位址。
