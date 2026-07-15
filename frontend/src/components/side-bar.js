import { LitElement, html, nothing } from 'lit';
import { store, toast } from '../store.js';

export class SideBar extends LitElement {
  static properties = { route: { type: String } };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._onStore = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('change', this._onStore);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('change', this._onStore);
  }

  async logout() {
    await store.logout();
    toast('Signed out');
  }

  render() {
    const nav = [
      { id: 'dashboard', label: 'Dashboard', icon: '◫' },
      ...(store.hasRole('sysadmin') ? [{ id: 'tokenomics', label: 'Tokenomics', icon: '↗' }] : []),
      { id: 'settings', label: 'Settings', icon: '⚙' },
    ];
    return html`
      <div class="brand">
        <img src="/icon.svg" alt="" />
        <span>${store.meta.app_name}</span>
      </div>
      <nav aria-label="Main">
        ${nav.map(
          (item) => html`<a
            href="#/${item.id}"
            class=${this.route === item.id ? 'active' : ''}
            aria-current=${this.route === item.id ? 'page' : nothing}
          >
            <span aria-hidden="true">${item.icon}</span>${item.label}
          </a>`
        )}
      </nav>
      <div class="sidebar-footer">
        <button @click=${this.logout}>⎋ Logout</button>
        <button
          class="version-link"
          title="View changelog"
          @click=${() => this.dispatchEvent(new CustomEvent('show-changelog'))}
        >
          v${store.meta.version}
        </button>
      </div>
    `;
  }
}

customElements.define('side-bar', SideBar);
