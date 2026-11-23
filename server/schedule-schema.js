// Applied to the same collection used for schedules, check-in and revenue.
const number = { bsonType: "number", minimum: 0 };
const booking = {
  bsonType: "object",
  required: ["id", "owner", "name", "phone", "court", "sport", "date", "start",
    "duration", "rate", "total", "status", "paymentType", "created"],
  properties: {
    id: { bsonType: "string" }, owner: { bsonType: ["string", "null"] },
    name: { bsonType: "string" }, phone: { bsonType: "string" },
    court: { bsonType: "string" }, sport: { enum: ["Cricket", "Tennis", "Padel"] },
    date: { bsonType: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    start: number, duration: { bsonType: "number", minimum: 1 },
    rate: number, total: number, created: number, verified: number,
    status: { enum: ["Awaiting payment", "Pending verification", "Rejected", "Confirmed", "VIP"] },
    paymentType: { enum: ["Transfer", "Paid", "Complimentary"] },
  },
  anyOf: [
    { properties: { status: { enum: ["Awaiting payment", "Pending verification", "Rejected"] } } },
    { required: ["verified"] },
  ],
};
const validator = {
  $jsonSchema: {
    bsonType: "object", required: ["_id", "revision", "bookings", "closed"],
    properties: {
      _id: booking.properties.date, revision: number,
      bookings: { bsonType: "array", items: booking },
      closed: { bsonType: "array", items: { bsonType: "string" } },
    },
  },
};

export async function ensureScheduleSchema(db) {
  const collection = await db.listCollections({ name: "days" }).next();
  if (!collection) {
    try {
      await db.createCollection("days", { validator });
      return;
    } catch (error) {
      if (error.code !== 48) throw error;
    }
  }
  if (!collection?.options?.validator) {
    await db.command({ collMod: "days", validator });
  }
}
