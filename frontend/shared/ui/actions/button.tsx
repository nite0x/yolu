import {LoaderCircle} from "lucide-react"
import type {ComponentProps, ReactNode} from "react"
import {Button} from "../primitives/button"

type ButtonProps = ComponentProps<typeof Button>

/** Controller adapters retain their data-action/data-id event contract. */
export function Action({action, id, ...props}: ButtonProps & {action: string; id?: string}) {
  return <Button type="button" variant="outline" size="sm" data-action={action} data-id={id} {...props} />
}

export type IconButtonProps = Omit<ButtonProps, "asChild" | "aria-label" | "size"> & {
  label: string
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg"
}

export function IconButton({label, ...props}: IconButtonProps) {
  return <Button type="button" variant="ghost" size="icon" title={label} {...props} aria-label={label} />
}

/** The owner controls pending state and request lifetime. */
export function PendingButton({
  pending = false,
  pendingLabel,
  disabled,
  children,
  ...props
}: Omit<ButtonProps, "asChild"> & {
  pending?: boolean
  pendingLabel: ReactNode
}) {
  return (
    <Button type="button" {...props} disabled={disabled || pending} aria-busy={pending}>
      {pending && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
      {pending ? pendingLabel : children}
    </Button>
  )
}
