import english from "./locales/en.json";
import { formatMessage, type Language, type Locale } from "./i18n";

const catalog: Record<string, string> = english;
const preference = document.querySelector<HTMLMetaElement>('meta[name="ui-language"]')?.content;
const language: Language = preference === "en" || preference === "zh-CN" ? preference : "system";
const languages = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
export function resolveLocale(choice: Language, preferred: readonly string[]): Locale {
  if (choice !== "system") return choice;
  return preferred[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
const locale = resolveLocale(language, languages);
function text(message: string, ...values: unknown[]) {
  return formatMessage(locale === "en" ? catalog[message] ?? message : message, values);
}
// Only explicitly marked application labels are translated. User content,
// messages, file previews and terminal output never pass through a DOM walker.
function applyStatic(root: ParentNode = document) {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) element.textContent = text(element.dataset.i18n!);
  for (const attribute of ["title", "placeholder", "aria-label"]) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, text(element.getAttribute(`data-i18n-${attribute}`)!));
    }
  }
}
window.YoluI18n = { language, locale, text, applyStatic };
if (document.documentElement) document.documentElement.lang = locale;
applyStatic();

// Native menu localization is the only application command granted here.
const native = (window.top as Window & { __TAURI_INTERNALS__?: {invoke(command: string, args: Record<string, unknown>): Promise<unknown>} })?.__TAURI_INTERNALS__;
if (native) void native.invoke("set_ui_language", {language:locale}).catch(() => {});
