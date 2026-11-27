import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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

type DoseAnswer = {
  action: "log" | "skip";
  key: string;
};

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
  const client = useQueryClient();
  const mutationKey = ["answer-dose", person];
  const answers = useMutationState({
    filters: { mutationKey, exact: true },
    select: ({ state }) => ({
      ...state,
      variables: state.variables as DoseAnswer,
    }),
  });
  const answer = useMutation({
    mutationKey,
    gcTime: Infinity,
    networkMode: "always",
    mutationFn: async ({ action, key }: DoseAnswer) => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await answerDose(action, key);
    },
    onSettled: async () => {
      const queryKey = dueDosesKey(person);
      await client.cancelQueries({ queryKey });
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        refreshToday(client, person),
      ]);
    },
  });
  const lastAnswer = answers.at(-1);
  const canAnswer =
    online &&
    doses.isSuccess &&
    !doses.isPaused &&
    (!lastAnswer ||
      (lastAnswer.status !== "pending" &&
        doses.dataUpdatedAt > lastAnswer.submittedAt));
  function submitAnswer(action: DoseAnswer["action"], key: string) {
    const current = client.getQueryState(dueDosesKey(person));
    if (
      !canAnswer ||
      current?.status !== "success" ||
      current.fetchStatus === "paused" ||
      client.getMutationCache().find({
        mutationKey,
        exact: true,
        predicate: ({ state }) =>
          state.status === "pending" ||
          state.submittedAt >= current.dataUpdatedAt ||
          (state.status === "success" &&
            (state.variables as DoseAnswer | undefined)?.key === key),
      })
    )
      return;
    answer.mutate({ action, key });
  }
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
        {doses.data?.map((dose) => {
          const answered = answers.findLast(
            ({ variables, status, submittedAt }) =>
              variables.key === dose.key &&
              (status !== "error" || submittedAt >= doses.dataUpdatedAt),
          );
          const label =
            answered?.status === "success"
              ? answered.variables.action === "log"
                ? "Taken"
                : "Skipped"
              : answered?.status === "error"
                ? "Not saved"
                : undefined;
          return (
            <DoseRow
              key={dose.key}
              dose={dose}
              disabled={!canAnswer || Boolean(answered)}
              label={label}
              timezone={timezone}
              onAnswer={(action) => submitAnswer(action, dose.key)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function DoseRow({
  dose,
  disabled,
  label,
  timezone,
  onAnswer,
}: {
  dose: DueDose;
  disabled: boolean;
  label: string | undefined;
  timezone: string | undefined;
  onAnswer: (action: DoseAnswer["action"]) => void;
}) {
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
      </div>
      <div className="relative flex shrink-0 gap-3">
        <Button
          className={label ? "invisible" : press}
          disabled={disabled}
          onClick={() => onAnswer("log")}
        >
          Taken
        </Button>
        <Button
          variant="ghost"
          className={label ? "invisible" : press}
          disabled={disabled}
          onClick={() => onAnswer("skip")}
        >
          Skip
        </Button>
        {label && (
          <output className="absolute inset-0 flex items-center justify-center">
            {label}
          </output>
        )}
      </div>
    </li>
  );
}
