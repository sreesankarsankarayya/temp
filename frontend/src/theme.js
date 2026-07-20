const KEY = 'theme';

export function getThemePref() {
  return localStorage.getItem(KEY) || 'system';
}

export function applyTheme(pref) {
  if (pref === 'light' || pref === 'dark') {
    localStorage.setItem(KEY, pref);
    document.documentElement.dataset.theme = pref;
  } else {
    localStorage.setItem(KEY, 'system');
    delete document.documentElement.dataset.theme;
  }
  window.dispatchEvent(new CustomEvent('theme:changed'));
}
