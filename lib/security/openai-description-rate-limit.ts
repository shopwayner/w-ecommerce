import { createHash } from "node:crypto";
import Redis from "ioredis";

export const OPENAI_DESCRIPTION_RATE_LIMIT = 3;
export const OPENAI_DESCRIPTION_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;

export type OpenAIProductDescriptionRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
  count: number;
};

type RedisEvalClient = {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
};

type RateLimitIdentity = {
  organizationId: string;
  userId: string;
  productId: string;
};

const consumeFixedWindowScript = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local ttl = redis.call("PTTL", KEYS[1])

if current >= tonumber(ARGV[1]) and ttl > 0 then
  return {0, current, ttl}
end

current = redis.call("INCR", KEYS[1])
if current == 1 or ttl <= 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
ttl = redis.call("PTTL", KEYS[1])
return {1, current, ttl}
`;

let redisClientPromise: Promise<Redis> | null = null;

async function defaultRedisClient() {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const redisUrl = process.env.REDIS_URL?.trim();
      if (!redisUrl) throw new Error("REDIS_URL_NOT_CONFIGURED");
      const client = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 1_500,
        maxRetriesPerRequest: 0
      });
      client.on("error", () => {
        // The route fails closed; connection details must not reach logs or clients.
      });
      try {
        await client.connect();
        return client;
      } catch (error) {
        client.disconnect(false);
        redisClientPromise = null;
        throw error;
      }
    })();
  }
  return redisClientPromise;
}

export function buildOpenAIProductDescriptionRateLimitKey(
  identity: RateLimitIdentity
) {
  const digest = createHash("sha256")
    .update([
      identity.organizationId,
      identity.userId,
      identity.productId
    ].join("\0"))
    .digest("hex");
  return `w-ecommerce:rate-limit:openai-description:v1:${digest}`;
}

function parsedEvalResult(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("INVALID_RATE_LIMIT_RESPONSE");
  }
  const [allowed, count, ttlMs] = value.map(Number);
  if (
    !Number.isFinite(allowed) ||
    !Number.isFinite(count) ||
    !Number.isFinite(ttlMs) ||
    count < 0 ||
    ttlMs <= 0
  ) {
    throw new Error("INVALID_RATE_LIMIT_RESPONSE");
  }
  return { allowed: allowed === 1, count, ttlMs };
}

export async function consumeOpenAIProductDescriptionRateLimit(
  identity: RateLimitIdentity,
  options: {
    now?: number;
    redis?: RedisEvalClient;
    limit?: number;
    windowMs?: number;
  } = {}
): Promise<OpenAIProductDescriptionRateLimitResult> {
  const limit = options.limit ?? OPENAI_DESCRIPTION_RATE_LIMIT;
  const windowMs = options.windowMs ?? OPENAI_DESCRIPTION_RATE_LIMIT_WINDOW_MS;
  const now = options.now ?? Date.now();
  const redis = options.redis ?? await defaultRedisClient();
  const result = parsedEvalResult(await redis.eval(
    consumeFixedWindowScript,
    1,
    buildOpenAIProductDescriptionRateLimitKey(identity),
    limit,
    windowMs
  ));
  const retryAfterSeconds = result.allowed
    ? 0
    : Math.max(1, Math.ceil(result.ttlMs / 1_000));
  return {
    allowed: result.allowed,
    limit,
    remaining: Math.max(0, limit - result.count),
    retryAfterSeconds,
    resetAt: now + result.ttlMs,
    count: result.count
  };
}

export const openAIProductDescriptionRateLimitScriptForTests =
  consumeFixedWindowScript;
