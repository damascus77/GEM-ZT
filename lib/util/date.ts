/**
 * Convert a `<input type="date">` value ("YYYY-MM-DD") into an ISO instant at the
 * end of that calendar day in the *local* timezone.
 *
 * `new Date("2026-07-10")` parses as UTC midnight, so in a negative-offset zone
 * it lands on the previous local day — an API key would expire a day early. By
 * constructing from local components at 23:59:59 the expiry falls on the day the
 * operator actually picked, regardless of timezone.
 */
export function dateInputToEndOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}
