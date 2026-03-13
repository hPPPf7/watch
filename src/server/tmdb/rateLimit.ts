import { NextResponse } from "next/server";

type Scope =
  | "detail"
  | "search"
  | "season"
  | "collection"
  | "recommendations_movie"
  | "recommendations_tv"
  | "recommendations_anime";

type LimitConfig = {
  windowMs: number;
  anonymousLimit: number;
  authenticatedLimit: number;
};

type HitStore = Map<string, number[]>;
type WarningStore = Set<string>;
type TmdbRateLimitResult = {
  response: NextResponse | null;
  beforeStart: () => void;
  apply: (response: NextResponse) => NextResponse;
};

const TMDB_PROXY_LIMITS: Record<Scope, LimitConfig> = {
  detail: {
    windowMs: 60_000,
    anonymousLimit: 30,
    authenticatedLimit: 300,
  },
  search: {
    windowMs: 60_000,
    anonymousLimit: 20,
    authenticatedLimit: 60,
  },
  season: {
    windowMs: 60_000,
    anonymousLimit: 60,
    authenticatedLimit: 240,
  },
  collection: {
    windowMs: 60_000,
    anonymousLimit: 20,
    authenticatedLimit: 60,
  },
  recommendations_movie: {
    windowMs: 60_000,
    anonymousLimit: 30,
    authenticatedLimit: 120,
  },
  recommendations_tv: {
    windowMs: 60_000,
    anonymousLimit: 30,
    authenticatedLimit: 120,
  },
  recommendations_anime: {
    windowMs: 60_000,
    anonymousLimit: 30,
    authenticatedLimit: 120,
  },
};

const getStore = (): HitStore => {
  const globalState = globalThis as typeof globalThis & {
    __watchTmdbRateLimitStore?: HitStore;
    __watchTmdbRateLimitWarnings?: WarningStore;
  };
  if (!globalState.__watchTmdbRateLimitStore) {
    globalState.__watchTmdbRateLimitStore = new Map();
  }
  return globalState.__watchTmdbRateLimitStore;
};

const getWarningStore = (): WarningStore => {
  const globalState = globalThis as typeof globalThis & {
    __watchTmdbRateLimitWarnings?: WarningStore;
  };
  if (!globalState.__watchTmdbRateLimitWarnings) {
    globalState.__watchTmdbRateLimitWarnings = new Set();
  }
  return globalState.__watchTmdbRateLimitWarnings;
};

const shouldTrustForwardedIpHeaders = () =>
  process.env.TMDB_RATE_LIMIT_TRUST_PROXY_HEADERS === "1";

const shouldTrustVercelIpHeader = () => process.env.VERCEL === "1";

const shouldTrustCloudflareIpHeader = () =>
  process.env.CF_PAGES === "1" ||
  process.env.TMDB_RATE_LIMIT_TRUST_CLOUDFLARE_HEADERS === "1";

const extractForwardedIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  null;

const warnAnonymousRateLimitBypass = (scope: Scope) => {
  const warnings = getWarningStore();
  const warningKey = `anonymous-bypass:${scope}`;
  if (warnings.has(warningKey)) {
    return;
  }
  warnings.add(warningKey);
  console.error(
    `[tmdb-rate-limit] anonymous rate limiting is disabled for scope "${scope}" because no trusted client IP header was available. ` +
      `Anonymous TMDB access remains open by design, but this deployment currently has no effective anonymous limiter. ` +
      `Configure trusted proxy headers or a platform IP header before exposing this route publicly.`,
  );
};

const resolveClientKey = (
  request: Request,
  userId: string | null,
  scope: Scope,
): { key: string } | null => {
  if (userId) {
    return { key: `${scope}:user:${userId}` };
  }
  // 匿名 TMDB 內容目前刻意維持可未登入瀏覽，正式部署前提是跑在 Vercel，
  // 由平台覆寫 x-vercel-ip-address 供匿名限流分桶使用。
  //
  // 這裡預設不直接信任 x-forwarded-for / x-real-ip，原因是自架或 proxy 設定錯誤時，
  // 這些 header 可能被 client 偽造；若拿偽造 header 當限流 key，等於讓攻擊者自己選桶。
  //
  // 因此在沒有可信平台 header 時，這裡的取捨是：
  // 1. 不把匿名搜尋直接改成必須登入，避免破壞既有產品規則
  // 2. 也不直接信任可偽造的 forwarding headers，避免做出假的安全感
  // 3. 改成明確記錄告警，提示這個部署目前沒有有效匿名限流保護
  //
  // 若未來正式環境不再只跑 Vercel，而是要支援自架公開流量，
  // 就應改成「平台可信 header」或「部署層級 fallback bucket」其中一種，
  // 而不是沿用目前這個僅告警、不強制匿名限流的策略。
  const platformIp =
    (shouldTrustVercelIpHeader()
      ? request.headers.get("x-vercel-ip-address")?.trim()
      : null) ||
    (shouldTrustCloudflareIpHeader()
      ? request.headers.get("cf-connecting-ip")?.trim()
      : null);
  const trustedIp =
    platformIp ||
    (shouldTrustForwardedIpHeaders() ? extractForwardedIp(request) : null);
  if (trustedIp) {
    return { key: `${scope}:ip:${trustedIp}` };
  }
  return null;
};

export const enforceTmdbProxyRateLimit = (
  request: Request,
  userId: string | null,
  scope: Scope,
): TmdbRateLimitResult => {
  const config = TMDB_PROXY_LIMITS[scope];
  const client = resolveClientKey(request, userId, scope);
  if (!client) {
    if (!userId) {
      // 匿名 TMDB 內容目前允許未登入瀏覽，這裡刻意不改成 fail-closed；
      // 但若部署缺少可信 client IP，匿名限流會失效，必須明確告警避免無聲失守。
      warnAnonymousRateLimitBypass(scope);
    }
    return {
      response: null,
      beforeStart: () => undefined,
      apply: (response) => response,
    };
  }
  const apply = (response: NextResponse) => response;
  let response: NextResponse | null = null;

  return {
    get response() {
      return response;
    },
    beforeStart: () => {
      const now = Date.now();
      const store = getStore();
      const cutoff = now - config.windowMs;
      const existing = (store.get(client.key) ?? []).filter((hit) => hit > cutoff);
      const limit = userId ? config.authenticatedLimit : config.anonymousLimit;

      if (existing.length >= limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing[0] + config.windowMs - now) / 1000),
        );
        response = apply(
          NextResponse.json(
            {
              code: "RATE_LIMITED",
              message: "Requests are too frequent. Please try again shortly.",
            },
            {
              status: 429,
              headers: {
                "Retry-After": String(retryAfterSeconds),
              },
            },
          ),
        );
        throw new Error("RATE_LIMITED");
      }

      existing.push(now);
      store.set(client.key, existing);

      if (store.size > 5000) {
        for (const [entryKey, hits] of store.entries()) {
          const recentHits = hits.filter((hit) => hit > cutoff);
          if (recentHits.length === 0) {
            store.delete(entryKey);
          } else if (recentHits.length !== hits.length) {
            store.set(entryKey, recentHits);
          }
        }
      }
    },
    apply,
  };
};
