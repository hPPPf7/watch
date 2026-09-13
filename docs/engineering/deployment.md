# 部署、排程與發布

調整部署環境、Cron、Redis 共用資源或準備發布時，查閱對應章節。一般功能修改不必先讀完整部署流程。

## 部署架構

- **正式網站跑在 Railway**，不是 Vercel。`package.json` 的 start script、`desktop/main.mjs` 預設載入的網域都是指向 Railway 上的正式部署。
- **`vercel.json` 是刻意保留的，不是殘留死碼**：專案另外有一個「隱形」的 Vercel 部署，沒有人實際瀏覽它，唯一用途是借用 Vercel Cron 功能，每天定時打 `/api/cron/tmdb-cache-cleanup` 清理過期 TMDB 快取。這個 Vercel 部署的 `DATABASE_URL` / `AUTH_DATABASE_URL` 指向跟 Railway 正式站**同一個 Neon 資料庫**，所以清理動作對正式資料有效。
  - 如果之後要調整清理排程，改 `vercel.json` 裡的 `crons.schedule` 即可，不需要在 Railway 另外設定。
  - cron 每次執行完會把摘要（時間、清理筆數、通知使用者數）寫回共用 Neon 的 `tmdb_cache`（key：`watch:cron:tmdb-cache-cleanup:last-run`）；本機執行 `npm run cron:status` 即可確認 cron 是否正常運作（距上次執行超過 26 小時會警告），不需要登入 Vercel。這是純維運工具，網站上沒有任何入口，一般使用者看不到。
  - **不要在 Railway 的正式網站服務上開啟 Railway 自己的「Cron Schedule」功能**：Railway 的 Cron Schedule 會把服務從「一直開著」改成「只在排程時間點啟動、跑完 Start Command 就關掉」，如果套用在正式網站服務上會等於把網站關掉。若未來想把排程搬離 Vercel，需要另開一個獨立的 Railway 服務專門執行清理指令並排程，不能加在網站本體服務上。
  - `@vercel/analytics`、`@vercel/speed-insights` 這兩個套件已於 2026-07 移除（因為 Vercel 那份部署沒人瀏覽，分析功能沒有意義），移除後不影響 cron 排程本身。

## 共用資源與維運

- `REDIS_URL` 目前是 Vercel 與 Railway **共用同一顆 Upstash Redis**（透過 Vercel Marketplace 的 Upstash 整合建立，帳號不在 upstash.io 走一般註冊流程，容易忘記它的存在），與 `DATABASE_URL` / `AUTH_DATABASE_URL` 共用同一個 Neon 資料庫是同樣的架構模式（2026-07 確認，Railway log 已驗證 `transport mode: redis`）。這代表 Vercel 上的 cron 清理補發的 watch update 通知，理論上可以透過同一顆 Redis 的 pub/sub 即時傳給 Railway 正式站上正在連線的使用者，不需要等 revision TTL 兜底；若之後任一邊的 `REDIS_URL` 跟另一邊不同步（例如只改了其中一邊），會讓這個即時傳遞失效，只退回各自的 TTL / DB fallback（不會壞掉，只是變慢）。
- Upstash 是依「指令次數」計費／限額的代管服務，不是傳統自建 Redis 常見的「記憶體上限」；評估要不要把更高頻的資料（例如 TMDB 快取）也搬上 Redis 前，需先在 Vercel 後台 Storage 分頁或 Upstash 主控台確認目前方案的指令次數額度與用量，避免撞到額度或產生非預期費用。

上述共用資源與 `transport mode: redis` 為 2026-07 已確認的部署基準；變更連線或資源前再核對兩邊實際設定。

## 匿名代理來源

- 正式網站實際跑在 Railway（見本文件「部署架構」），不是 Vercel／Cloudflare，因此 `x-vercel-ip-address` / `cf-connecting-ip` 都不會出現。匿名 TMDB proxy 限流改為信任 Railway 邊緣代理蓋寫過的 `x-forwarded-for`（取第一段），已在 Railway 該服務的環境變數加上 `TMDB_RATE_LIMIT_TRUST_PROXY_HEADERS=1` 啟用（2026-07）。若之後更換代管平台或改走其他 CDN，需重新確認新平台的 forwarded header 是否同樣可信，再決定要不要沿用這個開關。

## 發布

- 發布前必須先執行 npm audit 並核對 GitHub 依賴安全警報，不可等 push 回應才檢查。Release 安裝檔須由其 tag 指向的 commit 打包，核對版本與 latest.yml 雜湊；已推送的 tag 不移動，後續修補改用新版本。

程式碼提交前的檢查與 commit 規範見 [協作指引](../../AGENTS.md#驗證與提交)。只有已有發布授權時才進行推送／發布；準備版本、檢查差異與本機打包可以在任務範圍內完成。
