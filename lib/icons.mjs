// Small line icons for buttons (16x16, drawn with currentColor), so a row of
// buttons can be told apart at a glance.
const paths = {
  play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  book: '<path d="M2.5 3.5c2-1 4-1 5.5.5v9c-1.5-1.5-3.5-1.5-5.5-.5zM13.5 3.5c-2-1-4-1-5.5.5v9c1.5-1.5 3.5-1.5 5.5-.5z"/>',
  pdf: '<path d="M4 1.5h5l3.5 3.5v9.5H4zM9 1.5V5h3.5"/><path d="M6 9.5h4.5M6 12h3"/>',
  slides: '<rect x="1.5" y="3.5" width="10" height="7" rx="1"/><path d="M4.5 13.5h10v-7"/>',
  talk: '<rect x="2" y="2" width="12" height="8" rx="1"/><path d="M8 10v2.5M5.5 14.5 8 12.5l2.5 2M5 7.5l2-2 1.5 1.5L11 4.5"/>',
  external: '<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5H3V4h3.5"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  arrow: '<path d="M2.5 8h11M9.5 4l4 4-4 4"/>',
};
export const icon = (name) => `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
