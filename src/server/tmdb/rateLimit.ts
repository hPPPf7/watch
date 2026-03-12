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
  };
  if (!globalState.__watchTmdbRateLimitStore) {
    globalState.__watchTmdbRateLimitStore = new Map();
  }
  return globalState.__watchTmdbRateLimitStore;
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

const resolveClientKey = (
  request: Request,
  userId: string | null,
  scope: Scope,
): { key: string } | null => {
  if (userId) {
    return { key: `${scope}:user:${userId}` };
  }
  // 匿名限流預設只信任平台已知會覆寫的 client IP 標頭；若自架部署確認 proxy 會覆寫 forwarding
  // headers，可透過 TMDB_RATE_LIMIT_TRUST_PROXY_HEADERS=1 明確開啟。
  // 目前正式環境跑在 Vercel，因此 x-vercel-ip-address 這條路徑會成立；沒有可信 client key
  // 時，寧可不做匿名分桶，也不要直接信任可被 client 偽造的 IP header。
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
