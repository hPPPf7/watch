import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";

const mocks = vi.hoisted(() => ({
  config: null as NextAuthConfig | null,
  auth: vi.fn(),
  getAuthDb: vi.fn(),
  getDb: vi.fn(),
  runInAuthTransaction: vi.fn(),
  runInTransaction: vi.fn(),
  publishWatchUpdates: vi.fn(),
}));
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => {
  mocks.config = config;
  return { auth: mocks.auth, handlers: {} };
} }));
vi.mock("@/server/db/client", () => mocks);
vi.mock("@/server/realtime/watchUpdates", () => ({ publishWatchUpdates: mocks.publishWatchUpdates }));
import "@/auth";
import { POST } from "@/app/api/account/delete/route";
import { PATCH } from "@/app/api/profile/me/route";

type Row = Record<string, unknown>;
type Event = { operation: string; table?: string; key?: string; transaction: number };
const dialect = new PgDialect();
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const identity = { provider: "google", providerAccountId: "google-user" };
const permanent = new Date("9999-12-31T23:59:59.999Z");
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// No DB client is imported at runtime. This fixture models transaction-local
// writes and advisory-lock waits, with barriers at the actual SQL boundaries.
class AuthFixture {
  rows: Record<string, Row[]> = {
    auth_user_map: [], auth_session_states: [], profiles: [], deleted_auth_account_markers: [],
  };
  events: Event[] = [];
  hook: (event: Event) => Promise<void> = async () => {};
  locks = new Map<string, Promise<void>>();
  nextTransaction = 0;
  async event(event: Event) {
    this.events.push(event);
    await this.hook(event);
  }
  seed(version = 1) {
    this.rows.auth_user_map.push({ id: "map-1", ...identity, userId, createdAt: new Date(0) });
    this.rows.auth_session_states.push({ userId, sessionVersion: version, createdAt: new Date(0), updatedAt: new Date(0) });
    this.rows.profiles.push({ id: userId, nickname: "Custom", providerNickname: "Provider", avatarUrl: "old", createdAt: new Date(0) });
  }
  client(transaction = 0, pending: ((rows: Record<string, Row[]>) => void)[] = [], releases: (() => void)[] = []) {
    const read = (table: string) => {
      const view = Object.fromEntries(Object.entries(this.rows).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
      for (const apply of pending) apply(view);
      return view[table] ?? [];
    };
    const apply = (change: (rows: Record<string, Row[]>) => void) => {
      if (transaction) pending.push(change); else change(this.rows);
    };
    return {
      select: (selection: Record<string, { name: string }>) => ({ from: (table: PgTable) => ({ where: (condition: SQL) => {
        const name = getTableName(table);
        const columns = getTableColumns(table);
        const query = dialect.sqlToQuery(condition);
        const get = async () => {
          await this.event({ operation: "read", table: name, transaction });
          const params = query.params;
          const rows = read(name).filter((row) => {
            if (name === "deleted_auth_account_markers") {
              // Also support the original provider-only marker lookup so the
              // same race can be run as a negative control against old auth.ts.
              if (!query.sql.includes('"expires_at" >')) {
                return row.provider === params[0] && row.providerAccountId === params[1];
              }
              return new Date(row.expiresAt as Date).getTime() > new Date(params[0] as string).getTime()
                && (row.userId === params[1] || (params.length > 2 && row.provider === params[2] && row.providerAccountId === params[3]));
            }
            if (name === "auth_user_map" && query.sql.includes('"provider_account_id"')) {
              return row.provider === params[0] && row.providerAccountId === params[1];
            }
            return row[name === "profiles" ? "id" : "userId"] === params[0];
          }).map(row => Object.fromEntries(Object.entries(selection).map(([alias, column]) => {
            const key = Object.entries(columns).find(([, value]) => value.name === column.name)![0];
            return [alias, row[key]];
          })));
          await this.event({ operation: "read-complete", table: name, transaction });
          return rows;
        };
        return { then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => get().then(resolve, reject), limit: get };
      } }) }),
      insert: (table: PgTable) => ({ values: (input: Row | Row[]) => {
        const name = getTableName(table);
        const values = Array.isArray(input) ? input : [input];
        const write = async (mode: "insert" | "ignore" | "update", updates?: Row) => {
          await this.event({ operation: "write", table: name, transaction });
          apply(rows => {
            for (const value of values) {
              const existing = rows[name].findIndex(row => name === "auth_user_map" || name === "deleted_auth_account_markers"
                ? row.provider === value.provider && row.providerAccountId === value.providerAccountId
                : row[name === "profiles" ? "id" : "userId"] === value[name === "profiles" ? "id" : "userId"]);
              if (existing < 0) rows[name].push({ ...value });
              else if (mode === "update") {
                // Existing-column SQL expressions preserve that field. The
                // fixture does not attempt to emulate general SQL expressions.
                const changed = Object.fromEntries(Object.entries(updates ?? value).map(([key, next]) => [
                  key, next !== null && typeof next === "object" && "queryChunks" in next ? rows[name][existing][key] : next,
                ]));
                rows[name][existing] = { ...rows[name][existing], ...changed };
              }
              else if (mode === "insert") throw new Error("duplicate identity");
            }
          });
        };
        return {
          then: (resolve: () => unknown, reject: (error: unknown) => unknown) => write("insert").then(resolve, reject),
          onConflictDoNothing: () => write("ignore"),
          onConflictDoUpdate: (config: { set: Row }) => ({
            then: (resolve: () => unknown, reject: (error: unknown) => unknown) => write("update", config.set).then(resolve, reject),
            returning: async (selection: Record<string, { name: string }>) => {
              await write("update", config.set);
              const columns = getTableColumns(table);
              return read(name).filter(row => values.some(value => row.id === value.id)).map(row => Object.fromEntries(
                Object.entries(selection).map(([alias, column]) => [alias, row[Object.entries(columns).find(([, value]) => value.name === column.name)![0]]]),
              ));
            },
          }),
        };
      } }),
      execute: async (statement: SQL) => {
        const query = dialect.sqlToQuery(statement);
        if (query.sql.includes("pg_advisory_xact_lock")) {
          const namespace = query.sql.includes("170101") ? "identity" : "user";
          const key = `${namespace}:${query.params[0]}`;
          await this.event({ operation: "lock-wait", key, transaction });
          const previous = this.locks.get(key) ?? Promise.resolve();
          const release = deferred();
          this.locks.set(key, previous.then(() => release.promise));
          await previous;
          releases.push(release.resolve);
          await this.event({ operation: "lock", key, transaction });
        } else if (query.sql.includes("del_auth_user_map")) {
          await this.event({ operation: "delete-auth", transaction });
          apply(rows => {
            rows.auth_user_map = rows.auth_user_map.filter(row => row.userId !== query.params[0]);
            rows.auth_session_states = rows.auth_session_states.filter(row => row.userId !== query.params[1]);
            rows.profiles = rows.profiles.filter(row => row.id !== query.params[2]);
          });
        } else if (query.sql.includes('DELETE FROM "deleted_auth_account_markers"')) {
          await this.event({ operation: "restore-auth", transaction });
          apply(rows => { rows.deleted_auth_account_markers = rows.deleted_auth_account_markers.filter(row => row.userId !== query.params[0]); });
        } else throw new Error(`Unexpected SQL: ${query.sql}`);
      },
    };
  }
  async transaction<T>(callback: (tx: ReturnType<AuthFixture["client"]>) => Promise<T>) {
    const transaction = ++this.nextTransaction;
    const pending: ((rows: Record<string, Row[]>) => void)[] = [];
    const releases: (() => void)[] = [];
    try {
      const value = await callback(this.client(transaction, pending, releases));
      for (const apply of pending) apply(this.rows);
      return value;
    } finally {
      releases.reverse().forEach(release => release());
    }
  }
}

let fixture: AuthFixture;
type JwtArguments = Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["jwt"]>>[0];
async function jwt(token: JWT, account?: typeof identity, profile?: Record<string, string>) {
  return (await mocks.config!.callbacks!.jwt!({ token, account, profile } as JwtArguments))!;
}
type SessionArguments = Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["session"]>>[0];
async function validatedSession(version = 1) {
  const token = await jwt({ app_user_id: userId, session_version: version });
  return mocks.config!.callbacks!.session!({ session: { user: { id: userId }, expires: permanent.toISOString() }, token } as SessionArguments);
}
const patchRequest = (nickname = "Renamed") => new Request("http://localhost/api/profile/me", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }),
});
const request = () => new Request("http://localhost/api/account/delete", { method: "POST" });
beforeEach(() => {
  vi.clearAllMocks();
  fixture = new AuthFixture();
  mocks.getAuthDb.mockImplementation(() => fixture.client());
  mocks.runInAuthTransaction.mockImplementation(callback => fixture.transaction(callback));
  mocks.auth.mockResolvedValue({ user: { id: userId, auth_provider: identity.provider, auth_provider_account_id: identity.providerAccountId } });
  mocks.getDb.mockReturnValue({ select: () => ({ from: () => ({ where: async () => [] }) }) });
  mocks.runInTransaction.mockImplementation(async callback => callback({ execute: async () => {}, insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }) }));
});

describe("account lifecycle callback and deletion races", () => {
  it("rejects the original callback paused after mapping lookup when deletion commits first", async () => {
    fixture.seed();
    const mapped = deferred(), resume = deferred();
    let paused = false;
    fixture.hook = async event => {
      if (!paused && event.operation === "read-complete" && event.table === "auth_user_map") {
        paused = true; mapped.resolve(); await resume.promise;
      }
    };
    const login = jwt({ sub: "oauth-sub" }, identity);
    await mapped.promise;
    expect((await POST(request())).status).toBe(200);
    resume.resolve();
    expect(await login).toMatchObject({ account_deleted: true });
    expect((await jwt({ app_user_id: userId, session_version: 1 })).app_user_id).toBeUndefined();
    expect(fixture.rows.auth_session_states).toEqual([]);
    expect(fixture.rows.auth_user_map).toEqual([]);
    expect(fixture.rows.profiles).toEqual([]);
  });

  it("makes deletion wait for a callback already inside the user boundary", async () => {
    fixture.seed();
    const writing = deferred(), resume = deferred(), deleting = deferred();
    fixture.hook = async event => {
      if (event.transaction === 1 && event.operation === "write" && event.table === "auth_session_states") {
        writing.resolve(); await resume.promise;
      }
      if (event.transaction === 2 && event.operation === "lock-wait") deleting.resolve();
    };
    const login = jwt({ sub: "oauth-sub" }, identity);
    await writing.promise;
    const deletion = POST(request());
    await deleting.promise;
    expect(fixture.events.some(event => event.operation === "delete-auth")).toBe(false);
    resume.resolve();
    await login;
    expect((await deletion).status).toBe(200);
    expect(fixture.rows.auth_session_states).toEqual([]);
    expect((await jwt({ app_user_id: userId, session_version: 1 })).app_user_id).toBeUndefined();
  });

  it.each([false, true])("guards late profile writes after session validation (retry=%s)", async retry => {
    fixture.seed();
    const checked = deferred(), resume = deferred();
    let paused = false;
    fixture.hook = async event => {
      if (!paused && event.transaction === 0 && event.operation === "read-complete" && event.table === "auth_session_states") {
        paused = true; checked.resolve(); await resume.promise;
      }
    };
    const login = jwt({ app_user_id: userId, session_version: 1, profile_sync_pending: retry, user_metadata: { full_name: "Late" } }, retry ? undefined : identity);
    await checked.promise;
    expect((await POST(request())).status).toBe(200);
    resume.resolve();
    expect(await login).toMatchObject({ session_invalid: true });
    expect(fixture.rows.profiles).toEqual([]);
  });

  it("rejects a profile retry if its version changes after ordinary JWT validation", async () => {
    fixture.seed();
    fixture.hook = async event => {
      if (event.transaction === 0 && event.operation === "read-complete" && event.table === "auth_session_states") {
        fixture.rows.auth_session_states[0].sessionVersion = 2;
      }
    };
    const token = await jwt({ app_user_id: userId, session_version: 1, profile_sync_pending: true, user_metadata: { full_name: "Late" } });
    expect(token.session_invalid).toBe(true);
    expect(fixture.rows.profiles[0].nickname).toBe("Custom");
  });

  it("rolls back a new identity mapping if session creation fails", async () => {
    fixture.hook = async event => {
      if (event.operation === "write" && event.table === "auth_session_states") throw new Error("session unavailable");
    };
    await expect(jwt({ sub: userId }, identity)).rejects.toThrow("session unavailable");
    expect(fixture.rows.auth_user_map).toEqual([]);
    expect(fixture.rows.auth_session_states).toEqual([]);
  });

  it("blocks a new provider alias targeting a deleted legacy UUID", async () => {
    fixture.rows.deleted_auth_account_markers.push({ ...identity, userId, expiresAt: permanent });
    const result = await jwt({ sub: userId }, { provider: "google", providerAccountId: "new-alias" });
    expect(result.account_deleted).toBe(true);
    expect(fixture.rows.auth_user_map).toEqual([]);
    expect(fixture.rows.auth_session_states).toEqual([]);
  });

  it("serializes concurrent first callbacks without replacing the established legacy mapping", async () => {
    const [first, second] = await Promise.all([jwt({ sub: userId }, identity), jwt({ sub: otherId }, identity)]);
    expect(first.app_user_id).toBe(userId);
    expect(second.app_user_id).toBe(userId);
    expect(fixture.rows.auth_user_map).toHaveLength(1);
    expect(fixture.rows.auth_session_states).toHaveLength(1);
    expect(first.session_version).toBe(1);
  });

  it("preserves mapped IDs and current versions for OAuth and legacy JWTs without extra normal-request queries", async () => {
    fixture.seed(7);
    expect(await jwt({ sub: otherId }, identity)).toMatchObject({ app_user_id: userId, session_version: 7 });
    fixture.events = [];
    expect(await jwt({ sub: userId })).toMatchObject({ app_user_id: userId, session_version: 7 });
    expect(fixture.events.filter(event => event.operation === "read")).toEqual([{ operation: "read", table: "auth_session_states", transaction: 0 }]);
    expect(fixture.events.some(event => event.operation === "lock")).toBe(false);
    expect((await jwt({ app_user_id: userId, session_version: 1 })).session_invalid).toBe(true);
  });

  it("allows deterministic new signup and expired markers while active identity markers block a different candidate", async () => {
    fixture.rows.deleted_auth_account_markers.push({ ...identity, userId, expiresAt: new Date(0) });
    const first = await jwt({ sub: "google-sub" }, identity);
    expect(first.app_user_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.session_version).toBe(1);
    fixture.rows.auth_user_map = [];
    fixture.rows.deleted_auth_account_markers[0].expiresAt = permanent;
    expect((await jwt({ sub: otherId }, identity)).account_deleted).toBe(true);
  });

  it.each(["auth_user_map", "deleted_auth_account_markers", "auth_session_states"])("fails closed on %s lookup errors", async table => {
    fixture.seed();
    fixture.hook = async event => { if (event.operation === "read" && event.table === table) throw new Error("fixture DB unavailable"); };
    await expect(jwt({ sub: "google-sub" }, identity)).rejects.toThrow();
    expect(fixture.rows.auth_session_states).toHaveLength(1);
  });

  it("keeps profile failures retryable and retries successfully while the session remains valid", async () => {
    fixture.seed();
    fixture.hook = async event => { if (event.operation === "write" && event.table === "profiles") throw new Error("profile unavailable"); };
    const token = await jwt({ sub: "google-sub" }, identity, { name: "Provider" });
    expect(token).toMatchObject({ app_user_id: userId, profile_sync_pending: true });
    fixture.hook = async () => {};
    expect((await jwt(token)).profile_sync_pending).toBe(false);
  });

  it("marks every mapped alias plus the authenticated legacy alias and prevents a duplicate deletion", async () => {
    fixture.seed();
    fixture.rows.auth_user_map.push({ ...identity, providerAccountId: "second-alias", userId });
    mocks.auth.mockResolvedValue({ user: { id: userId, auth_provider: "google", auth_provider_account_id: "legacy-alias" } });
    expect((await POST(request())).status).toBe(200);
    expect(fixture.rows.deleted_auth_account_markers.map(row => row.providerAccountId).sort()).toEqual(["google-user", "legacy-alias", "second-alias"]);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.runInTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.rows.deleted_auth_account_markers).toHaveLength(3);
  });

  it("rejects a concurrent duplicate while Watch deletion is pending, then restores the locked snapshot on failure", async () => {
    fixture.seed(7);
    const watchStarted = deferred(), failWatch = deferred();
    mocks.runInTransaction.mockImplementationOnce(async () => { watchStarted.resolve(); await failWatch.promise; throw new Error("Watch fixture failure"); });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deletion = POST(request());
      await watchStarted.promise;
      expect((await POST(request())).status).toBe(409);
      failWatch.resolve();
      expect((await deletion).status).toBe(500);
      expect(fixture.rows.deleted_auth_account_markers).toEqual([]);
      expect(fixture.rows.auth_user_map[0]).toMatchObject({ ...identity, userId });
      expect(fixture.rows.profiles[0]).toMatchObject({ nickname: "Custom", providerNickname: "Provider" });
      expect(await jwt({ app_user_id: userId, session_version: 7 })).toMatchObject({ app_user_id: userId });
      expect(mocks.runInTransaction).toHaveBeenCalledTimes(1);
      const restore = fixture.events.find(event => event.operation === "restore-auth")!;
      expect(fixture.events.some(event => event.transaction === restore.transaction && event.operation === "lock" && event.key === `user:${userId}`)).toBe(true);
    } finally { error.mockRestore(); }
  });

  it("rejects an authenticated nickname PATCH delayed until deletion commits", async () => {
    fixture.seed();
    mocks.auth.mockImplementation(() => validatedSession());
    const bodyStarted = deferred(), resume = deferred();
    const edit = patchRequest("Late nickname");
    vi.spyOn(edit, "json").mockImplementation(async () => {
      bodyStarted.resolve(); await resume.promise; return { nickname: "Late nickname" };
    });
    const update = PATCH(edit);
    await bodyStarted.promise;
    expect((await POST(request())).status).toBe(200);
    resume.resolve();
    const response = await update;
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(fixture.rows.profiles).toEqual([]);
  });

  it("preserves a legitimate nickname edit with the version emitted by the real session callback", async () => {
    fixture.seed(7);
    mocks.auth.mockImplementation(() => validatedSession(7));
    expect(await validatedSession(7)).toMatchObject({ user: { session_version: 7 } });
    const response = await PATCH(patchRequest("  Renamed  "));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: userId, nickname: "Renamed", avatarUrl: "old" });
    expect(fixture.rows.profiles[0]).toMatchObject({ nickname: "Renamed", providerNickname: "Provider", avatarUrl: "old" });
  });

  it("rejects a nickname PATCH when its validated session version changes before writing", async () => {
    fixture.seed(7);
    mocks.auth.mockImplementation(() => validatedSession(7));
    const edit = patchRequest();
    vi.spyOn(edit, "json").mockImplementation(async () => {
      fixture.rows.auth_session_states[0].sessionVersion = 8;
      return { nickname: "Late" };
    });
    expect((await PATCH(edit)).status).toBe(401);
    expect(fixture.rows.profiles[0].nickname).toBe("Custom");
  });

  it("makes deletion wait for a nickname edit already writing under the user lock", async () => {
    fixture.seed();
    mocks.auth.mockImplementation(() => validatedSession());
    const writing = deferred(), resume = deferred(), deleting = deferred();
    fixture.hook = async event => {
      if (event.transaction === 1 && event.operation === "write" && event.table === "profiles") {
        writing.resolve(); await resume.promise;
      }
      if (event.transaction === 2 && event.operation === "lock-wait") deleting.resolve();
    };
    const update = PATCH(patchRequest());
    await writing.promise;
    const deletion = POST(request());
    await deleting.promise;
    expect(fixture.events.some(event => event.operation === "delete-auth")).toBe(false);
    resume.resolve();
    expect((await update).status).toBe(200);
    expect((await deletion).status).toBe(200);
    expect(fixture.rows.profiles).toEqual([]);
  });

});
