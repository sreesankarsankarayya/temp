import { api, setToken, getToken } from './api.js';

export const ROLE_LEVELS = { user: 1, operator: 2, sysadmin: 3, admin: 4 };

class Store extends EventTarget {
  user = null;
  meta = { app_name: 'app', version: '0.0.0', env: 'None', is_production: true };

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  hasRole(minimum) {
    if (!this.user) return false;
    return ROLE_LEVELS[this.user.role] >= ROLE_LEVELS[minimum];
  }

  async loadMeta() {
    try {
      this.meta = await api('/api/meta');
    } catch {
      /* backend not reachable yet; defaults stay */
    }
    this.emit();
  }

  async restoreSession() {
    if (!getToken()) return;
    try {
      this.user = await api('/api/auth/me');
    } catch {
      this.user = null;
    }
    this.emit();
  }

  async login(username, password) {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    setToken(data.token);
    this.user = data.user;
    this.emit();
  }

  async logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* token may already be invalid */
    }
    setToken(null);
    this.user = null;
    this.emit();
  }
}

export const store = new Store();

window.addEventListener('auth:expired', () => {
  store.user = null;
  store.emit();
});

export function toast(message, kind = 'info') {
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, kind } }));
}
