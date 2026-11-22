// Temporary UI identity only; this never renames or creates a saved session.
export function draftTitle(text: string): string {
  return Array.from(text.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ")).slice(0, 60).join("");
}
