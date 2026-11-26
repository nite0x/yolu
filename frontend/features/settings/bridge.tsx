import {renderToStaticMarkup} from "react-dom/server"
import {AgyDiagnosticsResults, CodexDiagnosticsResults} from "./ui/settings"

export const settingsUI = {
  codexDiagnostics: (results: Parameters<typeof CodexDiagnosticsResults>[0]["results"]) => renderToStaticMarkup(<CodexDiagnosticsResults results={results} />),
  agyDiagnostics: (results: Parameters<typeof AgyDiagnosticsResults>[0]["results"]) => renderToStaticMarkup(<AgyDiagnosticsResults results={results} />),
}
