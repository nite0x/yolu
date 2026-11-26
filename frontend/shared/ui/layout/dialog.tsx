import {X} from "lucide-react"
import type {ComponentProps, ReactNode} from "react"
import {uiText} from "../../i18n"
import {cn} from "../../lib/utils"
import {IconButton, type IconButtonProps} from "../actions/button"
import {Button} from "../primitives/button"

/** Presentation only: the native dialog or React dialog owner manages focus and dismissal. */
export function ModalHeader({
  id,
  title,
  closeLabel = uiText("关闭"),
  closeButton,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  id: string
  title: ReactNode
  closeLabel?: string
  closeButton?: Omit<IconButtonProps, "label" | "children">
}) {
  return (
    <div {...props} className={cn("dialog-header mb-4 gap-4", className)}>
      <div>
        <h2 id={id} className="m-0 text-xl font-semibold">
          {title}
        </h2>
      </div>
      <IconButton
        label={closeLabel}
        {...closeButton}
        className={cn("close-dialog shrink-0", closeButton?.className)}
      >
        <X aria-hidden="true" />
      </IconButton>
    </div>
  )
}

export function ModalFooter({
  children,
  note,
  closeLabel = uiText("取消"),
  closeButton,
  className,
  ...props
}: ComponentProps<"div"> & {
  note?: ReactNode
  closeLabel?: string
  closeButton?: Omit<ComponentProps<typeof Button>, "asChild" | "children">
}) {
  return (
    <div {...props} className={cn("dialog-footer", className)}>
      {note && <span className="footer-note">{note}</span>}
      <Button
        type="button"
        variant="outline"
        {...closeButton}
        className={cn("close-dialog", closeButton?.className)}
      >
        {closeLabel}
      </Button>
      {children}
    </div>
  )
}
