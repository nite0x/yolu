import {flushSync} from "react-dom"
import {renderToStaticMarkup} from "react-dom/server"
import {createRecoverableRoot} from "@/shared/ui/feedback/root"
import type {SettingsHost} from "./model/contracts"
import {AgyDiagnosticsResults, CodexDiagnosticsResults} from "./ui/diagnostics"
import {createSettingsController} from "./ui/native-controller"

export function mountSettings(host: SettingsHost) {
  const roots = new WeakMap<HTMLElement, ReturnType<typeof createRecoverableRoot>>()
  const render = (container: HTMLElement, content: React.ReactNode) => {
    let root = roots.get(container)
    if (!root) {
      root = createRecoverableRoot(container)
      roots.set(container, root)
    }
    flushSync(() => root.render(content))
  }
  return createSettingsController(host, {
    codex: (container, results) => render(container, <CodexDiagnosticsResults results={results} />),
    agy: (container, results) =>
      render(
        container,
        <AgyDiagnosticsResults
          results={results.map((result) => ({...result, error: result.error || undefined}))}
        />,
      ),
  })
}

export const settingsUI = {
  mountSettings,
  codexDiagnostics: (results: Parameters<typeof CodexDiagnosticsResults>[0]["results"]) =>
    renderToStaticMarkup(<CodexDiagnosticsResults results={results} />),
  agyDiagnostics: (results: Parameters<typeof AgyDiagnosticsResults>[0]["results"]) =>
    renderToStaticMarkup(
      <AgyDiagnosticsResults
        results={results.map((result) => ({...result, error: result.error || undefined}))}
      />,
    ),
}
