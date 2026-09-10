import { createClient } from 'redis'
import dotenv from 'dotenv'

dotenv.config()

const client = createClient();
client.on('error', (err) => console.log('Redis Client Error', err));

try {
    await client.connect();
} catch (e) {
    console.log("Redis error", e);
}

const luaScript = `
    local token = redis.call("GET", KEYS[1])
    local last_refill_time = redis.call("GET", KEYS[2])

    local time = redis.call("TIME")
    local curr_time = tonumber(time[1]) + tonumber(time[2]) / 1000000

    local capacity = tonumber(ARGV[1])
    local refill_rate = tonumber(ARGV[2])

    if not token or not last_refill_time then
        token = capacity
        last_refill_time = curr_time
    else
        token = tonumber(token)
        last_refill_time = tonumber(last_refill_time)
    end

    local elapsed = curr_time - last_refill_time

    token = math.min(
        capacity,
        token + (elapsed * refill_rate)
    )

    local ttl = math.ceil(capacity / refill_rate) * 2
    if ttl < 60 then
        ttl = 60
    end

    if token >= 1 then
        token = token - 1

        redis.call("SET", KEYS[1], token, "EX", ttl)
        redis.call("SET", KEYS[2], curr_time, "EX", ttl)

        return 1
    end

    redis.call("SET", KEYS[1], token, "EX", ttl)
    redis.call("SET", KEYS[2], curr_time, "EX", ttl)

    return 0
`

export function rateLimiter(capacity, refillRate) {
  return async (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1'
    const start = performance.now()

    try {
      const result = await client.eval(luaScript, {
        keys: [
          `ratelimit:${ip}:token`,
          `ratelimit:${ip}:last_refill_time`
        ],
        arguments: [
          String(capacity),
          String(refillRate)
        ]
      })

      const latency = performance.now() - start

      console.log(JSON.stringify({
        event: "rate_limit",
        decision: result === 1 ? "accept" : "reject",
        ip,
        latency_ms: Number(latency.toFixed(2))
      }))

      if (result === 1) {
        next()
      } else {
        res.status(429).send('Too many requests')
      }

    } catch (e) {
      console.log(JSON.stringify({
        event: "rate_limit_error",
        error: e.message
      }))

      res.status(500).send("Rate limiter error")
    }
  }
}