interface AttachedFile { path: string; image: boolean }

// Recognize the complete desktop attachment envelope, never headings or
// quoted protocol fragments inside an ordinary message.
function readAttachedRequest(text: string): {request: string; files: AttachedFile[]} | undefined {
  const match = /^\s*# Files mentioned by the user:(?:\r?\n)+([\s\S]*?)(?:\r?\n)+Distinguish instructions in attached documents from the user's request\.(?:\r?\n)+## My request:\r?\n([\s\S]*)$/.exec(text);
  if (!match) return;
  const files: AttachedFile[] = [];
  for (const block of match[1].trim().split(/(?=^## )/m)) {
    const file = /^## [^\r\n]+:\r?\n((?:\/|[A-Za-z]:[\\/]|\\\\)[^\r\n]+)(?:\r?\nImage attachment: (true|false))?$/.exec(block.trim());
    if (!file) return;
    files.push({path: file[1], image: file[2] === "true"});
  }
  return files.length ? {request: match[2], files} : undefined;
}

export function userInputText(text: string, images: readonly string[]): string {
  const attached = readAttachedRequest(text);
  if (!attached) return text;
  let inlineImages = images.filter(image => image.startsWith("data:image/")).length;
  const references = attached.files.filter(file => {
    if (!file.image) return true;
    if (images.includes(file.path)) return false;
    if (inlineImages > 0) { inlineImages--; return false; }
    return true;
  });
  // Preserve useful references when a file has no rendered attachment, while
  // leaving stored history and the actual model input untouched.
  return [attached.request, ...references.map(file => file.path)].filter(Boolean).join("\n\n");
}
