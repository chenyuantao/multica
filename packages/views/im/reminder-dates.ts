/** Local calendar day as `YYYY-MM-DD`, the reminder due-date format. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local midnight of a `YYYY-MM-DD` key. */
export function fromDateKey(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Monday of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

/** `Y2026M10W2`: the shown day's year, month, and its week of the month (days 1–7 are W1). */
export function weekCode(date: Date): string {
  return `Y${date.getFullYear()}M${date.getMonth() + 1}W${Math.ceil(date.getDate() / 7)}`;
}

/** `10/05` for a `YYYY-MM-DD` key. */
export function shortDate(key: string): string {
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`;
}

/** Monday-first weekday index (0 = Monday) of a `YYYY-MM-DD` key. */
export function weekdayIndex(key: string): number {
  return (fromDateKey(key).getDay() + 6) % 7;
}
