import {IconButton} from "../frontend/shared/ui/actions/button"
import {StatusBadge} from "../frontend/shared/ui/data-display/status-badge"
import type {Field} from "../frontend/shared/ui/forms/field"

// Compile-time API checks, included in tsc and never imported by the product.
// @ts-expect-error Icon-only actions must have an accessible label.
const missingLabel = <IconButton />
// @ts-expect-error Domain status names are mapped by feature owners.
const businessStatus = <StatusBadge tone="creating">Creating</StatusBadge>
// @ts-expect-error Each field needs a stable input id.
const missingIdentity: Parameters<typeof Field>[0] = {label: "Name", children: null}
void [missingLabel, businessStatus, missingIdentity]
