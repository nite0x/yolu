import {createContext, useContext, useRef, useState, type ComponentProps} from "react"
import {uiText} from "@/shared/i18n"
import {cn} from "@/shared/lib/utils"

type Size = { width: number; height: number };
type Axis = "width" | "height" | "both";
type ResizeAction = (x: number, y: number) => void;

function ResizeHandle({ axis, label, className, start, reset }: {
  axis: Axis;
  label: string;
  className: string;
  start: (handle: HTMLButtonElement) => ResizeAction | undefined;
  reset: (handle: HTMLButtonElement) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; y: number; resize: ResizeAction } | null>(null);
  const horizontal = axis !== "height";
  const vertical = axis !== "width";
  const shortcuts = [horizontal && "ArrowLeft ArrowRight", vertical && "ArrowUp ArrowDown", "Home"].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      aria-keyshortcuts={shortcuts}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const resize = start(event.currentTarget);
        if (!resize) return;
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, resize };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (active?.pointer !== event.pointerId) return;
        active.resize(event.clientX - active.x, event.clientY - active.y);
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={event => reset(event.currentTarget)}
      onKeyDown={event => {
        if (event.key === "Home") {
          event.preventDefault();
          reset(event.currentTarget);
          return;
        }
        const step = event.shiftKey ? 40 : 12;
        const x = horizontal ? ({ ArrowLeft: -step, ArrowRight: step } as Record<string, number>)[event.key] ?? 0 : 0;
        const y = vertical ? ({ ArrowUp: -step, ArrowDown: step } as Record<string, number>)[event.key] ?? 0 : 0;
        if (x || y) {
          event.preventDefault();
          start(event.currentTarget)?.(x, y);
        }
      }}
    />
  );
}

const ColumnResize = createContext<{ start: ComponentProps<typeof ResizeHandle>["start"]; reset: ComponentProps<typeof ResizeHandle>["reset"] } | null>(null);
const getCell = (handle: HTMLButtonElement) => handle.closest("td, th") as HTMLTableCellElement | null;
const getRow = (handle: HTMLButtonElement) => handle.closest("tr");

export function TableColumnHandle() {
  const column = useContext(ColumnResize);
  return column && <ResizeHandle axis="width" label={uiText("调整列宽")} className="aui-md-column-resize" {...column} />;
}

export function TableRowHandle() {
  return (
    <ResizeHandle axis="height" label={uiText("调整行高")} className="aui-md-row-resize"
      start={handle => {
        const row = getRow(handle);
        if (!row) return;
        const height = row.getBoundingClientRect().height;
        return (_x, y) => { row.style.height = `${Math.max(24, height + y)}px`; };
      }}
      reset={handle => getRow(handle)?.style.removeProperty("height")}
    />
  );
}

export function MarkdownTable({ className, children, style, ...props }: ComponentProps<"table">) {
  const frame = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLElement>(null);
  const [size, setSize] = useState<Size>();
  const [columns, setColumns] = useState<{ widths: number[]; initial: number[] }>();

  const width = columns?.widths.reduce((total, column) => total + column, 0);
  const columnControls = {
    start(handle: HTMLButtonElement) {
      const cell = getCell(handle);
      const row = getRow(handle);
      if (!cell || !row) return;
      const initial = columns?.initial ?? Array.from(row.cells, item => item.getBoundingClientRect().width);
      const widths = columns?.widths ?? initial;
      const index = cell.cellIndex;
      const startWidth = widths[index];
      return (x: number) => {
        const next = widths.slice();
        next[index] = Math.max(48, startWidth + x);
        setColumns({ widths: next, initial });
      };
    },
    reset(handle: HTMLButtonElement) {
      const index = getCell(handle)?.cellIndex;
      if (index === undefined) return;
      setColumns(current => {
        if (!current) return;
        const widths = current.widths.slice();
        widths[index] = current.initial[index];
        return widths.every((value, position) => value === current.initial[position]) ? undefined : { ...current, widths };
      });
    },
  };

  return (
    <div ref={frame} className="aui-md-table-frame">
      <div className="aui-md-table-box" style={{ width: size?.width }}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The named overflow region must receive focus for keyboard scrolling. */}
        <section ref={viewport} tabIndex={0} className="aui-md-table-wrapper" aria-label={uiText("表格")} style={{ height: size?.height }}>
          <ColumnResize.Provider value={columnControls}>
            <table className={cn("aui-md-table w-full border-separate border-spacing-0", className)}
              data-resized={!!columns} style={{ ...style, width }} {...props}>
              {columns && <colgroup>{columns.widths.map((column, index) => /* biome-ignore lint/suspicious/noArrayIndexKey: Column width slots are fixed table positions; resizing never reorders them. */
                <col key={index} style={{ width: column }} />)}</colgroup>}
              {children}
            </table>
          </ColumnResize.Provider>
        </section>
        <ResizeHandle axis="both" label={uiText("调整表格大小")} className="aui-md-table-resize"
          start={() => {
            if (!viewport.current || !frame.current) return;
            const bounds = viewport.current.getBoundingClientRect();
            const maxWidth = frame.current.clientWidth;
            return (x, y) => setSize({
              width: Math.min(maxWidth, Math.max(160, bounds.width + x)),
              height: Math.max(80, bounds.height + y),
            });
          }}
          reset={() => setSize(undefined)}
        />
      </div>
    </div>
  );
}
