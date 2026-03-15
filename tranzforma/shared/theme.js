// theme.js - Light/Dark mode toggle with localStorage persistence

(function () {
  const KEY = 'tfTheme';
  const root = document.documentElement;

  // Apply saved theme immediately (before paint, no flash)
  root.dataset.theme = localStorage.getItem(KEY) || 'dark';

  window.toggleTheme = function () {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    localStorage.setItem(KEY, next);
  };
})();
