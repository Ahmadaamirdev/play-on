// Repair IDs left by older databases whose sequence was reset or missing.
// Changes use the schedule revision, so concurrent initializers and schedule edits
// cannot silently overwrite one another.
export async function ensureBookingIds(db) {
  const days = db.collection("days"), settings = db.collection("settings");
  const schedules = await days.find({}, { projection: { bookings: 1 } }).toArray();
  let highest = 0;
  for (const d of schedules) for (const b of d.bookings || []) {
    const match = /^PO-(\d+)$/.exec(b.id);
    if (match) {
      const value = Number(match[1]);
      if (!Number.isSafeInteger(value)) throw new Error("Invalid booking sequence in database.");
      highest = Math.max(highest, value);
    }
  }
  await settings.updateOne({ _id: "bookingSequence" }, { $max: { sequence: highest } }, { upsert: true });
  const seen = new Set();
  for (const schedule of schedules.sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
    for (;;) {
      const current = await days.findOne({ _id: schedule._id });
      if (!current) break;
      const local = new Set(seen), duplicates = [];
      for (let i = 0; i < current.bookings.length; i++) {
        const id = current.bookings[i].id;
        if (local.has(id)) duplicates.push(i);
        else local.add(id);
      }
      if (!duplicates.length) {
        for (const b of current.bookings) seen.add(b.id);
        break;
      }
      for (const i of duplicates) {
        const counter = await settings.findOneAndUpdate({ _id: "bookingSequence" },
          { $inc: { sequence: 1 } }, { returnDocument: "after" });
        current.bookings[i].id = "PO-" + String(counter.sequence).padStart(6, "0");
      }
      const revision = current.revision;
      current.revision++;
      const result = await days.replaceOne({ _id: current._id, revision }, current);
      if (result.modifiedCount) {
        for (const b of current.bookings) seen.add(b.id);
        break;
      }
    }
  }
  // MongoDB's unique multikey index enforces uniqueness across schedule documents.
  const indexes = await days.indexes();
  const existing = indexes.find((index) => index.name === "bookings.id_1");
  if (existing && !existing.unique) await days.dropIndex(existing.name).catch((error) => {
    if (error.codeName !== "IndexNotFound") throw error;
  });
  await days.createIndex({ "bookings.id": 1 }, {
    unique: true, partialFilterExpression: { "bookings.id": { $exists: true } },
  });
}
