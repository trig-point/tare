import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  answerDose,
  type DueDose,
  dueDosesKey,
  dueDosesQuery,
} from "./doses-api.ts";
import { Button } from "./shared/ui/index.ts";
import { press } from "./slots.tsx";
import { refreshToday } from "./today-api.ts";

export function doseTapDelay(keys: string) {
  let readyKeys: string | undefined;
  return {
    getSnapshot: () => readyKeys,
    subscribe(notify: () => void) {
      const timer = setTimeout(() => {
        readyKeys = keys;
        notify();
      }, 700);
      return () => clearTimeout(timer);
    },
  };
}

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
  const keys = doses.data?.map((dose) => dose.key).join(",") ?? "";
  const { subscribe, getSnapshot } = useMemo(() => doseTapDelay(keys), [keys]);
  const tapsReady =
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot) === keys;
  const hash = useRouterState({ select: (state) => state.location.hash });
  const section = useRef<HTMLElement>(null);
  const shown = doses.data?.length ?? 0;
  useEffect(() => {
    if (hash === "doses" && (shown > 0 || doses.isError))
      section.current?.scrollIntoView({ block: "start" });
  }, [hash, shown, doses.isError]);
  if (!shown && !doses.isError) return null;
  return (
    <section
      id="doses"
      ref={section}
      aria-label="Due doses"
      className="mt-3 scroll-mt-4 rounded-(--radius) border border-border bg-surface p-0"
    >
      {doses.isError && (
        <p className="m-0 p-4" role="alert">
          Couldn't load doses
        </p>
      )}
      <ul className="m-0 list-none p-0">
        {doses.data?.map((dose) => (
          <DoseRow
            key={dose.key}
            dose={dose}
            person={person}
            online={online}
            tapsReady={tapsReady}
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
  tapsReady,
  timezone,
}: {
  dose: DueDose;
  person: number;
  online: boolean;
  tapsReady: boolean;
  timezone: string | undefined;
}) {
  const client = useQueryClient();
  const queryKey = dueDosesKey(person);
  const answer = useMutation({
    networkMode: "always",
    mutationFn: async (action: "log" | "skip") => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await answerDose(action, dose.key);
    },
    onSuccess: async () => {
      await client.cancelQueries({ queryKey });
      client.setQueryData<DueDose[]>(queryKey, (doses) =>
        doses?.filter((cachedDose) => cachedDose.key !== dose.key),
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey });
      void refreshToday(client, person);
    },
  });
  const disabled = !online || !tapsReady || answer.isPending;
  const time = new Date(dose.scheduled_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return (
    <li className="flex flex-wrap items-center gap-3 p-4 [&+&]:border-t [&+&]:border-border">
      <div className="min-w-0 grow">
        <p className="m-0 font-semibold [overflow-wrap:anywhere]">
          {dose.name}
        </p>
        <p className="m-0 text-step--1 text-ink-2">
          <span className="numeric">{time}</span>
          {dose.status === "late" && (
            <span className="text-caution"> Late</span>
          )}
        </p>
        {answer.isError && <p role="alert">Not saved</p>}
      </div>
      <div className="flex shrink-0 gap-3">
        <Button
          className={press}
          disabled={disabled}
          onClick={() => answer.mutate("log")}
        >
          Taken
        </Button>
        <Button
          variant="ghost"
          className={press}
          disabled={disabled}
          onClick={() => answer.mutate("skip")}
        >
          Skip
        </Button>
      </div>
    </li>
  );
}
