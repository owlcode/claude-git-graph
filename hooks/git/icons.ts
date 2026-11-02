/** The pane's icons: 16-unit SVG strokes, drawn bare (no button chrome) at 18px. */
export const ICONS = {
  sync: '<path d="M8 2v8"/><path d="M4.5 6.5 8 10l3.5-3.5"/><path d="M2.5 10.5v3h11v-3"/>',
  cleanup: '<path d="M11.5 2 7.2 8.6"/><path d="M4.2 8.6h6l1.3 5H2.8z"/><path d="M5.6 11v2.6M8.2 11v2.6"/>',
  delete: '<path d="M2.5 4.5h11"/><path d="M6.5 4.5V2.8h3v1.7"/><path d="M4 4.5l.8 9h6.4l.8-9"/>',
  merge: '<circle cx="4" cy="3" r="1.6"/><circle cx="4" cy="13" r="1.6"/><circle cx="12" cy="8" r="1.6"/><path d="M4 4.6v6.8"/><path d="M4 4.6c0 3.4 2.6 3.4 6.4 3.4"/>',
  rebase: '<circle cx="4" cy="13" r="1.6"/><circle cx="12" cy="3" r="1.6"/><path d="M4 11.4V8a3 3 0 0 1 3-3h3.4"/><path d="M8.6 1.2 10.4 3 8.6 4.8"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3 10.5V3.8c0-.5.3-.8.8-.8h6.7"/>',
  ask: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  more: '<circle cx="3.5" cy="8" r="0.9"/><circle cx="8" cy="8" r="0.9"/><circle cx="12.5" cy="8" r="0.9"/>',
  columns: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10M10 3v10"/>',
  checkout: '<path d="M7 2.5h5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H7"/><path d="M2 8h7.5"/><path d="M7 5.5 9.5 8 7 10.5"/>',
} as const
