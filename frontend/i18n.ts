export type Language = "system" | "en" | "zh-CN";
export type Locale = Exclude<Language, "system">;
export function formatMessage(message: string, values: unknown[]): string {
  return message.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
export function uiLocale(): Locale {
  return typeof window === "undefined" ? "zh-CN" : window.YoluI18n?.locale || "zh-CN";
}
export function uiText(message: string, ...values: unknown[]): string {
  const runtime = typeof window === "undefined" ? undefined : window.YoluI18n;
  return runtime ? runtime.text(message, ...values) : formatMessage(message, values);
}
declare global {
  interface Window {
    YoluI18n?: {
      language: Language;
      locale: Locale;
      text(message: string, ...values: unknown[]): string;
      applyStatic(root?: ParentNode): void;
    };
  }
}
