# Distributed Token Bucket Rate Limiter

A production-ready, highly efficient distributed rate limiter middleware for Node.js and Express powered by Redis and atomic Lua scripting.

---

## 🚀 Overview & Architecture Evolution

This project documents the step-by-step engineering evolution of building a distributed rate limiter from a naive in-memory model to an atomic, high-performance Redis Lua-based middleware.

### Evolution Across Iterations:

1. **Iteration 1 (`iteration_1.js`) — In-Memory + Mutex**:
   - Implemented token bucket rate limiting using local memory with Node.js `async-mutex` and `setInterval` for refills.
   - *Limitation*: State was confined to a single Node process (no multi-instance scaling) and `setInterval` suffered from timer drift and CPU overhead.

2. **Iteration 2 (`iteration_2.js`) — Redis State (Non-Atomic)**:
   - Moved token counts and timestamps to Redis to support distributed architectures.
   - *Limitation*: Relied on multiple round-trips (`GET` -> calculate -> `SET`), introducing severe race conditions under concurrent traffic.

3. **Iteration 3 (`iteration_3.js`) — Redis + Atomic Lua Scripting**:
   - Consolidated token math and state updates into a single atomic Lua script executed inside Redis via `EVAL`.
   - Used Redis server time (`TIME`) for sub-millisecond precision without client clock drift.

4. **Iteration 4 (`iteration_4.js`) — Per-Client / Per-IP Partitioning**:
   - Expanded the Lua script to dynamically partition rate limit buckets per client IP address.

5. **Final Production Version (`ratelimiter.js`) — Production Middleware**:
   - Encapsulated into a clean, reusable Express middleware factory: `rateLimiter(capacity, refillRate)`.
   - Dynamic TTL expiration on Redis keys to prevent memory leaks for inactive IPs.
   - Self-healing state recovery for missing or evicted Redis keys.
   - Sub-millisecond execution with structured latency and decision logging.
   - Graceful error handling (500 fallback without crashing the application).

---

## 📁 Repository Structure

```
├── ratelimiter.js        # Final production-ready Express middleware
├── caller.js             # Example Express application consuming the middleware
├── test_runner.js        # Comprehensive automated test suite (AI-generated)
├── iteration_1.js        # Iteration 1: In-memory mutex approach
├── iteration_2.js        # Iteration 2: Redis with multi-roundtrip approach
├── iteration_3.js        # Iteration 3: Atomic Lua script with global bucket
├── iteration_4.js        # Iteration 4: Atomic Lua script with per-IP keys
├── package.json          # Project metadata & scripts
└── .gitignore            # Git ignore rules
```

---

## ⚡ Usage

### 1. Installation

Ensure you have Redis running locally or remotely.

```bash
npm install
```

### 2. Using the Middleware

```javascript
import express from "express";
import { rateLimiter } from "./ratelimiter.js";

const app = express();
app.set("trust proxy", true);

// Configure: 100 max capacity, 1 token refilled per second
const limiter = rateLimiter(100, 1);

// Apply to routes
app.get("/api/data", limiter, (req, res) => {
    res.json({ message: "Success" });
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
```

---

## 🧪 Testing

The repository includes a comprehensive automated test suite (`test_runner.js`) that validates every edge case and concurrency behavior.

### Run Tests:

```bash
npm test
```

### Test Coverage:
- ✅ **Burst Capacity**: Verifies initial allowance up to max capacity.
- ✅ **Immediate Rejection**: Rejects `(capacity + 1)`-th request with `429 Too Many Requests`.
- ✅ **Refill Precision**: Tests fractional token replenishment over exact time deltas.
- ✅ **Capacity Ceiling**: Ensures token accumulation never exceeds configured capacity.
- ✅ **High Concurrency & Atomicity**: Tests 50 parallel requests with zero race conditions.
- ✅ **Multi-IP Isolation**: Confirms independent quotas per client IP.
- ✅ **Self-Healing Key Eviction**: Ensures recovery without throwing 500 when keys are partially evicted.
- ✅ **Route Sharing**: Validates middleware sharing across different endpoint paths.
- ✅ **Memory Leak Prevention**: Checks that Redis keys have TTLs set.
- ✅ **IP Fallback**: Validates fallback when proxy headers are absent.
