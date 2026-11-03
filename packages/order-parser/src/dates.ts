const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const monthPattern = monthNames
  .map((month) => `${month.slice(0, 3)}(?:${month.slice(3)})?`)
  .join("|");
const datePattern = new RegExp(
  `(?<![\\w/\\-])(?:(?<iso>\\d{4}-\\d{2}-\\d{2})|(?<monthFirst>${monthPattern})\\s+(?<dayAfter>\\d{1,2})(?:,?\\s+(?<yearAfter>\\d{4}))?|(?<dayFirst>\\d{1,2})\\s+(?<monthAfter>${monthPattern})(?:,?\\s+(?<yearLast>\\d{4}))?|(?<slashMonth>\\d{1,2})/(?<slashDay>\\d{1,2})(?:/(?<slashYear>\\d{4}))?)(?![\\w/\\-])`,
  "gi",
);

function isoDate(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return year >= 1 &&
    year <= 9999 &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function deliveryDate(
  excerpt: string,
  receivedOn?: string,
): { value: string; uncertain: boolean } | null {
  const matches = [...excerpt.matchAll(datePattern)];
  if (matches.length !== 1) return null;
  const groups = matches[0]?.groups;
  if (!groups) return null;
  if (groups.iso) {
    const value = isoDate(
      Number(groups.iso.slice(0, 4)),
      Number(groups.iso.slice(5, 7)),
      Number(groups.iso.slice(8)),
    );
    return value ? { value, uncertain: false } : null;
  }
  const monthName = groups.monthFirst ?? groups.monthAfter;
  const month = monthName
    ? monthNames.findIndex(
        (name) => name.slice(0, 3) === monthName.toLowerCase().slice(0, 3),
      ) + 1
    : Number(groups.slashMonth);
  const day = Number(groups.dayAfter ?? groups.dayFirst ?? groups.slashDay);
  const yearText = groups.yearAfter ?? groups.yearLast ?? groups.slashYear;
  if (yearText) {
    const value = isoDate(Number(yearText), month, day);
    return value ? { value, uncertain: Boolean(groups.slashMonth) } : null;
  }
  if (!receivedOn || !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return null;
  const receivedYear = Number(receivedOn.slice(0, 4));
  if (
    !isoDate(
      receivedYear,
      Number(receivedOn.slice(5, 7)),
      Number(receivedOn.slice(8)),
    )
  )
    return null;
  for (let year = receivedYear; year <= receivedYear + 8; year++) {
    const value = isoDate(year, month, day);
    if (value && value >= receivedOn) return { value, uncertain: true };
  }
  return null;
}
