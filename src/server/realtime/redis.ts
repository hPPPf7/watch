import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL?.trim() ?? "";

function requireRedisUrl() {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is required for Redis realtime transport");
  }
  return REDIS_URL;
}

function createPublisherClient(connectionName: string) {
  return new Redis(requireRedisUrl(), {
    connectionName,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
  });
}

function createSubscriberClient(connectionName: string) {
  return new Redis(requireRedisUrl(), {
    connectionName,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  });
}

export function isRedisRealtimeEnabled() {
  return REDIS_URL.length > 0;
}

export function getRedisPublisher() {
  const globalState = globalThis as typeof globalThis & {
    __watchRedisPublisher?: Redis;
  };
  if (!globalState.__watchRedisPublisher) {
    globalState.__watchRedisPublisher = createPublisherClient(
      "watch-realtime-publisher",
    );
  }
  return globalState.__watchRedisPublisher;
}

export function getRedisSubscriber() {
  const globalState = globalThis as typeof globalThis & {
    __watchRedisSubscriber?: Redis;
  };
  if (!globalState.__watchRedisSubscriber) {
    globalState.__watchRedisSubscriber = createSubscriberClient(
      "watch-realtime-subscriber",
    );
  }
  return globalState.__watchRedisSubscriber;
}
