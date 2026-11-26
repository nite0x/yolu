import type {ComponentProps} from "react"
import {cn} from "../lib/utils"

export function SplitLayout({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn("workspace-split-layout", className)} {...props} />;
}

// Legacy controllers use the same workspace-pane class on their static markup.
export function ApplicationPane({
  as: Element = "section",
  className,
  ...props
}: ComponentProps<"section"> & { as?: "section" | "aside" }) {
  return <Element className={cn("workspace-pane", className)} {...props} />;
}
