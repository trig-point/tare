import { useState } from "react";
import { type Choice, eatingOutOverride } from "./eating-out-fields.ts";
import { Button, cn } from "./shared/ui/index.ts";

export function useFoodChoiceTag(food: Choice) {
  const [selected, setSelected] = useState<boolean>();
  const override = eatingOutOverride(food, selected);
  return {
    checked: override ?? food.eating_out_default ?? false,
    override,
    setSelected,
  };
}

export function EatingOutSwitch({
  checked,
  eligible,
  disabled,
  onChange,
}: {
  checked: boolean;
  eligible: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || (!checked && !eligible)}
      variant="ghost"
      className="w-fit gap-2 transition-[background-color,scale] duration-(--motion-press) ease-move active:scale-[0.97]"
      onClick={() => onChange(!checked)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-9 items-center rounded-full border border-border p-0.5",
          checked ? "justify-end bg-accent" : "justify-start bg-surface",
        )}
      >
        <span className="size-3.5 rounded-full border border-border bg-surface" />
      </span>
      Eating out
    </Button>
  );
}
