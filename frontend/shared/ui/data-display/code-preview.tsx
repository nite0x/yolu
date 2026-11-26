import {Card} from "../primitives/card"

export function Preview({title, id}: {title: string; id: string}) {
  return (
    <Card className="gap-2 rounded-lg bg-muted p-4 shadow-none">
      <div className="text-xs text-foreground">{title}</div>
      <pre id={id} className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-relaxed" />
    </Card>
  )
}
