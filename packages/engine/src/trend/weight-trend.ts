export interface WeightReading {
  day: string;
  weight_kg: number;
}

export interface WeightTrendDay {
  day: string;
  reading_kg: number | null;
  trend_kg: number;
}

function nextCalendarDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function weightTrend(rows: readonly WeightReading[]): WeightTrendDay[] {
  const days: WeightTrendDay[] = [];
  let previous: WeightTrendDay | undefined;

  for (const row of rows) {
    if (previous?.day === row.day) continue;

    if (previous) {
      let day = nextCalendarDay(previous.day);
      while (day < row.day) {
        days.push({ day, reading_kg: null, trend_kg: previous.trend_kg });
        day = nextCalendarDay(day);
      }
    }

    previous = {
      day: row.day,
      reading_kg: row.weight_kg,
      trend_kg: previous
        ? previous.trend_kg + 0.1 * (row.weight_kg - previous.trend_kg)
        : row.weight_kg,
    };
    days.push(previous);
  }

  return days;
}
