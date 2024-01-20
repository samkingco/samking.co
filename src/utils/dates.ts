function getLocale() {
  return typeof window === "undefined" ? "en-GB" : navigator.language;
}

export function formatDate(
  date: Date | null | undefined,
  locale = getLocale()
): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reverse()
    .map((part) => (part.type === "literal" ? "-" : part.value))
    .join("");
}
