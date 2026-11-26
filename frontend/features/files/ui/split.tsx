import {uiText} from "@/shared/i18n"
import {useId, useLayoutEffect, useRef, useState, type ReactNode} from "react"
import {setupSplitResize} from "@/shared/lib/split-resize"

const storageKey = "workhub:file-tree-size:v1"
export function FileSplit({tree, children}: {tree: ReactNode; children: ReactNode}) {
  const host = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLDivElement>(null)
  const listID = useId()
  const [stacked, setStacked] = useState(false)
  const [size, setSize] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "{}")
      const width = Number(value.width), height = Number(value.height)
      return {width: Number.isFinite(width) && width > 0 ? width : 220, height: Number.isFinite(height) && height > 0 ? height : 150}
    } catch {return {width: 220, height: 150}}
  })
  const latest = useRef(size)
  latest.current = size
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {if (element.clientWidth) setStacked(element.clientWidth <= 650)}
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    measure()
    return () => observer?.disconnect()
  }, [])
  useLayoutEffect(() => {
    const container = host.current, panel = list.current, separator = handle.current
    if (!container || !panel || !separator) return
    return setupSplitResize({
      handle: separator, container, panel, axis: stacked ? "y" : "x",
      bounds: () => {
        const total = container.getBoundingClientRect()[stacked ? "height" : "width"]
        return total > 0 ? {min: stacked ? 70 : 130, max: Math.max(stacked ? 70 : 130, total * (stacked ? .5 : .55))} : null
      },
      resize: value => {
        const next = {...latest.current, [stacked ? "height" : "width"]: value}
        latest.current = next
        setSize(next)
      },
      commit: () => {try {localStorage.setItem(storageKey, JSON.stringify(latest.current))} catch {/* Optional storage. */}},
    })
  }, [stacked])
  return <div ref={host} className="changes-layout file-split-layout" data-stacked={stacked} style={{"--file-tree-width": `${size.width}px`, "--file-tree-height": `${size.height}px`} as React.CSSProperties}>
    <div ref={list} id={listID} className="file-tree-pane">{tree}</div>
    {/* biome-ignore lint/a11y/useSemanticElements: This is an interactive, focusable window splitter, not a document rule. */}
    <div ref={handle} className="reading-splitter" role="separator" tabIndex={0} aria-controls={listID} aria-valuenow={stacked ? size.height : size.width} aria-label={uiText("调整文件树与内容区域大小")} aria-orientation={stacked ? "horizontal" : "vertical"} />
    {children}
  </div>
}
