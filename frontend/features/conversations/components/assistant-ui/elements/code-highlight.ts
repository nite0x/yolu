import {createHighlighterCore} from "shiki/core"
import {createJavaScriptRegexEngine} from "shiki/engine/javascript"
import {bundledLanguages} from "./code-languages"
import light from "@shikijs/themes/github-light";
import dark from "@shikijs/themes/github-dark";

const highlighter = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [light, dark],
  langs: [],
});
const loadedLanguages = new Map<string, Promise<void>>();

export async function highlightCode(code: string, language: string) {
  const grammar = bundledLanguages.get(language.toLowerCase());
  if (!grammar) return;
  const { name, load } = grammar;
  const shiki = await highlighter;
  let loaded = loadedLanguages.get(name);
  if (!loaded) {
    loaded = load().then(module => shiki.loadLanguage(module.default));
    loadedLanguages.set(name, loaded);
  }
  await loaded;
  return shiki.codeToTokensWithThemes(code, {
    lang: name,
    themes: { light: "github-light", dark: "github-dark" },
  });
}
