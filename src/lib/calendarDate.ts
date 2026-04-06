export function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCalendarGridRange(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const totalCells = startOffset + totalDays;
  const weekCount = Math.ceil(totalCells / 7);
  const startDate = new Date(year, month, 1 - startOffset);
  const endExclusive = new Date(year, month, 1 - startOffset + weekCount * 7);

  return {
    startDate,
    endExclusive,
    weekCount,
  };
}

export function extractDateOnlyKey(value: string) {
  const matched = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  return matched ? matched[1] : null;
}

export function parseDateOnlyKeyToLocalDate(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }
  const [, year, month, day] = matched;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return null;
  }
  return parsed;
}
