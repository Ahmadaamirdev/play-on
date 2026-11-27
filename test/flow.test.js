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
test("venue workflow with real MongoDB", async (t) => {
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
  const db = client.db("playon_test_" + Date.now());
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.dropDatabase();
    await client.close();
    await instance?.stop();
  });
  const app = await makeApp(db, { DEMO_SEED: "true" });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port + "/api";
  async function request(path, body, token) {
    const form = body instanceof FormData;
    return fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { cookie: token } : {}),
        ...(!form && body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: form ? body : JSON.stringify(body),
    });
  }
  const cookie = (r) => r.headers.get("set-cookie").split(";")[0];
  async function json(path, body, token) {
    const r = await request(path, body, token);
    const data = await r.json();
    assert.ok(r.ok, JSON.stringify(data));
    return data;
  }
  const player = cookie(
      await request("/login", {
        email: "player@playon.test",
        password: "PlayOnDemo2026!",
      }),
    ),
    admin = cookie(
      await request("/login", {
        email: "admin@playon.test",
        password: "PlayOnDemo2026!",
      }),
    ),
    other = cookie(
      await request("/register", {
        email: "other@example.test",
        password: "longpassword",
        name: "Second Player",
      }),
    );
  const now = DateTime.now().setZone("Asia/Karachi"),
    date = now.plus({ days: 3 }).toISODate(),
    today = now.toISODate(),
    court = "cricket-indoor";
  const base = {
    court,
    date,
    start: 600,
    duration: 90,
    name: "Test Player",
    phone: "03001234567",
    quotedTotal: 3000,
  };
  await t.test("staff sign-in accepts staff accounts only", async () => {
    const credentials = { password: "PlayOnDemo2026!", staff: true };
    const denied = await request("/login", { ...credentials, email: "player@playon.test" });
    assert.equal(denied.status, 401);
    const signedIn = await json("/login", { ...credentials, email: "admin@playon.test" });
    assert.equal(signedIn.role, "admin");
  });
  const slots = () =>
    json("/slots?" + new URLSearchParams({ date, court, duration: 90 }));
  const free = async (start) =>
    (await slots()).slots.find((s) => s.start === start).open;
  await t.test("next available slot skips closed days and handles a missing schedule", async () => {
    const start = now.plus({ days: 90 });
    for (let offset = 0; offset < 2; offset++) {
      await json("/admin/closure", { date: start.plus({ days: offset }).toISODate(), scope: court }, admin);
    }
    const result = await json("/slots?" + new URLSearchParams({ date: start.toISODate(), court, duration: 60 }));
    assert.deepEqual(result.next, { date: start.plus({ days: 2 }).toISODate(), start: 360 });
  });
  const receipt = () => {
    const f = new FormData();
    f.set(
      "receipt",
      new Blob(
        [
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKpMAAAAASUVORK5CYII=",
            "base64",
          ),
        ],
        { type: "image/png" },
      ),
      "payment.png",
    );
    return f;
  };
  let booking, vip, independentBooking;
  await t.test(
    "quote, concurrent overlapping holds and independent court",
    async () => {
      assert.equal((await slots()).total, 3000);
      const [a, b, c] = await Promise.all([
        request("/hold", base, player),
        request("/hold", { ...base, start: 630 }, other),
        request("/hold", { ...base, court: "cricket-outdoor" }, other),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409]);
      assert.equal(c.status, 201);
      booking = await (a.ok ? a : b).json();
      independentBooking = await c.json();
      assert.match(booking.id, /^PO-[0-9]{6}$/);
      assert.match(independentBooking.id, /^PO-[0-9]{6}$/);
      assert.notEqual(booking.id, independentBooking.id);
      booking.token = a.ok ? player : other;
      assert.equal(await free(630), false);
      assert.equal(
        (
          await request(
            "/admin/vip",
            { ...base, start: 630, paymentType: "Paid" },
            admin,
          )
        ).status,
        409,
      );
    },
  );
  await t.test(
    "receipt ownership and pending hold persists",
    async () => {
      const owner = booking.token,
        foreign = owner === player ? other : player;
      assert.equal(
        (
          await request(
            "/bookings/" + booking.id + "/receipt",
            receipt(),
            foreign,
          )
        ).status,
        403,
      );
      await json("/bookings/" + booking.id + "/receipt", receipt(), owner);
      assert.equal(
        (
          await request(
            "/bookings/" + booking.id + "/receipt",
            undefined,
            foreign,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/bookings/" + booking.id + "/receipt",
            undefined,
            admin,
          )
        ).headers.get("content-type"),
        "image/png",
      );
      assert.equal(
        (
          await request(
            "/bookings/" + booking.id + "/invoice",
            undefined,
            owner,
          )
        ).status,
        409,
      );
      const original = (await json("/mine", undefined, owner)).find(b => b.id === booking.id);
      const duplicate = { ...original, owner: "another-player", receipt: "other-receipt" };
      const days = db.collection("days");
      await days.updateOne({ _id: date }, { $push: { bookings: { $each: [duplicate], $position: 0 } } });
      try {
        const path = "/bookings/" + booking.id + "/receipt?" +
          new URLSearchParams({ date, receipt: original.receipt });
        assert.equal((await request(path, undefined, owner)).status, 200);
        assert.equal((await request(path, undefined, foreign)).status, 403);
      } finally {
        await days.updateOne({ _id: date }, { $pull: { bookings: { receipt: duplicate.receipt } } });
      }
      assert.equal(await free(630), false);
      assert.equal(
        (await json("/mine", undefined, owner)).find((b) => b.id === booking.id)
          .status,
        "Pending verification",
      );
      assert.ok(
        !(await json("/mine", undefined, foreign)).some(
          (b) => b.id === booking.id,
        ),
      );
    },
  );
  await t.test(
    "price snapshots, approval, invoice and single-use check-in",
    async () => {
      assert.equal(
        (
          await request(
            "/admin/rates",
            { sport: "Cricket", rate: 3000 },
            player,
          )
        ).status,
        403,
      );
      await json("/admin/rates", { sport: "Cricket", rate: 3000 }, admin);
      assert.equal((await slots()).total, 4500);
      await json("/admin/rates", { court: "cricket-outdoor", rate: 4000 }, admin);
      const outdoorAvailability = await json("/availability?" + new URLSearchParams({ court: "cricket-outdoor", date }));
      assert.equal(outdoorAvailability.rate, 4000);
      const availability = await json("/availability?" + new URLSearchParams({ court, date }));
      assert.equal(availability.rate, 3000);
      const queue = await json("/admin/queue", undefined, admin);
      assert.equal(queue.find(b => b.id === booking.id).total, 3000);
      await json("/admin/review/" + booking.id, { decision: "Approve" }, admin);
      const playerBookings = await json("/mine", undefined, booking.token);
      const staffSchedule = await json("/admin/day?date=" + date, undefined, admin);
      const confirmed = playerBookings.find((b) => b.id === booking.id);
      assert.equal(confirmed.status, "Confirmed");
      assert.equal(confirmed.total, 3000);
      assert.deepEqual(staffSchedule.bookings.find((b) => b.id === booking.id), confirmed);
      assert.equal(
        (
          await request(
            "/admin/review/" + booking.id,
            { decision: "Approve" },
            admin,
          )
        ).status,
        409,
      );
      const url = "/bookings/" + booking.id + "/invoice",
        pdf = await request(url, undefined, booking.token);
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.equal(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 5)
          .toString(),
        "%PDF-",
      );
      assert.equal(
        (
          await request(
            url,
            undefined,
            booking.token === player ? other : player,
          )
        ).status,
        403,
      );
      assert.equal(
        (await json("/admin/check/" + booking.id, undefined, admin)).phone,
        base.phone,
      );
      assert.ok((await json("/admin/check/" + booking.id, {}, admin)).checked);
      assert.equal(
        (await request("/admin/check/" + booking.id, {}, admin)).status,
        409,
      );
    },
  );
  await t.test("persistent hold, rejection and reopened availability", async () => {
    const x = await json(
      "/hold",
      { ...base, start: 900, quotedTotal: 4500 },
      player,
    );
    assert.equal(x.expires, undefined);
    assert.equal(await free(900), false);
    assert.equal((await request("/admin/review/" + x.id, { decision: "Approve" }, admin)).status, 409);
    await json("/admin/review/" + x.id, { decision: "Reject", reason: "No payment" }, admin);
    assert.ok(await free(900));
    const y = await json(
      "/hold",
      { ...base, start: 900, quotedTotal: 4500 },
      player,
    );
    await json("/bookings/" + y.id + "/receipt", receipt(), player);
    assert.equal(
      (
        await request(
          "/admin/review/" + y.id,
          { decision: "Reject", reason: "" },
          admin,
        )
      ).status,
      400,
    );
    await json(
      "/admin/review/" + y.id,
      { decision: "Reject", reason: "Amount differs" },
      admin,
    );
    assert.ok(await free(900));
    assert.equal(
      (await json("/mine", undefined, player)).find((b) => b.id === y.id)
        .reason,
      "Amount differs",
    );
  });
  await t.test(
    "VIP, conflict resolution, closure scope and finance by verification date",
    async () => {
      vip = await json(
        "/admin/vip",
        { ...base, start: 900, paymentType: "Paid" },
        admin,
      );
      await json(
        "/admin/vip",
        {
          ...base,
          court: "tennis-indoor",
          start: 900,
          paymentType: "Complimentary",
        },
        admin,
      );
      const blocked = await request(
        "/admin/closure",
        { date, scope: "All" },
        admin,
      );
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).affected.length, 4);
      await json("/admin/review/" + independentBooking.id, { decision: "Reject", reason: "Unpaid" }, admin);
      await json(
        "/admin/move/" + vip.id,
        { court: "cricket-outdoor", start: 900 },
        admin,
      );
      await json(
        "/admin/move/" + vip.id,
        { court: "cricket-indoor", start: 930 },
        admin,
      );
      await json("/admin/closure", { date, scope: "cricket-outdoor" }, admin);
      assert.equal(
        (
          await request(
            "/hold",
            { ...base, court: "cricket-outdoor", quotedTotal: 4500 },
            player,
          )
        ).status,
        409,
      );
      assert.ok(await free(1080));
      await json("/admin/closure", { date, scope: "Padel" }, admin);
      const finance = await json(
        "/admin/finance?from=" + today + "&to=" + today,
        undefined,
        admin,
      );
      const scheduled = await json("/admin/finance?" + new URLSearchParams({
        from: date, to: date, basis: "booking",
      }), undefined, admin);
      assert.equal(scheduled.total, 7500);
      const demoPaid = finance.paid.filter((b) => b.demoSample);
      const demoComplimentary = finance.complimentary.filter((b) => b.demoSample);
      assert.ok(demoPaid.length > 0);
      assert.equal(finance.total, 7500 + demoPaid.reduce((sum, b) => sum + b.total, 0));
      assert.equal(finance.paid.length - demoPaid.length, 2);
      assert.equal(finance.complimentary.length - demoComplimentary.length, 1);
      assert.equal(
        (
          await json(
            "/admin/finance?from=" + date + "&to=" + date,
            undefined,
            admin,
          )
        ).total,
        0,
      );
      const another = now.plus({ days: 4 }).toISODate();
      await json(
        "/admin/move/" + vip.id,
        { court: "cricket-outdoor", date: another, start: 900 },
        admin,
      );
      assert.equal(
        (await json("/admin/check/" + vip.id, undefined, admin)).date,
        another,
      );
      await json(
        "/admin/move/" + vip.id,
        { court: "cricket-indoor", date, start: 900 },
        admin,
      );
      await json("/admin/closure", { date: another, scope: "All" }, admin);
      assert.equal(
        (await json("/admin/day?date=" + another, undefined, admin)).closed
          .length,
        6,
      );
    },
  );
  await t.test("custom time ranges enforce phone length and allow adjacent bookings", async () => {
    const targetDate = now.plus({ days: 5 }).toISODate();
    const range = { ...base, date: targetDate, start: 603, end: 663, quotedTotal: 3000 };
    for (const phone of ["0300123456", "030012345678", "0300-123456", 30012345678]) {
      const invalid = await request("/hold", { ...range, phone }, player);
      assert.equal(invalid.status, 400);
      assert.match((await invalid.json()).message, /11-digit/);
    }
    const reversed = await request("/hold", { ...range, end: 602 }, player);
    assert.equal(reversed.status, 400);
    const short = await request("/hold", { ...range, end: 662 }, player);
    assert.equal(short.status, 400);
    assert.match((await short.json()).message, /at least 60 minutes/);

    const booking = await json("/hold", range, player);
    assert.equal(booking.duration, 60);
    assert.equal(booking.total, 3000);
    const availability = await json("/availability?" + new URLSearchParams({ court, date: targetDate }));
    assert.deepEqual(availability.booked, [{ start: 603, end: 663, state: "On hold" }]);

    const vip = { ...range, start: 662, end: 722, paymentType: "Complimentary" };
    const overlap = await request("/admin/vip", vip, admin);
    assert.equal(overlap.status, 409);
    const adjacent = await json("/admin/vip", { ...vip, start: 663, end: 723 }, admin);
    assert.equal(adjacent.duration, 60);
    const midnight = await json("/hold", { ...range, start: 1380, end: 1440, quotedTotal: 3000 }, player);
    assert.equal(midnight.duration, 60);
  });
  await t.test("existing invoice booking IDs still resolve", async () => {
    const legacyDate = now.plus({ days: 6 }).toISODate();
    const legacyId = "PO-0123456789ABCDEF";
    const original = await json("/admin/check/" + booking.id, undefined, admin);
    await db.collection("days").insertOne({
      _id: legacyDate,
      revision: 1,
      closed: [],
      bookings: [{ ...original, id: legacyId, date: legacyDate }],
    });
    assert.equal((await json("/admin/check/" + legacyId, undefined, admin)).id, legacyId);
    const invoice = await request("/bookings/" + legacyId + "/invoice", undefined, admin);
    assert.equal(invoice.status, 200);
    assert.match(invoice.headers.get("content-disposition"), new RegExp(legacyId));
    await invoice.arrayBuffer();
  });
});
