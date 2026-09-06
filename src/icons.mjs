// Shared, code-drawn icons. No font or network dependency.
const paths = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  history:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  budgets:'<path d="M12 3v9h9A9 9 0 1 1 12 3Z"/><path d="M16 3.9A9 9 0 0 1 20.1 8H16Z"/>',
  export:'<path d="M12 15V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  left:'<path d="m14 6-6 6 6 6"/>', right:'<path d="m10 6 6 6-6 6"/>',
  expense:'<path d="m7 7 10 10M7 17h10V7"/>', income:'<path d="m7 17 10-10M7 7h10v10"/>',
  restore:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden:'<path d="m3 3 18 18M10 5.2A12 12 0 0 1 12 5c6.4 0 10 7 10 7a19 19 0 0 1-3 3.7M6.3 6.3A21 21 0 0 0 2 12s3.6 7 10 7a12 12 0 0 0 5.1-1.2M10 10a3 3 0 0 0 4 4"/>',
  settings:'<path d="m9 3-.6 2.3-2 .9L4.3 6 2.8 8.6l1.5 1.8v2.3l-1.5 1.8L4.3 17l2.2-.3 1.9 1L9 20h3l.6-2.3 2-1 2.1.3 1.5-2.5-1.5-1.8v-2.3l1.5-1.8L16.7 6l-2.2.2-1.9-.9L12 3Z" transform="translate(1.5 .5)"/><circle cx="12" cy="12" r="3"/>',
};
export function icon(name) {
  return `<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.history}</svg>`;
}
