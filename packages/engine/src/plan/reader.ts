import type { Database } from "better-sqlite3";
import type { Person } from "../auth/middleware.ts";
import { selectDayTemplate } from "../queries/select-day-template.ts";
import { selectSelectedDayType } from "../queries/select-selected-day-type.ts";
import { selectTemplateSlots } from "../queries/select-template-slots.ts";

export function selectedTemplate(
  database: Database,
  person: Pick<Person, "id" | "timezone" | "day_start_hour">,
  day: string,
  now: Date,
) {
  const day_type = selectSelectedDayType(database, {
    user_id: person.id,
    day,
    timezone: person.timezone,
    day_start_hour: person.day_start_hour,
    fresh_after: new Date(now.getTime() - 3_600_000).toISOString(),
    now: now.toISOString(),
  });
  if (!day_type)
    return {
      status: "no_day_type" as const,
      day,
      day_type: null,
      template: null,
      slots: [],
    };
  const template = selectDayTemplate(database, {
    user_id: person.id,
    id: day_type.template_id,
  });
  if (!template) throw new Error("Selected template not found");
  const slots = selectTemplateSlots(database, {
    user_id: person.id,
    template_id: template.id,
  });
  if (slots.length === 0) throw new Error("Selected template has no slots");
  return { status: "ready" as const, day, day_type, template, slots };
}
