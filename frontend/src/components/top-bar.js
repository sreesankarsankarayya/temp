import { LitElement, html, nothing } from 'lit';
import { store } from '../store.js';

const TITLES = { dashboard: 'Dashboard', activity: 'Activity log', tokenomics: 'Tokenomics', settings: 'Settings' };

export class TopBar extends LitElement {
  static properties = {
    route: { type: String },
    menuOpen: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.menuOpen = false;
    this._onDocClick = (e) => {
      if (this.menuOpen && !e.composedPath().includes(this.querySelector('.profile-wrap'))) {
        this.menuOpen = false;
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocClick);
    this._onStore = () => this.requestUpdate();
    store.addEventListener('change', this._onStore);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick);
    store.removeEventListener('change', this._onStore);
  }

  render() {
    const user = store.user;
    const showEnv = !store.meta.is_production;
    const initials = (user.display_name || user.username).slice(0, 2).toUpperCase();
    return html`
      <div class="glass topbar">
        <button
          class="hamburger btn-sm"
          aria-label="Toggle navigation"
          @click=${() => this.dispatchEvent(new CustomEvent('toggle-sidebar'))}
        >
          ☰
        </button>
        <span class="title">${TITLES[this.route] || 'Dashboard'}</span>
        ${showEnv ? html`<span class="badge env" title="Environment">${store.meta.env}</span>` : nothing}
        <div class="profile-wrap">
          <button class="profile-btn" aria-haspopup="menu" aria-expanded=${this.menuOpen}
            @click=${() => (this.menuOpen = !this.menuOpen)}>
            <span class="avatar">${initials}</span>
            <span class="profile-name">${user.display_name || user.username}</span>
          </button>
          ${this.menuOpen
            ? html`<div class="glass glass-strong dropdown" role="menu">
                <div class="dd-header">
                  <strong>${user.display_name || user.username}</strong>
                  <div><span class="badge role">${user.role}</span></div>
                </div>
                <button class="dd-item" role="menuitem"
                  @click=${() => { this.menuOpen = false; location.hash = '#/settings'; }}>
                  ⚙ Settings
                </button>
                <button class="dd-item" role="menuitem"
                  @click=${() => { this.menuOpen = false; this.dispatchEvent(new CustomEvent('show-feedback')); }}>
                  ✉ Report a bug / Request a feature
                </button>
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }
}

customElements.define('top-bar', TopBar);
