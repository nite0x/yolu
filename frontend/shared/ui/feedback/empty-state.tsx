import type {ReactNode} from "react"
import {Card} from "../primitives/card"

export function EmptyState({
  title,
  description,
  actions,
  header,
}: {
  title: string
  description: string
  actions?: ReactNode
  header?: ReactNode
}) {
  return (
    <Card className="shadcn-scope min-h-72 items-center justify-center gap-4 rounded-none border-0 p-8 text-center shadow-none">
      {header}
      <h2 className="m-0 text-lg font-semibold">{title}</h2>
      <p className="m-0 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actions}
    </Card>
  )
}
