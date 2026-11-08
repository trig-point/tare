import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
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
  const count = questions?.length ?? 0;
  return (
    <section aria-label="Questions">
      <h2>Questions {count > 0 && <span className="badge">{count}</span>}</h2>
      {failed && <p role="alert">Couldn’t load questions</p>}
      {!questions && !failed && (
        <p>{online ? "Loading..." : "Unavailable offline"}</p>
      )}
      {questions?.length === 0 && <p>No open questions</p>}
      {questions && questions.length > 0 && (
        <ul className="questions">
          {questions.map((question) => (
            <li key={question.id}>
              <p>{question.prompt}</p>
              <QuestionForm
                person={person}
                question={question}
                online={online}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function useAnswer(person: number, question: Question) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (answer: unknown) => answerQuestion(question.id, answer),
    onSuccess: () => refreshAnswered(client, person),
    // Someone else answered first; reload so the list drops it.
    onError: (error) => {
      if (error instanceof ApiError && [404, 409].includes(error.status))
        void refreshAnswered(client, person);
    },
  });
}
type Answer = ReturnType<typeof useAnswer>;

function QuestionForm({
  person,
  question,
  online,
}: {
  person: number;
  question: Question;
  online: boolean;
}) {
  const answer = useAnswer(person, question);
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
      ) : (
        <>
          {advisory(question) && (
            <Choices
              disabled={disabled}
              choices={[["Looks right", { confirm: true }]]}
              answer={answer}
            />
          )}
          <JsonForm question={question} answer={answer} disabled={disabled} />
        </>
      )}
      {answer.isError && (
        <p role="alert">
          {answer.error instanceof ApiError && answer.error.status === 400
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
    <p>
      {choices.map(([label, value]) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => answer.mutate(value)}
        >
          {label}
        </button>
      ))}
    </p>
  );
}

const labelFields: [keyof LabelValues, string][] = [
  ["kcal", "Calories (kcal)"],
  ["protein_g", "Protein (g)"],
  ["carbs_g", "Carbs (g)"],
  ["fat_g", "Fat (g)"],
  ["fiber_g", "Fiber (g, optional)"],
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
    <form onSubmit={submit}>
      <fieldset disabled={disabled}>
        {labelFields.map(([name, label]) => (
          <div key={name}>
            <label htmlFor={id(name)}>{label}</label>
            <input
              id={id(name)}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required={name !== "fiber_g"}
              value={values[name]}
              onChange={(event) =>
                setValues({ ...values, [name]: event.target.value })
              }
            />
          </div>
        ))}
        <label htmlFor={id("source")}>Source</label>
        <input
          id={id("source")}
          required
          maxLength={200}
          placeholder="Package label"
          value={values.source}
          onChange={(event) =>
            setValues({ ...values, source: event.target.value })
          }
        />
        <button type="submit">Save</button>
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
      onSubmit={(event) => {
        event.preventDefault();
        answer.mutate({ delivery_date: date });
      }}
    >
      <fieldset disabled={disabled}>
        <label htmlFor={id}>Delivery date</label>
        <input
          id={id}
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <button type="submit">Save</button>
      </fieldset>
    </form>
  );
}

// Order entry and corrections have nested meal lists; JSON keeps them answerable here.
function JsonForm({
  question,
  answer,
  disabled,
}: {
  question: Question;
  answer: Answer;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const id = `question-${question.id}-json`;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const value: unknown = JSON.parse(text);
          setInvalid(false);
          answer.mutate(value);
        } catch {
          setInvalid(true);
        }
      }}
    >
      <fieldset disabled={disabled}>
        <label htmlFor={id}>Answer (JSON)</label>
        <textarea
          id={id}
          required
          maxLength={8000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {invalid && <p role="alert">Not valid JSON</p>}
        <details>
          <summary>Answer format</summary>
          <pre>{JSON.stringify(question.answer_schema, null, 2)}</pre>
        </details>
        <button type="submit">Save</button>
      </fieldset>
    </form>
  );
}
