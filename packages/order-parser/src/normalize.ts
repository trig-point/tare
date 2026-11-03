import { convert, type HtmlToTextOptions } from "html-to-text";

const htmlOptions: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    {
      selector: "table",
      format: "dataTable",
      options: { uppercaseHeaderCells: false, rowSpacing: 0, colSpacing: 1 },
    },
    { selector: "a", options: { ignoreHref: true } },
    ...["img", "head", "style", "script"].map((selector) => ({
      selector,
      format: "skip",
    })),
    { selector: "[style]", format: "styled" },
  ],
  formatters: {
    styled(element, walk, builder) {
      const { style, ...attributes } = element.attribs as Record<
        string,
        string
      >;
      const hidden = style?.split(";").some((declaration) => {
        const [property, value] = declaration
          .toLowerCase()
          .split(":")
          .map((part) => part.trim());
        const setting = value?.split("!")[0]?.trim();
        return (
          (property === "display" && setting === "none") ||
          (property === "visibility" && setting === "hidden")
        );
      });
      if (!hidden) walk([{ ...element, attribs: attributes }], builder);
    },
  },
};

export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeEmail(email: {
  subject: string;
  text?: string;
  html?: string;
}): string | null {
  if (
    [email.subject, email.text ?? "", email.html ?? ""].reduce(
      (total, part) => total + Buffer.byteLength(part),
      0,
    ) >
    256 * 1024
  )
    return null;
  const text = normalize(
    `${email.subject}\n${email.text ?? convert(email.html ?? "", htmlOptions)}`,
  );
  return text.length > 20_000 ? null : text;
}
