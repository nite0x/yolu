import type {ReactNode} from "react"
import {cn} from "../../lib/utils"
import {Table, TableBody, TableHead, TableHeader, TableRow} from "../primitives/table"

export function DataTable({
  headers,
  children,
  label,
  containerClassName,
  headerClassName,
}: {
  headers: string[]
  children: ReactNode
  label: string
  containerClassName?: string
  headerClassName?: string
}) {
  return (
    <Table role="table" aria-label={label} containerClassName={containerClassName}>
      <TableHeader role="rowgroup">
        <TableRow role="row">
          {headers.map((title) => (
            <TableHead
              key={title}
              role="columnheader"
              scope="col"
              className={cn("bg-muted px-3 text-xs text-foreground whitespace-normal", headerClassName)}
            >
              {title}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody role="rowgroup">{children}</TableBody>
    </Table>
  )
}
