import {build} from "esbuild";
import {mkdir, readFile, writeFile, readdir, rm} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {build as buildCSS} from "vite";
import tailwindcss from "@tailwindcss/vite";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "web/chat"), {recursive: true});
await rm(path.join(root, "web/chat/highlight"), {recursive: true, force: true});
await rm(path.join(root, "web/chat/diagrams"), {recursive: true, force: true});
const bundle = {absWorkingDir: root, bundle: true, minify: true, format: "esm", target: ["es2022"], jsx: "automatic", define: {"process.env.NODE_ENV": '"production"'}, legalComments: "linked", metafile: true,
  plugins: [{name: "css-built-by-vite", setup(builder) {
    builder.onLoad({filter: /\.css$/}, () => ({contents: "", loader: "css"}));
  }}],
};
const results = await Promise.all([
  build({...bundle, entryPoints: ["frontend/entrypoints/conversation.tsx"], outfile: "web/chat/assistant.js"}),
  build({...bundle, entryPoints: {mermaid: "frontend/features/conversations/components/assistant-ui/elements/mermaid-renderer.ts"}, outdir: "web/chat", splitting: true, chunkNames: "diagrams/[name]-[hash]"}),
  build({...bundle, entryPoints: ["frontend/features/conversations/components/assistant-ui/elements/code-highlight.ts"], outdir: "web/chat/highlight", splitting: true}),
]);
// Official registry components ship Tailwind classes. Compile their stylesheet
// independently so chat:build doesn't depend on a preceding application UI build.
await buildCSS({
  root, configFile: false, plugins: [tailwindcss()],
  build: {outDir: "web/chat", emptyOutDir: false, rollupOptions: {
    input: "frontend/features/conversations/ui/chat.css", output: {assetFileNames: "assistant.css"},
  }},
});
const packages = new Map();
for (const input of [...results.flatMap(result => Object.keys(result.metafile.inputs)), "node_modules/tw-shimmer/package.json", "node_modules/tw-animate-css/package.json"]) {
  const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (!match || packages.has(match[1])) continue;
  const directory = path.join(root, match[1]);
  const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  const texts = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isFile() && /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name)) texts.push(await readFile(path.join(directory, entry.name), "utf8"));
  }
  if (!texts.length) texts.push(await readFile(path.join(root, "scripts/licenses", pkg.name.replaceAll("/", "_") + ".txt"), "utf8"));
  packages.set(match[1], `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\n${texts.join("\n").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd()}\n`);
}
const registryLicenses = `\nOfficial assistant-ui registry sources\n${await readFile(path.join(root, "frontend/features/conversations/components/assistant-ui/LICENSE"), "utf8")}\nOfficial shadcn UI sources\n${await readFile(path.join(root, "frontend/shared/ui/SHADCN-LICENSE.md"), "utf8")}`;
await writeFile(path.join(root,"web/chat/THIRD-PARTY-NOTICES.txt"), ("Yolu conversation UI — browser dependency licenses\n" + registryLicenses + [...packages].sort(([a],[b])=>a.localeCompare(b)).map(([,text])=>text).join("")).trimEnd() + "\n");
const legalPath = path.join(root, "web/chat/assistant.js.LEGAL.txt");
await writeFile(legalPath, (await readFile(legalPath, "utf8")).replace(/\r\n/g, "\n").replace(/^[ \t]+/gm, "").trimEnd() + "\n");
console.log(`Built assistant-ui conversation UI (${packages.size} dependency license notices)`);
