import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  suppressErrorRendering: true,
  secure: [
    "secure", "startOnLoad", "securityLevel", "maxTextSize", "maxEdges",
    "suppressErrorRendering", "htmlLabels", "themeCSS",
  ],
});

let nextID = 0;

export async function renderDiagram(code: string) {
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.visibility = "hidden";
  document.body.append(container);
  try {
    const { svg } = await mermaid.render(`yolu-mermaid-${++nextID}`, code, container);
    // An SVG loaded as an image has no active links, scripts or external resources.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } finally {
    container.remove();
  }
}
