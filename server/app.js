import express from "express";
import { ensureScheduleSchema } from "./schedule-schema.js";
import multer from "multer";
import { DateTime } from "luxon";
import { ObjectId } from "mongodb";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { bookingTotal, closingTime, openingTime, time } from "../booking.js";
const derive = promisify(scrypt);
const digest = (s) => createHash("sha256").update(s).digest("hex");
const sports = ["Cricket", "Tennis", "Padel"];
const courts = sports.flatMap((sport) =>
  ["Indoor", "Outdoor"].map((type) => ({
    id: sport.toLowerCase() + "-" + type.toLowerCase(),
    sport,
    type,
    name: type + " " + sport + " Court",
  })),
);
const fail = (status, message, extra = {}) => {
  throw Object.assign(new Error(message), { status, extra });
};
const check = (ok, msg) => {
  if (!ok) fail(400, msg);
};
const active = (b) =>
  ["Confirmed", "VIP", "Pending verification"].includes(b.status) ||
  (b.status === "Awaiting payment" && (b.expires == null || b.expires > Date.now()));
const view = (b) =>
  b.status === "Awaiting payment" && !active(b)
    ? { ...b, status: "Expired" }
    : b;
const overlaps = (b, start, duration) =>
  active(b) && b.start < start + duration && b.start + b.duration > start;
const courtBy = (id) =>
  courts.find((c) => c.id === id) || fail(400, "Choose a valid court.");
const clean = (s, max = 100) =>
  typeof s === "string" && s.trim().length <= max ? s.trim() : "";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
});
export async function makeApp(db, env = process.env) {
  const zone = env.VENUE_TIMEZONE || "Asia/Karachi",
    currency = env.CURRENCY || "PKR",
    venue = env.VENUE_NAME || "Play On Sports Club";
  check(
    DateTime.now().setZone(zone).isValid,
    "Invalid venue configuration.",
  );
  const now = () => DateTime.now().setZone(zone),
    today = () => now().toISODate();
  const day = (s) => {
    check(
      typeof s === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        DateTime.fromISO(s, { zone }).isValid,
      "Choose a valid date.",
    );
    return s;
  };
  const firstStart = (date) => {
    const current = now();
    const currentDate = current.toISODate();
    if (day(date) < currentDate) return closingTime;
    if (date > currentDate) return openingTime;
    return Math.max(openingTime, current.hour * 60 + current.minute + 1);
  };
  const days = db.collection("days"),
    users = db.collection("users"),
    sessions = db.collection("sessions"),
    receipts = db.collection("receipts"),
    settings = db.collection("settings");
  await ensureScheduleSchema(db);
  // Keep outstanding legacy holds without reviving slots already released.
  const cutoff = Date.now();
  await Promise.all([
    days.updateMany(
      { bookings: { $elemMatch: { status: "Awaiting payment", expires: { $gt: cutoff } } } },
      { $unset: { "bookings.$[held].expires": "" }, $inc: { revision: 1 } },
      { arrayFilters: [{ "held.status": "Awaiting payment", "held.expires": { $gt: cutoff } }] },
    ),
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ until: 1 }, { expireAfterSeconds: 0 }),
    days.createIndexes([{ key: { "bookings.id": 1 } }, { key: { "bookings.owner": 1 } }]),
    settings.updateOne(
      { _id: "rates" },
      { $setOnInsert: { Cricket: 2000, Tennis: 1600, Padel: 3000 } },
      { upsert: true },
    ),
  ]);
  async function account(email, password, name, role) {
    const salt = randomBytes(16).toString("hex"),
      hash = (await derive(password, salt, 64)).toString("hex");
    return { email, name, role, salt, hash };
  }
  if (env.DEMO_SEED === "true") {
    for (const [role, name] of [
      ["player", "Demo Player"],
      ["admin", "Venue Staff"],
    ]) {
      const email = role + "@playon.test";
      if (!(await users.findOne({ email })))
        await users.updateOne(
          { email },
          {
            $setOnInsert: await account(
              email,
              env.DEMO_PASSWORD || "PlayOnDemo2026!",
              name,
              role,
            ),
          },
          { upsert: true },
        );
    }
  }
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const email = env.ADMIN_EMAIL.trim().toLowerCase();
    const adminAcc = await account(email, env.ADMIN_PASSWORD, "Venue Staff", "admin");
    await users.updateOne(
      { email },
      { $set: { hash: adminAcc.hash, salt: adminAcc.salt, role: "admin", name: "Venue Staff" } },
      { upsert: true },
    );
  } else {
    const defaultEmail = "admin@playon.com";
    if (!(await users.findOne({ email: defaultEmail }))) {
      await users.insertOne(
        await account(defaultEmail, "PlayOnAdmin2026!", "Venue Staff", "admin"),
      );
    }
  }
  const rates = async () => {
    const r = await settings.findOne({ _id: "rates" });
    return Object.fromEntries(courts.map((court) => [court.id, r.courtRates?.[court.id] ?? r[court.sport]]));
  };
  const empty = (date) => ({
    _id: date,
    revision: 0,
    bookings: [],
    closed: [],
  });
  const readDay = async (date) =>
    (await days.findOne({ _id: day(date) })) || empty(date);
  // All availability decisions for a venue date are retried against the winning revision.
  async function change(date, fn) {
    for (let i = 0; i < 80; i++) {
      const d = await readDay(date),
        rev = d.revision,
        result = fn(d);
      d.revision++;
      try {
        const r = await days.replaceOne({ _id: date, revision: rev }, d, {
          upsert: rev === 0,
        });
        if (r.modifiedCount || r.upsertedCount) return result;
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
    }
    fail(409, "The schedule is busy. Refresh and retry.");
  }
  function interval(date, start, duration) {
    check(
      Number.isInteger(start) &&
        start >= openingTime &&
        Number.isInteger(duration) &&
        duration > 0 &&
        start + duration <= closingTime,
      "Choose an end time after the start within operating hours (6:00 AM to midnight).",
    );
    check(start >= firstStart(date), "Choose a future start time.");
  }
  function available(d, id, start, duration, skip) {
    return (
      !d.closed.includes(id) &&
      !d.bookings.some(
        (b) => b.id !== skip && b.court === id && overlaps(b, start, duration),
      )
    );
  }
  if (env.DEMO_SEED === "true") {
    const date = today();
    if (!(await readDay(date)).outdoorPlayersSeeded) {
      const names = ["Ayan Malik", "Hira Ali", "Sara Khan", "Zain Ahmed", "Nida Shah", "Omar Aziz"];
      const hourlyRates = await rates();
      const demoPlayer = await users.findOne({ email: "player@playon.test" });
      await change(date, (d) => {
        if (d.outdoorPlayersSeeded) return;
        function addSample(court, index, regular) {
          const duration = 60;
          const preferred = openingTime + 60 * (index + (regular ? 8 : 2));
          const starts = Array.from({ length: (closingTime - openingTime) / 30 - 1 },
            (_, i) => openingTime + i * 30);
          const start = [preferred, ...starts].find((minute) => available(d, court.id, minute, duration));
          if (start === undefined) return;
          d.bookings.push({
            id: "PO-DEMO-" + date.replaceAll("-", "") + "-" + (index + 1) + (regular ? "-P" : ""),
            owner: regular ? demoPlayer._id.toString() : null,
            name: regular ? ["Raza Ali", "Mina Noor", "Ali Shah"][Math.floor(index / 2)] : names[index], phone: "00000000000",
            court: court.id, sport: court.sport, date, start, duration,
            status: regular ? "Confirmed" : "VIP", paymentType: regular ? "Transfer" : "Complimentary",
            rate: hourlyRates[court.id], total: regular ? bookingTotal(hourlyRates[court.id], duration) : 0, created: Date.now(), verified: Date.now(), demoSample: true,
          });
        }
        courts.forEach((court, index) => {
          if (!d.sampleCourtsSeeded) addSample(court, index, false);
          if (court.type === "Outdoor") addSample(court, index, true);
        });
        d.outdoorPlayersSeeded = true;
        d.sampleCourtsSeeded = true;
      });
    }
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      const originHost = new URL(req.headers.origin).host;
      const host = req.headers.host;
      const forwardedHost = req.headers["x-forwarded-host"];
      if (originHost !== host && originHost !== forwardedHost)
        fail(403, "Cross-origin request denied.");
    }
    // Both reads expose the same public court data for every visitor.
    if (req.method === "GET" && ["/availability", "/slots"].includes(req.path)) return next();
    const token = (req.headers.cookie || "").match(
      /(?:^|;\s*)playon=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    const session =
      token &&
      (await sessions.findOne({
        _id: digest(token),
        until: { $gt: new Date() },
      }));
    if (
      session &&
      (env.DEMO_SEED === "true" ||
        !["player@playon.test", "admin@playon.test"].includes(
          session.user.email,
        ))
    ) {
      req.user = session.user;
      req.sessionId = session._id;
    }
    next();
  });
  const auth = (req, res, next) =>
    req.user ? next() : fail(401, "Sign in to continue.");
  const staff = (req, res, next) =>
    req.user?.role === "admin" ? next() : fail(403, "Staff access required.");
  async function login(req, res, u) {
    const token = randomBytes(32).toString("hex"),
      user = {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
      };
    await sessions.insertOne({
      _id: digest(token),
      user,
      until: new Date(Date.now() + 86400000),
    });
    res.cookie("playon", token, {
      httpOnly: true,
      sameSite: "strict",
      secure:
        env.SECURE_COOKIE === "true" ||
        (Boolean(env.VERCEL) && env.SECURE_COOKIE !== "false"),
      maxAge: 86400000,
    });
    res.json(user);
  }
  app.get("/api/config", async (req, res) =>
    res.json({
      courts,
      rates: await rates(),
      zone,
      currency,
      venue,
      today: today(),
      payment:
        env.PAYMENT_INSTRUCTIONS ||
        "Demo venue only. Upload a sample receipt to try the verification flow.",
      demo:
        env.DEMO_SEED === "true" &&
        (!env.DEMO_PASSWORD || env.DEMO_PASSWORD === "PlayOnDemo2026!"),
      user: req.user || null,
    }),
  );
  app.post("/api/login", async (req, res) => {
    const email = clean(req.body.email).toLowerCase(),
      p = clean(req.body.password, 160);
    const u = await users.findOne({ email });
    if (
      !u ||
      (env.DEMO_SEED !== "true" &&
        ["player@playon.test", "admin@playon.test"].includes(email)) ||
      !timingSafeEqual(await derive(p, u.salt, 64), Buffer.from(u.hash, "hex"))
    )
      fail(401, "Check your email and password.");
    if (typeof req.body.staff === "boolean" &&
        u.role !== (req.body.staff ? "admin" : "player")) {
      fail(401, u.role === "admin"
        ? "This account uses Staff sign in."
        : "This account uses Player sign in.");
    }
    await login(req, res, u);
  });
  app.post("/api/register", async (req, res) => {
    const email = clean(req.body.email).toLowerCase(),
      p = clean(req.body.password, 160),
      name = clean(req.body.name);
    check(
      name && /^\S+@\S+\.\S+$/.test(email) && p.length >= 10,
      "Enter your name, email and a password of at least 10 characters.",
    );
    const u = await account(email, p, name, "player");
    try {
      await users.insertOne(u);
    } catch (e) {
      if (e.code === 11000) fail(409, "That email is registered.");
      throw e;
    }
    await login(req, res, u);
  });
  app.post("/api/logout", async (req, res) => {
    if (req.sessionId) await sessions.deleteOne({ _id: req.sessionId });
    res.clearCookie("playon").json({ ok: true });
  });
  app.get("/api/availability", async (req, res) => {
    const { court, date } = req.query;
    courtBy(court);
    const [schedule, hourlyRates] = await Promise.all([readDay(date), rates()]);
    const booked = schedule.bookings
      .filter((b) => b.court === court && active(b))
      .map((b) => ({ start: b.start, end: b.start + b.duration, name: b.name,
        state: ["Awaiting payment", "Pending verification"].includes(b.status) ? "On hold" : "Booked" }))
      .sort((a, b) => a.start - b.start);
    res.json({
      court,
      date,
      booked,
      closed: schedule.closed.includes(court),
      firstStart: firstStart(date),
      rate: hourlyRates[court],
    });
  });
  app.get("/api/slots", async (req, res) => {
    const { court, date } = req.query,
      c = courtBy(court),
      duration = Number(req.query.duration);
    check([60, 90, 120].includes(duration), "Invalid duration.");
    const [hourlyRates, schedule] = await Promise.all([rates(), readDay(date)]);
    const rate = hourlyRates[c.id];
    const list = (d) => {
      const earliest = firstStart(d._id);
      return Array.from(
        { length: Math.floor((closingTime - duration - openingTime) / 30) + 1 },
        (_, i) => openingTime + i * 30,
      ).map((start) => ({
        start,
        open: start >= earliest && available(d, court, start, duration),
      }));
    };
    const slots = list(schedule);
    let next = null;
    if (!slots.some((s) => s.open)) {
      const anchor = DateTime.fromISO(date, { zone });
      const dates = Array.from({ length: 30 }, (_, i) => anchor.plus({ days: i + 1 }).toISODate());
      const upcoming = await days.find({ _id: { $gte: dates[0], $lte: dates[29] } }, {
        projection: { closed: 1, bookings: { $filter: { input: "$bookings", as: "b", cond: { $eq: ["$$b.court", court] } } } },
      }).toArray();
      const byDate = new Map(upcoming.map(d => [d._id, d]));
      for (const nd of dates) {
        const candidate = byDate.get(nd) || empty(nd);
        if (candidate.closed.includes(court)) continue;
        const s = list(candidate).find(slot => slot.open);
        if (s) {
          next = { date: nd, start: s.start };
          break;
        }
      }
    }
    res.json({ slots, next, rate, total: bookingTotal(rate, duration) });
  });
  async function reserve(req, res, vip = false) {
    const { date, start, end, court, quotedTotal, phone } = req.body,
      c = courtBy(court),
      name = clean(req.body.name);
    check(name, "Enter the full name.");
    check(
      typeof phone === "string" && /^[0-9]{11}$/.test(phone),
      "Enter an 11-digit mobile number.",
    );
    check(end === undefined || Number.isInteger(end), "Choose a valid end time.");
    const duration = end === undefined ? req.body.duration : end - start;
    interval(date, start, duration);
    check(duration >= 60, "Bookings must be at least 60 minutes.");
    const rate = (await rates())[c.id],
      total = bookingTotal(rate, duration);
    if (!vip && quotedTotal !== total)
      fail(409, "Pricing changed. Refresh the quote before continuing.");
    if (vip)
      check(
        ["Paid", "Complimentary"].includes(req.body.paymentType),
        "Choose the VIP payment type.",
      );
    const { sequence } = await settings.findOneAndUpdate(
      { _id: "bookingSequence" },
      { $inc: { sequence: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    const b = {
      id: "PO-" + String(sequence).padStart(6, "0"),
      owner: vip ? null : req.user.id,
      name,
      phone,
      court,
      sport: c.sport,
      date,
      start,
      duration,
      rate,
      total: vip && req.body.paymentType === "Complimentary" ? 0 : total,
      status: vip ? "VIP" : "Awaiting payment",
      paymentType: vip ? req.body.paymentType : "Transfer",
      created: Date.now(),
      ...(vip ? { verified: Date.now() } : {}),
    };
    await change(date, (d) => {
      check(start >= firstStart(date), "Choose a future start time.");
      if (!available(d, court, start, duration))
        fail(409, "That interval is unavailable. Choose another time.");
      d.bookings.push(b);
    });
    res.status(201).json(b);
  }
  app.post("/api/hold", auth, (q, s) => reserve(q, s));
  app.post("/api/admin/vip", staff, (q, s) => reserve(q, s, true));
  async function record(id) {
    const d = await days.findOne({ "bookings.id": id });
    if (!d) fail(404, "Booking not found.");
    return d.bookings.find((b) => b.id === id);
  }
  async function receiptBooking(req) {
    const match = { id: req.params.id };
    if (req.user.role !== "admin") match.owner = req.user.id;
    if (req.query.receipt !== undefined) {
      check(typeof req.query.receipt === "string", "Invalid receipt.");
      match.receipt = req.query.receipt;
    }
    const query = { bookings: { $elemMatch: match } };
    if (req.query.date !== undefined) query._id = day(req.query.date);
    const doc = await days.findOne(query, { projection: { bookings: { $elemMatch: match } } });
    if (!doc) fail(403, "Access denied.");
    return doc.bookings[0];
  }
  const owned = (req, b) => {
    if (b.owner !== req.user.id && req.user.role !== "admin")
      fail(403, "Access denied.");
  };
  async function bookingHistory(owner) {
    const ds = await days.find({ "bookings.owner": owner }, {
      projection: { _id: 0, bookings: { $filter: { input: "$bookings", as: "b", cond: { $eq: ["$$b.owner", { $literal: owner }] } } } },
    }).toArray();
    return ds.flatMap((d) => d.bookings.map(view))
      .sort((a, b) => b.created - a.created);
  }
  app.get("/api/mine", auth, async (req, res) => res.json(await bookingHistory(req.user.id)));
  const playerProfile = { name: 1, email: 1 };
  app.get("/api/admin/players", staff, async (req, res) => {
    const query = clean(req.query.q);
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    res.json(await users.find({ role: "player", $or: [{ name: pattern }, { email: pattern }] },
      { projection: playerProfile }).sort({ name: 1, _id: 1 }).limit(30).toArray());
  });
  app.get("/api/admin/players/:id", staff, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) fail(404, "Player not found.");
    const profile = await users.findOne({ _id: new ObjectId(req.params.id), role: "player" },
      { projection: playerProfile });
    if (!profile) fail(404, "Player not found.");
    res.json({ profile, bookings: await bookingHistory(profile._id.toString()) });
  });
  app.post(
    "/api/bookings/:id/receipt",
    auth,
    upload.single("receipt"),
    async (req, res) => {
      const b = await receiptBooking(req);
      const f = req.file;
      check(f, "Choose a receipt.");
      const hex = f.buffer.subarray(0, 8).toString("hex"),
        type = hex.startsWith("ffd8ff")
          ? "image/jpeg"
          : hex === "89504e470d0a1a0a"
            ? "image/png"
            : f.buffer.subarray(0, 5).toString() === "%PDF-"
              ? "application/pdf"
              : null;
      check(type && f.mimetype === type, "Upload a JPG, PNG or PDF receipt.");
      const key = randomUUID();
      await receipts.insertOne({ _id: key, data: f.buffer, type });
      try {
        await change(b.date, (d) => {
          const x = d.bookings.find((a) => a.id === b.id && a.owner === b.owner && a.created === b.created);
          if (x?.status !== "Awaiting payment" || !active(x))
            fail(409, "This hold is no longer available.");
          Object.assign(x, { status: "Pending verification", receipt: key });
        });
      } catch (e) {
        await receipts.deleteOne({ _id: key });
        throw e;
      }
      res.json({ ok: true });
    },
  );
  app.get("/api/bookings/:id/receipt", auth, async (req, res) => {
    const b = await receiptBooking(req);
    const f = await receipts.findOne({ _id: b.receipt || "" });
    if (!f) fail(404, "Receipt unavailable.");
    res
      .set({
        "Content-Type": f.type,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      })
      .send(Buffer.from(f.data.buffer));
  });
  app.get("/api/bookings/:id/invoice", auth, async (req, res) => {
    const b = await record(req.params.id);
    owned(req, b);
    if (b.status !== "Confirmed")
      fail(409, "Invoice becomes available after approval.");
    const { default: PDFDocument } = await import("pdfkit");
    const c = courtBy(b.court),
      pdf = new PDFDocument({ size: "A5", margin: 32 });
    res.type("application/pdf").attachment(b.id + ".pdf");
    pdf.pipe(res);
    pdf
      .fillColor("#095541")
      .fontSize(20)
      .text(venue)
      .moveDown()
      .fontSize(12)
      .text("PAYMENT SLIP  /  BOOKING ID")
      .moveDown(0.4)
      .fontSize(23)
      .text(b.id)
      .moveDown()
      .fillColor("#182d28")
      .fontSize(12);
    for (const line of [
      "Player   " + b.name,
      "Mobile   " + b.phone,
      "",
      c.sport + " | " + c.name + " | " + c.type,
      b.date + "   " + time(b.start) + " - " + time(b.start + b.duration),
      zone,
      "",
      "Hourly rate   " + currency + " " + b.rate,
      "Total paid   " + currency + " " + b.total,
      "Payment status   Paid / Verified",
      ...(b.verified ? ["Verified   " + DateTime.fromMillis(b.verified, { zone }).toFormat("dd LLL yyyy, h:mm a")] : []),
      "",
      "At arrival, confirm the registered mobile number.",
    ])
      pdf.text(line || " ").moveDown(0.25);
    pdf.end();
  });
  app.get("/api/admin/day", staff, async (req, res) => {
    const d = await readDay(req.query.date);
    res.json({ ...d, bookings: d.bookings.map(view) });
  });
  app.get("/api/admin/booking-summary", staff, async (req, res) => {
    const { from, to } = req.query;
    const dateFilter = [];
    if (from !== undefined || to !== undefined) {
      check(day(from) <= day(to), "End date must follow the start date.");
      dateFilter.push({ $match: { _id: { $gte: from, $lte: to } } });
    }
    const rows = await days.aggregate([
      ...dateFilter,
      { $unwind: "$bookings" },
      { $replaceWith: "$bookings" },
      { $match: { $or: [
        { status: { $in: ["Confirmed", "VIP", "Pending verification"] } },
        { status: "Awaiting payment", expires: null },
        { status: "Awaiting payment", expires: { $gt: Date.now() } },
      ] } },
      { $group: {
        _id: "$court",
        total: { $sum: 1 },
        confirmed: { $sum: { $cond: [{ $and: [
          { $eq: ["$status", "Confirmed"] }, { $not: ["$vip"] },
        ] }, 1, 0] } },
        vip: { $sum: { $cond: [{ $or: [
          { $eq: ["$status", "VIP"] },
          { $and: [{ $eq: ["$status", "Confirmed"] }, "$vip"] },
        ] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ["$status", ["Pending verification", "Awaiting payment"]] }, 1, 0] } },
      } },
    ]).toArray();
    res.json(rows);
  });
  app.get("/api/admin/queue", staff, async (req, res) => {
    const ds = await days
      .find({ "bookings.status": { $in: ["Pending verification", "Awaiting payment"] } })
      .toArray();
    res.json(
      ds
        .flatMap((d) =>
          d.bookings.filter((b) => b.status === "Pending verification" || (b.status === "Awaiting payment" && active(b))),
        )
        .sort((a, b) => a.created - b.created),
    );
  });
  app.post("/api/admin/review/:id", staff, async (req, res) => {
    const b = await record(req.params.id),
      { decision } = req.body,
      reason = clean(req.body.reason, 300);
    check(
      decision === "Approve" || (decision === "Reject" && reason),
      "A rejection requires a reason.",
    );
    await change(b.date, (d) => {
      const x = d.bookings.find((a) => a.id === b.id);
      if (x?.status !== "Pending verification" && !(decision === "Reject" && x?.status === "Awaiting payment" && active(x)))
        fail(409, "Payment already reviewed.");
      Object.assign(
        x,
        decision === "Approve"
          ? { status: "Confirmed", verified: Date.now() }
          : { status: "Rejected", reason },
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/rates", staff, async (req, res) => {
    const { sport, court, rate } = req.body;
    check(
      (court ? courts.some((c) => c.id === court) : sports.includes(sport)) &&
        Number.isInteger(rate) &&
        rate > 0 &&
        rate <= 1000000,
      "Enter a positive whole hourly rate.",
    );
    const targets = court ? [court] : courts.filter((c) => c.sport === sport).map((c) => c.id);
    await settings.updateOne({ _id: "rates" }, { $set: Object.fromEntries(targets.map((id) => [`courtRates.${id}`, rate])) });
    res.json(await rates());
  });
  app.post("/api/admin/closure", staff, async (req, res) => {
    const { date, scope } = req.body;
    const ids = courts
      .filter((c) => scope === "All" || scope === c.sport || scope === c.id)
      .map((c) => c.id);
    check(ids.length, "Choose a closure scope.");
    await change(date, (d) => {
      const affected = d.bookings.filter(
        (b) => ids.includes(b.court) && active(b),
      );
      if (affected.length)
        fail(
          409,
          "Move these reservations to an available court or review their payment before closing.",
          { affected },
        );
      d.closed = [...new Set([...d.closed, ...ids])];
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/move/:id", staff, async (req, res) => {
    const b = await record(req.params.id),
      { court, start } = req.body,
      date = req.body.date || b.date;
    check(
      courtBy(court).sport === b.sport,
      "Select a court for the same sport.",
    );
    interval(date, start, b.duration);
    function validate(x, d) {
      if (
        !x ||
        x.checked ||
        !active(x) ||
        !available(d, court, start, b.duration, b.id)
      )
        fail(409, "Reservation cannot be moved to this time.");
    }
    if (date === b.date) {
      await change(date, (d) => {
        const x = d.bookings.find((a) => a.id === b.id);
        validate(x, d);
        Object.assign(x, { court, start });
      });
    } else {
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const source = await days.findOne({ _id: b.date }, { session }),
            target =
              (await days.findOne({ _id: date }, { session })) || empty(date);
          const x = source?.bookings.find((a) => a.id === b.id);
          validate(x, target);
          await days.updateOne(
            { _id: b.date },
            { $pull: { bookings: { id: b.id } }, $inc: { revision: 1 } },
            { session },
          );
          await days.updateOne(
            { _id: date },
            {
              $push: { bookings: { ...x, court, date, start } },
              $inc: { revision: 1 },
              $setOnInsert: { closed: [] },
            },
            { upsert: true, session },
          );
        });
      } finally {
        await session.endSession();
      }
    }
    res.json({ ok: true });
  });
  app.get("/api/admin/check/:id", staff, async (req, res) =>
    res.json(view(await record(req.params.id))),
  );
  app.post("/api/admin/check/:id", staff, async (req, res) => {
    const b = await record(req.params.id);
    await change(b.date, (d) => {
      const x = d.bookings.find((a) => a.id === b.id);
      if (!x) fail(409, "Reservation moved. Look it up again.");
      if (x.checked) fail(409, "Already checked in.");
      if (!["Confirmed", "VIP"].includes(x.status))
        fail(409, "Booking is not confirmed.");
      x.checked = Date.now();
    });
    res.json(await record(b.id));
  });
  app.get("/api/admin/finance", staff, async (req, res) => {
    const from = day(req.query.from),
      to = day(req.query.to);
    check(from <= to, "End date must follow the start date.");
    const lo = DateTime.fromISO(from, { zone }).toMillis(),
      hi = DateTime.fromISO(to, { zone }).plus({ days: 1 }).toMillis();
    const basis = req.query.basis ?? "verified";
    check(["booking", "verified"].includes(basis), "Choose a valid report date basis.");
    const setting = req.query.setting ?? "Both";
    check(["Indoor", "Outdoor", "Both"].includes(setting), "Choose a valid court setting.");
    const start = Number(req.query.start ?? openingTime);
    const end = Number(req.query.end ?? closingTime);
    check(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= closingTime,
      "Choose an end time after the start time.");
    const scope = {
      court: { $in: courts.filter((c) => setting === "Both" || c.type === setting).map((c) => c.id) },
      start: { $lt: end },
      $expr: { $gt: [{ $add: ["$start", "$duration"] }, start] },
    };
    const paymentsQuery = days
      .aggregate([
        { $match: basis === "booking"
          ? { _id: { $gte: from, $lte: to } }
          : { bookings: { $elemMatch: { verified: { $gte: lo, $lt: hi } } } } },
        { $unwind: "$bookings" },
        { $replaceWith: "$bookings" },
        {
          $match: {
            status: { $in: ["VIP", "Confirmed"] },
            ...scope,
            ...(basis === "booking"
              ? { date: { $gte: from, $lte: to } }
              : { verified: { $gte: lo, $lt: hi } }),
          },
        },
        { $sort: { verified: -1 } },
      ])
      .toArray();
    const slotsQuery = req.query.slots === "true" ? days.aggregate([
      { $match: { _id: { $gte: from, $lte: to } } },
      { $unwind: "$bookings" },
      { $replaceWith: "$bookings" },
      { $match: scope },
      { $sort: { date: 1, start: 1, court: 1 } },
    ]).toArray() : [];
    const [payments, slotRows] = await Promise.all([paymentsQuery, slotsQuery]);
    const slots = slotRows.filter(active);
    const sum = (records) =>
      records.reduce((cents, b) => cents + Math.round(b.total * 100), 0) / 100;
    const paid = payments.filter((b) => b.paymentType !== "Complimentary"),
      breakdown = Object.fromEntries(
        sports.map((s) => [
          s,
          sum(paid.filter((b) => b.sport === s)),
        ]),
      );
    res.json({
      from,
      to,
      zone,
      breakdown,
      total: sum(paid),
      slots,
      paid,
      complimentary: payments.filter((b) => b.paymentType === "Complimentary"),
    });
  });
  app.use("/api", (q, s) =>
    s.status(404).json({ message: "Unknown endpoint." }),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (q, s) => s.sendFile(path.resolve("dist/index.html")));
  app.use((e, q, s, next) => {
    const status = e instanceof multer.MulterError ? 400 : e.status || 500;
    if (status === 500) console.error(e);
    s.status(status).json({
      message: status === 500 ? "Request failed. Try again." : e.message,
      ...e.extra,
    });
  });
  return app;
}
