import {LoaderCircle} from "lucide-react"
import type {ComponentProps} from "react"
import {cn} from "../../lib/utils"

export function LoadingState({children, className, ...props}: ComponentProps<"div"> & {children: string}) {
  return (
    <div
      role="status"
      aria-atomic="true"
      {...props}
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      {children}
    </div>
  )
}
