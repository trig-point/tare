import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  answerDose,
  type DueDose,
  dueDosesKey,
  dueDosesQuery,
} from "./doses-api.ts";
import { Button } from "./shared/ui/index.ts";
import { press } from "./slots.tsx";
import { refreshToday } from "./today-api.ts";

/** Doses that are due or late, reached from reminders at `/#doses`. */
export function DueDoses({
  person,
  online,
  timezone,
}: {
  person: number;
  online: boolean;
  timezone: string | undefined;
}) {
  const doses = useQuery({ ...dueDosesQuery(person), enabled: online });
  const hash = useRouterState({ select: (state) => state.location.hash });
  const section = useRef<HTMLElement>(null);
  const shown = doses.data?.length ?? 0;
  useEffect(() => {
    if (hash === "doses" && shown > 0)
      section.current?.scrollIntoView({ block: "start" });
  }, [hash, shown]);
  if (!shown) return null;
  return (
    <section
      id="doses"
      ref={section}
      aria-label="Due doses"
      className="mt-3 scroll-mt-4 rounded-(--radius) border border-border bg-surface"
    >
      <ul className="m-0 list-none p-0">
        {doses.data?.map((dose) => (
          <DoseRow
            key={dose.key}
            dose={dose}
            person={person}
            online={online}
            timezone={timezone}
          />
        ))}
      </ul>
    </section>
  );
}

function DoseRow({
  dose,
  person,
  online,
  timezone,
}: {
  dose: DueDose;
  person: number;
  online: boolean;
  timezone: string | undefined;
}) {
  const client = useQueryClient();
  const answer = useMutation({
    networkMode: "always",
    mutationFn: async (action: "log" | "skip") => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await answerDose(action, dose.key);
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: dueDosesKey(person) }),
        refreshToday(client, person),
      ]),
  });
  const time = new Date(dose.scheduled_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return (
    <li className="flex flex-wrap items-center gap-3 p-4 [&+&]:border-t [&+&]:border-border">
      <div className="min-w-0 grow">
        <p className="m-0 font-semibold">{dose.name}</p>
        <p className="m-0 text-step--1 text-ink-2">
          <span className="numeric">{time}</span>
          {dose.status === "late" && (
            <span className="text-caution"> Late</span>
          )}
        </p>
        {answer.isError && <p role="alert">Couldn’t save</p>}
      </div>
      <Button
        className={press}
        disabled={!online || answer.isPending}
        onClick={() => answer.mutate("log")}
      >
        Taken
      </Button>
      <Button
        variant="ghost"
        className={press}
        disabled={!online || answer.isPending}
        onClick={() => answer.mutate("skip")}
      >
        Skip
      </Button>
    </li>
  );
}
