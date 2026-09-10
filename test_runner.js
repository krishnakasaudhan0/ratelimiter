import express from 'express';
import http from 'http';
import { rateLimiter } from './ratelimiter.js';
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// Helper to create test server
function createTestApp(capacity, refillRate) {
  const app = express();
  app.set('trust proxy', true);
  const limiter = rateLimiter(capacity, refillRate);

  app.get('/api/test', limiter, (req, res) => {
    res.status(200).send('OK');
  });

  app.get('/api/users', limiter, (req, res) => {
    res.status(200).send('Users');
  });

  app.get('/api/products', limiter, (req, res) => {
    res.status(200).send('Products');
  });

  return app;
}

function makeRequest(server, path = '/api/test', ip = '127.0.0.1', headers = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: port,
        path: path,
        method: 'GET',
        headers: {
          'X-Forwarded-For': ip,
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runAllTests() {
  console.log('======================================================');
  console.log('       RATE LIMITER COMPREHENSIVE TEST SUITE          ');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function assertTest(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
      failed++;
    }
  }

  // Clear Redis before tests
  await redis.flushAll();

  // Test 1: Burst Capacity Allowance
  await assertTest('1. Burst Capacity: Allows exactly up to capacity requests', async () => {
    const app = createTestApp(5, 1);
    const server = app.listen(0);
    const testIp = '10.0.0.1';

    try {
      for (let i = 1; i <= 5; i++) {
        const res = await makeRequest(server, '/api/test', testIp);
        if (res.status !== 200) {
          throw new Error(`Request #${i} expected 200 but got ${res.status}`);
        }
      }
    } finally {
      server.close();
    }
  });

  // Test 2: Threshold 429 Rejection
  await assertTest('2. Immediate 429 Rejection: Blocks (capacity + 1)th request', async () => {
    const app = createTestApp(5, 1);
    const server = app.listen(0);
    const testIp = '10.0.0.2';

    try {
      for (let i = 1; i <= 5; i++) {
        await makeRequest(server, '/api/test', testIp);
      }
      const res = await makeRequest(server, '/api/test', testIp);
      if (res.status !== 429) {
        throw new Error(`Expected status 429 but got ${res.status}`);
      }
      if (!res.body.includes('Too many requests')) {
        throw new Error(`Expected 'Too many requests' body but got: ${res.body}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 3: Token Refill Rate Precision
  await assertTest('3. Refill Rate: Refills exactly 1 token after 1/refillRate period', async () => {
    // Capacity 2, Refill rate 2 tokens/sec -> 1 token every 500ms
    const app = createTestApp(2, 2);
    const server = app.listen(0);
    const testIp = '10.0.0.3';

    try {
      // Consume all 2 tokens
      await makeRequest(server, '/api/test', testIp);
      await makeRequest(server, '/api/test', testIp);

      // Verify immediate request is blocked
      let resBlocked = await makeRequest(server, '/api/test', testIp);
      if (resBlocked.status !== 429) {
        throw new Error(`Expected 429 immediately after exhaustion, got ${resBlocked.status}`);
      }

      // Wait 600ms (refills ~1.2 tokens -> 1 token available)
      await sleep(600);

      let resAllowed = await makeRequest(server, '/api/test', testIp);
      if (resAllowed.status !== 200) {
        throw new Error(`Expected 200 after 600ms refill, got ${resAllowed.status}`);
      }

      // Immediate subsequent request must be blocked (fractional token < 1)
      let resBlockedAgain = await makeRequest(server, '/api/test', testIp);
      if (resBlockedAgain.status !== 429) {
        throw new Error(`Expected 429 after consuming refilled token, got ${resBlockedAgain.status}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 4: Maximum Token Cap Preservation
  await assertTest('4. Max Token Capping: Refilled tokens never exceed max capacity', async () => {
    // 3 capacity, 10 tokens/sec
    const app = createTestApp(3, 10);
    const server = app.listen(0);
    const testIp = '10.0.0.4';

    try {
      // Wait for 1 second (which would be 10 tokens if unbounded)
      await sleep(1000);

      // Should only allow 3 requests (its capacity)
      for (let i = 1; i <= 3; i++) {
        const res = await makeRequest(server, '/api/test', testIp);
        if (res.status !== 200) {
          throw new Error(`Request #${i} failed with status ${res.status}`);
        }
      }

      // 4th request must be rejected
      const res = await makeRequest(server, '/api/test', testIp);
      if (res.status !== 429) {
        throw new Error(`Expected 4th request to be 429, got ${res.status}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 5: Concurrency and Atomicity under Parallel Bursts
  await assertTest('5. Concurrency & Atomicity: Zero race conditions under 50 simultaneous requests', async () => {
    const capacity = 10;
    const app = createTestApp(capacity, 0.01); // negligible refill
    const server = app.listen(0);
    const testIp = '10.0.0.5';

    try {
      // Fire 50 simultaneous parallel requests
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(makeRequest(server, '/api/test', testIp));
      }

      const results = await Promise.all(promises);
      const accepted = results.filter((r) => r.status === 200).length;
      const rejected = results.filter((r) => r.status === 429).length;

      if (accepted !== capacity) {
        throw new Error(`Expected exactly ${capacity} accepted requests, got ${accepted}`);
      }
      if (rejected !== 50 - capacity) {
        throw new Error(`Expected ${50 - capacity} rejected requests, got ${rejected}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 6: Multi-IP Isolation
  await assertTest('6. IP Isolation: One IP exhausting limit does not affect others', async () => {
    const app = createTestApp(2, 0.1);
    const server = app.listen(0);
    const ip1 = '10.0.0.61';
    const ip2 = '10.0.0.62';

    try {
      // Exhaust IP1
      await makeRequest(server, '/api/test', ip1);
      await makeRequest(server, '/api/test', ip1);
      const resIp1 = await makeRequest(server, '/api/test', ip1);
      if (resIp1.status !== 429) {
        throw new Error(`Expected IP1 to be 429, got ${resIp1.status}`);
      }

      // IP2 should still have full quota
      const resIp2_1 = await makeRequest(server, '/api/test', ip2);
      const resIp2_2 = await makeRequest(server, '/api/test', ip2);
      if (resIp2_1.status !== 200 || resIp2_2.status !== 200) {
        throw new Error(`Expected IP2 requests to be 200, got ${resIp2_1.status} and ${resIp2_2.status}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 7: Missing/Corrupted Single Key Self-Healing
  await assertTest('7. Self-Healing Keys: Gracefully handles missing last_refill_time key', async () => {
    const app = createTestApp(5, 1);
    const server = app.listen(0);
    const testIp = '10.0.0.7';

    try {
      // Initial request
      await makeRequest(server, '/api/test', testIp);

      // Simulate partial key deletion
      await redis.del(`ratelimit:${testIp}:last_refill_time`);

      // Next request must reset smoothly and return 200, NOT error 500
      const res = await makeRequest(server, '/api/test', testIp);
      if (res.status !== 200) {
        throw new Error(`Expected 200 after key reset, got status ${res.status}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 8: Multiple Endpoint Shared Limiter
  await assertTest('8. Route Endpoints: Shared limiter counts across multiple paths for same client', async () => {
    const app = createTestApp(3, 0.1);
    const server = app.listen(0);
    const testIp = '10.0.0.8';

    try {
      const res1 = await makeRequest(server, '/api/test', testIp);
      const res2 = await makeRequest(server, '/api/users', testIp);
      const res3 = await makeRequest(server, '/api/products', testIp);
      const res4 = await makeRequest(server, '/api/test', testIp);

      if (res1.status !== 200 || res2.status !== 200 || res3.status !== 200) {
        throw new Error(`Initial 3 requests across routes failed`);
      }
      if (res4.status !== 429) {
        throw new Error(`4th request across shared route limiter was not blocked (got ${res4.status})`);
      }
    } finally {
      server.close();
    }
  });

  // Test 9: Redis Key TTL Expiration Check
  await assertTest('9. Key TTL: Redis keys have TTL configured to prevent memory leaks', async () => {
    const app = createTestApp(5, 1);
    const server = app.listen(0);
    const testIp = '10.0.0.9';

    try {
      await makeRequest(server, '/api/test', testIp);
      const ttlToken = await redis.ttl(`ratelimit:${testIp}:token`);
      const ttlTime = await redis.ttl(`ratelimit:${testIp}:last_refill_time`);

      if (ttlToken <= 0 || ttlTime <= 0) {
        throw new Error(`Expected keys to have positive TTL, got token TTL: ${ttlToken}, time TTL: ${ttlTime}`);
      }
    } finally {
      server.close();
    }
  });

  // Test 10: Fallback for missing IP
  await assertTest('10. IP Fallback: Works properly when IP headers are default/empty', async () => {
    const app = createTestApp(2, 0.1);
    const server = app.listen(0);

    try {
      const res = await makeRequest(server, '/api/test', '');
      if (res.status !== 200) {
        throw new Error(`Expected 200 for default IP fallback, got ${res.status}`);
      }
    } finally {
      server.close();
    }
  });

  console.log('\n======================================================');
  console.log(`  ALL TESTS COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================');

  await redis.quit();
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
