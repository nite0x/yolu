import type {ComponentProps, ReactNode} from "react"
import {cn} from "../../lib/utils"
import {Input} from "../primitives/input"
import {Label} from "../primitives/label"

export function Check({
  label,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {label: ReactNode}) {
  return (
    <Label className="flex min-h-9 cursor-pointer items-center gap-2 leading-relaxed">
      <Input
        {...props}
        type="checkbox"
        className={cn("m-0 size-4 min-w-4 shrink-0 accent-primary shadow-none", className)}
      />
      <span>{label}</span>
    </Label>
  )
}
