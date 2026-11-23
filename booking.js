export const openingTime = 6 * 60;
export const closingTime = 24 * 60;

export const bookingTotal = (rate, duration) =>
  Math.round((rate * duration * 100) / 60) / 100;

export const time = (minutes) => {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
};
