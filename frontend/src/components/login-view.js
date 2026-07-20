import { LitElement, html, nothing } from 'lit';
import { store, toast } from '../store.js';

export class LoginView extends LitElement {
  static properties = {
    busy: { state: true },
    error: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.busy = false;
    this.error = '';
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

  async submit(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    this.busy = true;
    this.error = '';
    try {
      await store.login(form.get('username'), form.get('password'));
      toast(`Welcome back, ${store.user.display_name || store.user.username}`);
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  render() {
    return html`
      <div class="login-wrap">
        <form class="glass login-card" @submit=${this.submit}>
          <div class="brand">
            <img src="/icon.svg" alt="" />
            <div>
              <h1>${store.meta.app_name}</h1>
              <div class="muted">Sign in to continue</div>
            </div>
          </div>
          <label for="login-username">Username</label>
          <input id="login-username" name="username" autocomplete="username" required autofocus />
          <label for="login-password">Password</label>
          <input id="login-password" name="password" type="password" autocomplete="current-password" required />
          ${this.error ? html`<p class="error-text" role="alert">${this.error}</p>` : nothing}
          <div class="actions-row">
            <button class="btn-primary" style="width:100%" ?disabled=${this.busy}>
              ${this.busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
          <p class="muted" style="margin-top:1rem">
            Roles: user · operator · sysadmin · admin
          </p>
        </form>
      </div>
    `;
  }
}

customElements.define('login-view', LoginView);
