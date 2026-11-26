"use client";

import {useEffect, useRef, useState} from "react"

export type UseCopyToClipboardOptions = {
  copiedDuration?: number;
};

function copyWithSelection(value: string) {
  const active = document.activeElement;
  const selection = document.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) => selection!.getRangeAt(index));
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    if (ranges.length) {
      selection?.removeAllRanges();
      ranges.forEach(range => selection?.addRange(range));
    }
  }
}

export const useCopyToClipboard = ({
  copiedDuration = 3000,
}: UseCopyToClipboardOptions = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const scopeGenerationRef = useRef(0);

  useEffect(
    () => () => {
      scopeGenerationRef.current += 1;
      if (copiedTimerRef.current === undefined) return;

      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = undefined;
      setIsCopied(false);
    },
    [],
  );

  const copyToClipboard = async (value: string) => {
    if (!value) return;
    const scopeGeneration = scopeGenerationRef.current;
    let copied: boolean;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        copied = true;
      } else {
        copied = copyWithSelection(value);
      }
    } catch {
      if (scopeGeneration !== scopeGenerationRef.current) return;
      copied = copyWithSelection(value);
    }
    if (scopeGeneration !== scopeGenerationRef.current) return;
    setCopyFailed(!copied);
    if (!copied) return;
    clearTimeout(copiedTimerRef.current);
    setIsCopied(true);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = undefined;
      setIsCopied(false);
    }, copiedDuration);
  };

  return { isCopied, copyFailed, copyToClipboard };
};

