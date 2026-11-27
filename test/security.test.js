import dns from "node:dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {}
import test from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { MongoClient } from "mongodb";
import { DateTime } from "luxon";
import { makeApp } from "../server/app.js";

test("security regression suite", async (t) => {
  const instance = process.env.TEST_MONGO_URI
    ? null
    : await MongoMemoryReplSet.create({
        replSet: { count: 1, args: ["--nounixsocket"] },
        binary: { version: "7.0.24" },
      });
  const client = new MongoClient(
    process.env.TEST_MONGO_URI || instance.getUri(),
  );
  await client.connect();
  const db = client.db("playon_sec_test_" + Date.now());
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.dropDatabase();
    await client.close();
    await instance?.stop();
  });

  const app = await makeApp(db, {
    DEMO_SEED: "false",
    LOGIN_RATE_LIMIT: "4",
    MAX_UNPAID_HOLDS: "2",
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const url = baseUrl + "/api";

  async function req(path, body, { token, headers = {} } = {}) {
    const form = body instanceof FormData;
    return fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { cookie: token } : {}),
        ...(!form && body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body: form ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const cookie = (r) => r.headers.get("set-cookie").split(";")[0];

  await t.test("no hardcoded fallback admin account is seeded", async () => {
    const fallback = await db
      .collection("users")
      .findOne({ email: "admin@playon.com" });
    assert.equal(fallback, null);
  });

  await t.test("signup ignores role injection and enforces player role", async () => {
    const res = await req("/register", {
      name: "Attacker",
      email: "attacker@example.test",
      password: "StrongPassword123!",
      role: "admin",
      isAdmin: true,
    });
    assert.equal(res.status, 200);
    const user = await res.json();
    assert.equal(user.role, "player");
    const token = cookie(res);

    for (const adminPath of [
      "/admin/day?date=2026-12-01",
      "/admin/queue",
      "/admin/players",
      "/admin/finance?from=2026-12-01&to=2026-12-01",
    ]) {
      const denied = await req(adminPath, undefined, { token });
      assert.equal(denied.status, 403);
      const unauth = await req(adminPath);
      assert.equal(unauth.status, 403);
    }
  });

  await t.test("security headers, CSRF origin check, and malformed JSON body handling", async () => {
    const cfg = await req("/config");
    assert.equal(cfg.headers.get("x-content-type-options"), "nosniff");
    assert.equal(cfg.headers.get("x-frame-options"), "DENY");
    assert.equal(cfg.headers.get("x-powered-by"), null);
    assert.match(cfg.headers.get("content-security-policy"), /frame-ancestors 'none'/);

    const nullOrigin = await req(
      "/login",
      { email: "a@b.test", password: "x" },
      { headers: { origin: "null" } },
    );
    assert.equal(nullOrigin.status, 403);

    const evilOrigin = await req(
      "/login",
      { email: "a@b.test", password: "x" },
      { headers: { origin: "https://evil.example" } },
    );
    assert.equal(evilOrigin.status, 403);

    const nullBody = await fetch(url + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(nullBody.status, 400);

    const arrayBody = await fetch(url + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    assert.equal(arrayBody.status, 400);
  });

  await t.test("NoSQL operator injection on login is rejected", async () => {
    const res = await req("/login", {
      email: { $ne: "" },
      password: { $ne: "" },
    });
    assert.equal(res.status, 401);
  });

  await t.test("login rate limiting triggers 429 after threshold", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await req("/login", {
        email: "brute@example.test",
        password: "wrong",
      });
      assert.equal(r.status, 401);
    }
    const blocked = await req("/login", {
      email: "brute@example.test",
      password: "wrong",
    });
    assert.equal(blocked.status, 429);
  });

  await t.test("price/duration tampering, hold cap, PII removal, and upload validation", async () => {
    const reg = await req("/register", {
      name: "Legit Player",
      email: "legit@example.test",
      password: "StrongPassword123!",
    });
    assert.equal(reg.status, 200);
    const token = cookie(reg);

    const reg2 = await req("/register", {
      name: "Other Player",
      email: "other2@example.test",
      password: "StrongPassword123!",
    });
    const otherToken = cookie(reg2);

    const date = DateTime.now().setZone("Asia/Karachi").plus({ days: 4 }).toISODate();
    const farDate = DateTime.now().setZone("Asia/Karachi").plus({ days: 400 }).toISODate();

    // Tampered price
    const badPrice = await req(
      "/hold",
      {
        court: "cricket-indoor",
        date,
        start: 600,
        end: 660,
        quotedTotal: 1,
        name: "Legit Player",
        phone: "03001234567",
      },
      { token },
    );
    assert.equal(badPrice.status, 409);

    // Negative / short duration
    const badDur = await req(
      "/hold",
      {
        court: "cricket-indoor",
        date,
        start: 600,
        end: 540,
        quotedTotal: -2000,
        name: "Legit Player",
        phone: "03001234567",
      },
      { token },
    );
    assert.equal(badDur.status, 400);

    // Far future date
    const tooFar = await req(
      "/hold",
      {
        court: "cricket-indoor",
        date: farDate,
        start: 600,
        end: 660,
        quotedTotal: 2000,
        name: "Legit Player",
        phone: "03001234567",
      },
      { token },
    );
    assert.equal(tooFar.status, 400);

    // Create 2 valid holds (MAX_UNPAID_HOLDS = 2)
    const h1 = await req(
      "/hold",
      {
        court: "cricket-indoor",
        date,
        start: 600,
        end: 660,
        quotedTotal: 2000,
        name: "Secret Name",
        phone: "03001234567",
      },
      { token },
    );
    assert.equal(h1.status, 201);
    const b1 = await h1.json();

    const h2 = await req(
      "/hold",
      {
        court: "cricket-indoor",
        date,
        start: 660,
        end: 720,
        quotedTotal: 2000,
        name: "Secret Name",
        phone: "03001234567",
      },
      { token },
    );
    assert.equal(h2.status, 201);

    // 3rd unpaid hold is blocked
    const h3 = await req(
      "/hold",
      {
        court: "cricket-indoor",
        date,
        start: 720,
        end: 780,
        quotedTotal: 2000,
        name: "Secret Name",
        phone: "03001234567",
      },
      { token },
    );
    assert.equal(h3.status, 400);

    // Public availability must not leak player name
    const avail = await req("/availability?court=cricket-indoor&date=" + date);
    const availJson = await avail.json();
    assert.equal(availJson.booked.length, 2);
    assert.equal(availJson.booked[0].name, undefined);

    // IDOR check on receipt & invoice
    const idorInvoice = await req("/bookings/" + b1.id + "/invoice", undefined, {
      token: otherToken,
    });
    assert.equal(idorInvoice.status, 403);

    // Disguised SVG/HTML upload rejected by magic-byte check
    const badForm = new FormData();
    badForm.set(
      "receipt",
      new Blob(["<svg onload=alert(1)></svg>"], { type: "image/png" }),
      "evil.png",
    );
    const badUpload = await req("/bookings/" + b1.id + "/receipt", badForm, { token });
    assert.equal(badUpload.status, 400);
  });
});
