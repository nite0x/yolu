import type {ComponentProps} from "react"
import {cn} from "../../lib/utils"
import {Alert} from "../primitives/alert"

export function Feedback({
  tone = "info",
  className,
  ...props
}: Omit<ComponentProps<typeof Alert>, "variant"> & {tone?: "info" | "error"}) {
  return (
    <Alert
      variant={tone === "error" ? "destructive" : "default"}
      role={tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      {...props}
      className={cn("block whitespace-pre-wrap text-sm leading-relaxed", className)}
    />
  )
}
