import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Without these groups tailwind-merge reads text-step-* as a color and drops the real text color.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["step--1", "step-0", "step-1", "step-2", "step-3"] },
      ],
      rounded: [{ rounded: ["token"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
