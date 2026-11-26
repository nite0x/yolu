import {Children, type ComponentProps, cloneElement, isValidElement, type ReactNode} from "react"
import {cn} from "../../lib/utils"
import {HelpTip} from "../help-tip"
import {Label} from "../primitives/label"

export type FieldControlProps = {id: string} & Pick<
  ComponentProps<"input">,
  "required" | "aria-describedby" | "aria-invalid"
>
export type FieldProps = Omit<ComponentProps<"div">, "id" | "children"> & {
  id: string
  label: string
  help?: string
  helpDisplay?: "inline" | "tooltip"
  error?: string
  required?: boolean
  children: ReactNode | ((control: FieldControlProps) => ReactNode)
}

/** Direct controls are associated automatically; wrapped controls use the render prop. */
export function Field({
  id,
  label,
  help,
  helpDisplay = "inline",
  error,
  required,
  children,
  className,
  ...props
}: FieldProps) {
  const control: FieldControlProps = {
    id,
    ...(required ? {required: true} : {}),
    "aria-describedby": [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined,
    ...(error ? {"aria-invalid": true} : {}),
  }
  const content =
    typeof children === "function"
      ? children(control)
      : Children.map(children, (child) => {
          if (!isValidElement<FieldControlProps>(child) || child.props.id !== id) return child
          const description =
            [
              ...new Set(
                [child.props["aria-describedby"], control["aria-describedby"]]
                  .filter(Boolean)
                  .join(" ")
                  .split(/\s+/)
                  .filter(Boolean),
              ),
            ].join(" ") || undefined
          return cloneElement(child, {...control, "aria-describedby": description})
        })
  const labelContent = (
    <Label id={`${id}-label`} htmlFor={id} className="leading-relaxed">
      {label}
      {required && (
        <span className="text-destructive" aria-hidden="true">
          {" "}
          *
        </span>
      )}
    </Label>
  )
  return (
    <div {...props} className={cn("field grid gap-2", className)} data-invalid={error ? true : undefined}>
      {help && helpDisplay === "tooltip" ? (
        <div className="ui-label-group">
          {labelContent}
          <HelpTip id={`${id}-help`} label={label}>
            {help}
          </HelpTip>
        </div>
      ) : (
        labelContent
      )}
      {content}
      {help && helpDisplay === "inline" && (
        <small id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          {help}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} role="alert" className="text-xs leading-relaxed text-destructive">
          {error}
        </small>
      )}
    </div>
  )
}
