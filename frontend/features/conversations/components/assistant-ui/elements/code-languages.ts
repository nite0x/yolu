// Keep the common fence grammars in the lazily loaded highlighter bundle.
import type {LanguageInput} from "shiki/core"

type Loader = () => Promise<{ default: LanguageInput }>;

const languages: [string[], Loader][] = [
  [["json"], () => import("@shikijs/langs/json")],
  [["jsonc"], () => import("@shikijs/langs/jsonc")],
  [["yaml", "yml"], () => import("@shikijs/langs/yaml")],
  [["toml"], () => import("@shikijs/langs/toml")],
  [["javascript", "js", "mjs", "cjs"], () => import("@shikijs/langs/javascript")],
  [["typescript", "ts", "mts", "cts"], () => import("@shikijs/langs/typescript")],
  [["jsx"], () => import("@shikijs/langs/jsx")],
  [["tsx"], () => import("@shikijs/langs/tsx")],
  [["html"], () => import("@shikijs/langs/html")],
  [["css"], () => import("@shikijs/langs/css")],
  [["python", "py"], () => import("@shikijs/langs/python")],
  [["shellscript", "sh", "bash", "shell", "zsh"], () => import("@shikijs/langs/shellscript")],
  [["powershell", "ps1"], () => import("@shikijs/langs/powershell")],
  [["sql"], () => import("@shikijs/langs/sql")],
  [["go", "golang"], () => import("@shikijs/langs/go")],
  [["rust", "rs"], () => import("@shikijs/langs/rust")],
  [["java"], () => import("@shikijs/langs/java")],
  [["c"], () => import("@shikijs/langs/c")],
  [["cpp", "c++"], () => import("@shikijs/langs/cpp")],
  [["csharp", "c#", "cs"], () => import("@shikijs/langs/csharp")],
  [["diff", "patch"], () => import("@shikijs/langs/diff")],
  [["xml"], () => import("@shikijs/langs/xml")],
];

export const bundledLanguages = new Map(
  languages.flatMap(([aliases, load]) => aliases.map(alias => [alias, { name: aliases[0], load }] as const)),
);
