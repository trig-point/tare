import { z } from "zod";
import { api, liveRefresh } from "./api.ts";

const medicationsSchema = z.object({
  medications: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z
        .object({
          next_dose: z
            .object({
              public_key: z.string().nullable(),
              scheduled_at: z.string(),
              status: z.enum(["scheduled", "due", "late"]),
            })
            .nullable(),
        })
        .nullable(),
    }),
  ),
});
export type DueDose = {
  key: string;
  name: string;
  scheduled_at: string;
  status: "due" | "late";
};

export const dueDosesKey = (person: number) => ["due-doses", person] as const;
export async function readDueDoses(signal: AbortSignal): Promise<DueDose[]> {
  const { medications } = medicationsSchema.parse(
    await api("/api/medications", { signal }),
  );
  return medications.flatMap(({ name, status }) => {
    const dose = status?.next_dose;
    return dose?.public_key && dose.status !== "scheduled"
      ? [
          {
            key: dose.public_key,
            name,
            scheduled_at: dose.scheduled_at,
            status: dose.status,
          },
        ]
      : [];
  });
}
export const dueDosesQuery = (person: number) => ({
  queryKey: dueDosesKey(person),
  queryFn: ({ signal }: { signal: AbortSignal }) => readDueDoses(signal),
  ...liveRefresh,
});

export async function answerDose(action: "log" | "skip", key: string) {
  z.object({ dose: z.object({ public_key: z.literal(key) }) }).parse(
    await api(`/api/medications/doses/${action}`, {
      method: "POST",
      body: JSON.stringify({ dose: key }),
    }),
  );
}
