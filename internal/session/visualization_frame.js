// Render the common Lucide placeholders used by self-contained HTML previews.
const visualizationIcons = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  x: '<path d="m18 6-12 12M6 6l12 12"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  'arrow-up': '<path d="M12 19V5m-7 7 7-7 7 7"/>',
  'sliders-horizontal': '<path d="M21 4h-7m-4 0H3m18 8h-9m-4 0H3m18 8h-5m-4 0H3M14 2v4m-6 4v4m8 4v4"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4"/>',
};

window.lucide = {
  createIcons() {
    for (const icon of document.querySelectorAll('i[data-lucide]')) {
      const name = icon.dataset.lucide;
      if (!Object.hasOwn(visualizationIcons, name)) continue;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const attr of icon.attributes) svg.setAttribute(attr.name, attr.value);
      for (const [key, value] of Object.entries({viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})) {
        svg.setAttribute(key, value);
      }
      svg.innerHTML = visualizationIcons[name];
      icon.replaceWith(svg);
    }
  },
};

window.addEventListener('DOMContentLoaded', () => {
  window.lucide.createIcons();
  const resize = () => parent.postMessage({type: 'yolu-visualization', height: Math.ceil(document.body.getBoundingClientRect().height)}, '*');
  new ResizeObserver(resize).observe(document.body);
  resize();
});
