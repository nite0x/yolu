import type {ReactNode} from "react"
import {createRoot, type Root} from "react-dom/client"
import {RenderBoundary} from "./render-boundary"

export function createRecoverableRoot(container: Element): Root {
  const root = createRoot(container)
  return {
    render(children: ReactNode) {
      root.render(<RenderBoundary>{children}</RenderBoundary>)
    },
    unmount() {
      root.unmount()
    },
  }
}
