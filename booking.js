export const openingTime = 6 * 60;
export const closingTime = 24 * 60;

export const bookingTotal = (rate, duration) =>
  Math.round((rate * duration * 100) / 60) / 100;

export const time = (minutes) => {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
};

export function courtTimeline(booked) {
  const slots = [];
  let cursor = openingTime;
  for (const slot of booked) {
    if (cursor < slot.start) slots.push({ start: cursor, end: slot.start, state: "Available" });
    slots.push(slot);
    cursor = Math.max(cursor, slot.end);
  }
  if (cursor < closingTime) slots.push({ start: cursor, end: closingTime, state: "Available" });
  return slots;
}

export function extensionCharge(booking, minutes) {
  if (booking.paymentType === "Complimentary") return 0;
  return Math.round((bookingTotal(booking.rate, booking.duration + minutes)
    - bookingTotal(booking.rate, booking.duration)) * 100) / 100;
}
