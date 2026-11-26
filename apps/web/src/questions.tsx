import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, XIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "./api.ts";
import {
  advisory,
  answerQuestion,
  blankLabel,
  type LabelValues,
  labelAnswer,
  lateTargetIsNew,
  type Question,
  questionsKey,
  readQuestions,
  refreshAnswered,
} from "./questions-api.ts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Input,
} from "./shared/ui/index.ts";
import "./questions.css";

export function Questions({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const questions = useQuery({
    queryKey: questionsKey(person),
    queryFn: ({ signal }) => readQuestions(signal),
    enabled: online,
  });
  return (
    <QuestionList
      person={person}
      questions={questions.data}
      failed={questions.isError}
      online={online}
    />
  );
}

const kindLabels: Record<string, string> = {
  meal_nutrition: "Meal label",
  held_order_email: "Order email",
  order_late_list: "Late order",
  order_delivery_date: "Delivery date",
  order_review: "Order review",
  order_manual_entry: "Order entry",
  scale_implausible: "Scale reading",
  scale_unmapped: "Scale user",
};
const kindLabel = (question: Question) =>
  kindLabels[question.kind] ?? "Question";

export function QuestionList({
  person,
  questions,
  failed,
  online,
}: {
  person: number;
  questions: Question[] | undefined;
  failed: boolean;
  online: boolean;
}) {
  // The deck stays mounted while closed so the sheet keeps its content as it slides out.
  const [sheet, setSheet] = useState({ open: false, start: 0, round: 0 });
  const openSheet = (start: number) =>
    setSheet((current) => ({ open: true, start, round: current.round + 1 }));
  const closeSheet = () => setSheet((current) => ({ ...current, open: false }));
  const autoOpened = useRef(false);
  const first = questions?.[0];
  useEffect(() => {
    if (first && !autoOpened.current) {
      autoOpened.current = true;
      setSheet((current) => ({
        open: true,
        start: first.id,
        round: current.round + 1,
      }));
    }
  }, [first]);
  const count = questions?.length ?? 0;
  return (
    <section aria-label="Questions" className="questions-page">
      <div className="questions-head">
        <h1>Questions</h1>
        <p hidden={!questions && failed}>
          {questions
            ? count > 0
              ? `${count} waiting`
              : "No open questions"
            : online
              ? "Loading..."
              : "Unavailable offline"}
        </p>
      </div>
      {failed && <p role="alert">Couldn’t load questions</p>}
      {questions && questions.length > 0 && (
        <>
          <Button
            className="questions-open w-full active:scale-[0.98]"
            size="lg"
            onClick={() => openSheet(questions[0]?.id ?? 0)}
          >
            Answer questions
          </Button>
          <ul className="questions-waiting" data-slot="list">
            {questions.map((question) => (
              <li key={question.id}>
                <button
                  type="button"
                  data-slot="row"
                  onClick={() => openSheet(question.id)}
                >
                  <span className="questions-kind">{kindLabel(question)}</span>
                  <span className="questions-prompt">{question.prompt}</span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <p className="questions-note">Skipped questions stay here.</p>
        </>
      )}
      <Dialog
        open={sheet.open && questions !== undefined}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      >
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          // Focusing the first field would raise the phone keyboard over the question.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className="question-sheet top-auto bottom-0 left-1/2 w-full max-w-[40rem] translate-y-0 -translate-x-1/2 gap-0 rounded-b-none rounded-t-xl border-x-0 border-b-0 bg-card p-0 sm:max-w-[40rem] sm:border-x"
        >
          <div className="question-sheet-head">
            <DialogTitle>Questions</DialogTitle>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                className="quiet-button"
              >
                <XIcon />
              </Button>
            </DialogClose>
          </div>
          {sheet.round > 0 && questions && (
            <QuestionDeck
              key={sheet.round}
              person={person}
              questions={questions}
              online={online}
              start={sheet.start}
              onClose={closeSheet}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** The index of the first question at or after the cursor that is still open, or the order's length when none is. */
export function deckPosition(
  order: number[],
  open: ReadonlySet<number>,
  cursor: number,
) {
  for (let index = cursor; index < order.length; index++) {
    const id = order[index];
    if (id !== undefined && open.has(id)) return index;
  }
  return order.length;
}

/** The round so far plus any newly open questions; answered ones stay so positions never shift. */
export function extendRound(round: number[], open: number[]) {
  const arrived = open.filter((id) => !round.includes(id));
  return arrived.length > 0 ? [...round, ...arrived] : round;
}

/** Open question ids starting at the chosen one, so earlier ones come last instead of counting as skipped. */
export function startRound(open: number[], start: number) {
  const index = Math.max(0, open.indexOf(start));
  return [...open.slice(index), ...open.slice(0, index)];
}

export function QuestionDeck({
  person,
  questions,
  online,
  start,
  onClose,
}: {
  person: number;
  questions: Question[];
  online: boolean;
  start: number;
  onClose: () => void;
}) {
  const ids = questions.map(({ id }) => id);
  const [round, setRound] = useState(() => startRound(ids, start));
  const [cursor, setCursor] = useState(0);
  // A save that finishes after Review skipped belongs to the earlier pass and must not move this one.
  const pass = useRef(0);
  const order = extendRound(round, ids);
  if (order !== round) setRound(order);
  const position = deckPosition(order, new Set(ids), cursor);
  const question = questions.find(({ id }) => id === order[position]);
  const next = () => setCursor(position + 1);
  const answeredIn = (answeredPass: number, answeredAt: number) => () => {
    if (pass.current === answeredPass)
      setCursor((value) => Math.max(value, answeredAt + 1));
  };

  if (!question) {
    const left = questions.length;
    return (
      <div className="question-done">
        <p>{left > 0 ? `${left} skipped` : "All caught up"}</p>
        <div className="question-done-actions">
          {left > 0 && (
            <Button
              variant="outline"
              className="active:scale-[0.98]"
              onClick={() => {
                pass.current += 1;
                setRound(ids);
                setCursor(0);
              }}
            >
              Review skipped
            </Button>
          )}
          <Button className="active:scale-[0.98]" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="question-deck">
      <div className="question-progress">
        <span className="numeric" aria-live="polite">
          {position + 1} of {order.length}
        </span>
        <span className="question-progress-track" aria-hidden="true">
          <span
            style={{ width: `${((position + 1) / order.length) * 100}%` }}
          />
        </span>
      </div>
      <article className="question-card" key={question.id}>
        <p className="question-kind">{kindLabel(question)}</p>
        <h2>{question.prompt}</h2>
        <QuestionForm
          person={person}
          question={question}
          online={online}
          onAnswered={answeredIn(pass.current, position)}
        />
      </article>
      <div className="question-footer">
        <Button
          variant="ghost"
          className="quiet-button active:scale-[0.98]"
          onClick={next}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function useAnswer(person: number, question: Question, onAnswered: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (answer: unknown) => answerQuestion(question.id, answer),
    onSuccess: async ({ weight_logged }) => {
      // Drop it now so a failed refetch cannot leave it waiting.
      client.setQueryData<Question[]>(questionsKey(person), (list) =>
        list?.filter(({ id }) => id !== question.id),
      );
      onAnswered();
      await refreshAnswered(client, person, weight_logged);
    },
    // Someone else may have answered, or the save landed and its reply was lost.
    onError: (error) => {
      if (!(error instanceof ApiError && error.status === 400))
        void refreshAnswered(
          client,
          person,
          question.kind === "scale_implausible",
        );
    },
  });
}
type Answer = ReturnType<typeof useAnswer>;

function QuestionForm({
  person,
  question,
  online,
  onAnswered,
}: {
  person: number;
  question: Question;
  online: boolean;
  onAnswered: () => void;
}) {
  const answer = useAnswer(person, question, onAnswered);
  const disabled = !online || answer.isPending;
  return (
    <>
      {question.kind === "meal_nutrition" ? (
        <LabelForm question={question} answer={answer} disabled={disabled} />
      ) : question.kind === "held_order_email" ? (
        <Choices
          disabled={disabled}
          choices={[
            ["Process email", { release: true }],
            ["Discard", { release: false }],
          ]}
          answer={answer}
        />
      ) : question.kind === "order_late_list" ? (
        <Choices
          disabled={disabled}
          choices={[
            ...(lateTargetIsNew(question)
              ? [["Accept", { action: "accept" }] as [string, unknown]]
              : []),
            ["Ignore", { action: "ignore" }],
          ]}
          answer={answer}
        />
      ) : question.kind === "order_delivery_date" ? (
        <DateForm question={question} answer={answer} disabled={disabled} />
      ) : question.kind === "scale_implausible" ? (
        <Choices
          disabled={disabled}
          choices={[
            ["Keep", { keep: true }],
            ["Discard", { keep: false }],
          ]}
          answer={answer}
        />
      ) : question.kind === "scale_unmapped" ? (
        <Choices
          disabled={disabled}
          choices={[["Got it", { acknowledged: true }]]}
          answer={answer}
        />
      ) : advisory(question) ? (
        <Choices
          disabled={disabled}
          choices={[["Looks right", { confirm: true }]]}
          answer={answer}
        />
      ) : (
        <p className="question-hint">Answer this one with your agent.</p>
      )}
      {!online && <p className="question-hint">Answers need a connection.</p>}
      {answer.isError && (
        <p role="alert">
          {answer.error instanceof ApiError &&
          answer.error.code === "scale_day_unknown"
            ? "Log this weight manually."
            : answer.error instanceof ApiError && answer.error.status === 400
              ? "Check the answer"
              : "Couldn’t save answer"}
        </p>
      )}
    </>
  );
}

function Choices({
  choices,
  answer,
  disabled,
}: {
  choices: [string, unknown][];
  answer: Answer;
  disabled: boolean;
}) {
  return (
    <div className="question-choices">
      {choices.map(([label, value], index) => (
        <Button
          key={label}
          size="lg"
          variant={index === 0 ? "default" : "outline"}
          className="w-full active:scale-[0.98]"
          disabled={disabled}
          onClick={() => answer.mutate(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

const labelFields: [keyof LabelValues, string, string][] = [
  ["kcal", "Calories", "kcal"],
  ["protein_g", "Protein", "g"],
  ["carbs_g", "Carbs", "g"],
  ["fat_g", "Fat", "g"],
  ["fiber_g", "Fiber", "g, optional"],
];

function LabelForm({
  question,
  answer,
  disabled,
}: {
  question: Question;
  answer: Answer;
  disabled: boolean;
}) {
  const [values, setValues] = useState(blankLabel);
  const id = (name: string) => `question-${question.id}-${name}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    answer.mutate(labelAnswer(values));
  }
  return (
    <form onSubmit={submit} className="question-form" data-slot="form">
      <fieldset disabled={disabled} className="question-fields">
        {labelFields.map(([name, label, unit]) => (
          <div key={name} className={name === "kcal" ? "span" : undefined}>
            <label htmlFor={id(name)}>
              {label} <span>({unit})</span>
            </label>
            <Input
              id={id(name)}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="numeric"
              required={name !== "fiber_g"}
              value={values[name]}
              onChange={(event) =>
                setValues({ ...values, [name]: event.target.value })
              }
            />
          </div>
        ))}
        <div className="span">
          <label htmlFor={id("source")}>Source</label>
          <Input
            id={id("source")}
            required
            maxLength={200}
            placeholder="Package label"
            value={values.source}
            onChange={(event) =>
              setValues({ ...values, source: event.target.value })
            }
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="span w-full active:scale-[0.98]"
        >
          Save and next
        </Button>
      </fieldset>
    </form>
  );
}

function DateForm({
  question,
  answer,
  disabled,
}: {
  question: Question;
  answer: Answer;
  disabled: boolean;
}) {
  const [date, setDate] = useState("");
  const id = `question-${question.id}-date`;
  return (
    <form
      className="question-form"
      data-slot="form"
      onSubmit={(event) => {
        event.preventDefault();
        answer.mutate({ delivery_date: date });
      }}
    >
      <fieldset disabled={disabled} className="question-fields">
        <div className="span">
          <label htmlFor={id}>Delivery date</label>
          <Input
            id={id}
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="span w-full active:scale-[0.98]"
        >
          Save and next
        </Button>
      </fieldset>
    </form>
  );
}
