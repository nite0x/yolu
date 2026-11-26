import type {ComponentProps, ReactNode} from "react"
import {cn} from "../../lib/utils"
import {HelpTip} from "../help-tip"

export function SectionHeading({
  id,
  title,
  children,
  actions,
  level = 3,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  id: string
  title: string
  actions?: ReactNode
  level?: 2 | 3 | 4
}) {
  const Heading = `h${level}` as "h2" | "h3" | "h4"
  return (
    <div {...props} className={cn("flex items-center justify-between gap-3", className)}>
      <div className="ui-label-group">
        <Heading id={id} className="m-0 text-sm font-semibold">
          {title}
        </Heading>
        {children && (
          <HelpTip id={`${id}-help`} label={title}>
            {children}
          </HelpTip>
        )}
      </div>
      {actions}
    </div>
  )
}
