import { LitElement, html, nothing } from 'lit';
import { store } from '../store.js';

export class AppRoot extends LitElement {
  static properties = {
    route: { state: true },
    sidebarOpen: { state: true },
    modal: { state: true }, // null | 'changelog' | 'feedback'
    toasts: { state: true },
  };

  createRenderRoot() {
    return this; // light DOM so the global glass stylesheet applies
  }

  constructor() {
    super();
    this.route = location.hash.replace(/^#\/?/, '') || 'dashboard';
    this.sidebarOpen = false;
    this.modal = null;
    this.toasts = [];
    this._onStore = () => this.requestUpdate();
    this._onHash = () => {
      this.route = location.hash.replace(/^#\/?/, '') || 'dashboard';
      this.sidebarOpen = false;
    };
    this._onToast = (e) => {
      const toast = { id: Date.now() + Math.random(), ...e.detail };
      this.toasts = [...this.toasts, toast];
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== toast.id);
      }, 3500);
    };
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('change', this._onStore);
    window.addEventListener('hashchange', this._onHash);
    window.addEventListener('app:toast', this._onToast);
    store.loadMeta();
    store.restoreSession();
    document.title = 'Loading…';
    store.addEventListener('change', () => {
      document.title = `${store.meta.app_name} · v${store.meta.version}`;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('change', this._onStore);
    window.removeEventListener('hashchange', this._onHash);
    window.removeEventListener('app:toast', this._onToast);
  }

  openModal(name) {
    this.modal = name;
  }

  renderView() {
    if (this.route === 'tokenomics' && store.hasRole('sysadmin')) {
      return html`<tokenomics-view></tokenomics-view>`;
    }
    if (this.route === 'activity') {
      return html`<activity-view></activity-view>`;
    }
    if (this.route === 'settings') {
      return html`<settings-view></settings-view>`;
    }
    return html`<dashboard-view></dashboard-view>`;
  }

  render() {
    if (!store.user) {
      return html`<login-view></login-view>${this.renderToasts()}`;
    }
    return html`
      <div class="app-layout">
        ${this.sidebarOpen
          ? html`<div class="sidebar-scrim" @click=${() => (this.sidebarOpen = false)}></div>`
          : nothing}
        <side-bar
          class="glass sidebar ${this.sidebarOpen ? 'open' : ''}"
          .route=${this.route}
          @show-changelog=${() => this.openModal('changelog')}
        ></side-bar>
        <div class="main-col">
          <top-bar
            .route=${this.route}
            @toggle-sidebar=${() => (this.sidebarOpen = !this.sidebarOpen)}
            @show-feedback=${() => this.openModal('feedback')}
          ></top-bar>
          ${this.renderView()}
        </div>
      </div>
      ${this.modal === 'changelog'
        ? html`<changelog-modal @close=${() => (this.modal = null)}></changelog-modal>`
        : nothing}
      ${this.modal === 'feedback'
        ? html`<feedback-modal @close=${() => (this.modal = null)}></feedback-modal>`
        : nothing}
      ${this.renderToasts()}
    `;
  }

  renderToasts() {
    if (!this.toasts.length) return nothing;
    return html`<div class="toast-host">
      ${this.toasts.map(
        (t) => html`<div class="toast glass glass-strong" style=${t.kind === 'error' ? 'color: var(--danger)' : ''}>
          ${t.message}
        </div>`
      )}
    </div>`;
  }
}

customElements.define('app-root', AppRoot);
