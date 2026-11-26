import type {ComponentProps, ReactNode} from "react"
import {cn} from "../../lib/utils"
import {Badge} from "../primitives/badge"

export type StatusTone = "neutral" | "success" | "warning" | "error" | "accent"
const tones: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  accent:
    "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
}

/** Domain owners supply the label and map their own statuses to a presentation tone. */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant"> & {tone?: StatusTone; children: ReactNode}) {
  return (
    <Badge
      variant="outline"
      {...props}
      className={cn("shrink-0 rounded-md px-2 py-1 text-xs", tones[tone], className)}
    >
      {children}
    </Badge>
  )
}
