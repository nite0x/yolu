import {Component, type ErrorInfo, Fragment, type ReactNode} from "react"
import {uiText} from "../../i18n"
import {Button} from "../primitives/button"
import {Feedback} from "./message"

type Props = {children: ReactNode; onRetry?: () => void}
type State = {failed: boolean; attempt: number}

/** Keep failures inside their owning pane. Retained drafts stay outside this boundary. */
export class RenderBoundary extends Component<Props, State> {
  state: State = {failed: false, attempt: 0}
  static getDerivedStateFromError(): Partial<State> {
    return {failed: true}
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Yolu pane render failed", error, info.componentStack)
  }
  retry = () => {
    try {
      this.props.onRetry?.()
      this.setState((state) => ({failed: false, attempt: state.attempt + 1}))
    } catch (error) {
      console.error("Yolu pane recovery failed", error)
    }
  }
  render() {
    if (this.state.failed)
      return (
        <section className="shadcn-scope p-4" aria-label={uiText("页面恢复")}>
          <Feedback tone="error">{uiText("此区域暂时无法显示，请重试。")}</Feedback>
          <Button type="button" variant="outline" className="mt-3" onClick={this.retry}>
            {uiText("重试")}
          </Button>
        </section>
      )
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
