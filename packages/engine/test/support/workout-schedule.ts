const push = (name: string) => ({
  name,
  where: "home",
  movements: [
    {
      name: "Example press",
      load: "20 kg",
      sets: 3,
      reps: "8-10",
      rir: "2",
      rest_s: "90",
    },
  ],
});

// The fixture clock sits on Thursday 2026-01-01 in the admin's zone.
export function exampleSchedule(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    timezone: "Asia/Kolkata",
    week: {
      mon: { kind: "lift", session: "push" },
      tue: { kind: "lift", session: "legs_a" },
      wed: { kind: "cardio", label: "Example walk" },
      thu: { kind: "lift", session: "legs_a" },
      fri: { kind: "rest", label: "Rest" },
      sat: { kind: "lift", session: "push" },
      sun: { kind: "rest", label: "Rest" },
    },
    rotation: ["push_a", "legs_a", "push_b"],
    next_session: "push_a",
    planned: [{ date: "2026-01-02", session: "push_b" }],
    sessions: {
      push_a: push("Push A"),
      push_b: push("Push B"),
      legs_a: { ...push("Legs A"), where: "example gym", note: "Light week" },
    },
    ...overrides,
  };
}
