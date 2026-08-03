import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAIProductDescriptionRateLimitKey,
  consumeOpenAIProductDescriptionRateLimit,
  openAIProductDescriptionRateLimitScriptForTests
} from "@/lib/security/openai-description-rate-limit";

class FakeFixedWindowRedis {
  now = 1_000;
  readonly entries = new Map<string, { count: number; resetAt: number }>();

  async eval(
    _script: string,
    _numberOfKeys: number,
    key: string,
    limit: number,
    windowMs: number
  ) {
    const current = this.entries.get(key);
    const active = current && current.resetAt > this.now ? current : null;
    if (active && active.count >= Number(limit)) {
      return [0, active.count, active.resetAt - this.now];
    }
    const next = active
      ? { ...active, count: active.count + 1 }
      : { count: 1, resetAt: this.now + Number(windowMs) };
    this.entries.set(key, next);
    return [1, next.count, next.resetAt - this.now];
  }
}

const identity = {
  organizationId: "org-current",
  userId: "user-current",
  productId: "product-current"
};

test("fixed window permits calls through the limit and returns a precise TTL", async () => {
  const redis = new FakeFixedWindowRedis();
  const first = await consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now });
  const second = await consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now });
  const third = await consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now });
  const blocked = await consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now });

  assert.deepEqual(
    [first.allowed, second.allowed, third.allowed, blocked.allowed],
    [true, true, true, false]
  );
  assert.equal(first.remaining, 2);
  assert.equal(third.remaining, 0);
  assert.equal(blocked.count, 3);
  assert.equal(blocked.retryAfterSeconds, 600);
  assert.equal(blocked.resetAt, 601_000);
});

test("expired window starts a new quota without manual cleanup", async () => {
  const redis = new FakeFixedWindowRedis();
  await consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now });
  redis.now += 600_001;
  const result = await consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now });
  assert.equal(result.allowed, true);
  assert.equal(result.count, 1);
  assert.equal(result.remaining, 2);
});

test("organization user and product compose isolated opaque keys", () => {
  const original = buildOpenAIProductDescriptionRateLimitKey(identity);
  const otherUser = buildOpenAIProductDescriptionRateLimitKey({ ...identity, userId: "other" });
  const otherOrganization = buildOpenAIProductDescriptionRateLimitKey({
    ...identity,
    organizationId: "other"
  });
  const otherProduct = buildOpenAIProductDescriptionRateLimitKey({
    ...identity,
    productId: "other"
  });
  assert.equal(new Set([original, otherUser, otherOrganization, otherProduct]).size, 4);
  assert.doesNotMatch(original, /org-current|user-current|product-current/);
  assert.match(original, /^w-ecommerce:rate-limit:openai-description:v1:[0-9a-f]{64}$/);
});

test("concurrent consumption is bounded atomically and blocked calls do not inflate count", async () => {
  const redis = new FakeFixedWindowRedis();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => (
      consumeOpenAIProductDescriptionRateLimit(identity, { redis, now: redis.now })
    ))
  );
  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(results.filter((result) => !result.allowed).length, 9);
  assert.equal(Math.max(...results.map((result) => result.count)), 3);
});

test("Redis failure is propagated so the route can fail closed", async () => {
  await assert.rejects(
    consumeOpenAIProductDescriptionRateLimit(identity, {
      redis: {
        eval: async () => {
          throw new Error("redis unavailable");
        }
      }
    }),
    /redis unavailable/
  );
});

test("Lua policy performs the check increment and expiry in one atomic script", () => {
  assert.match(openAIProductDescriptionRateLimitScriptForTests, /redis\.call\("GET"/);
  assert.match(openAIProductDescriptionRateLimitScriptForTests, /redis\.call\("INCR"/);
  assert.match(openAIProductDescriptionRateLimitScriptForTests, /redis\.call\("PEXPIRE"/);
});
