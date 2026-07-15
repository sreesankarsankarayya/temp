import { LitElement, html, nothing } from 'lit';
import { api } from '../api.js';
import { store } from '../store.js';

export class DashboardView extends LitElement {
  static properties = {
    myFeedback: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.myFeedback = [];
  }

  connectedCallback() {
    super.connectedCallback();
    api('/api/feedback/mine')
      .then((rows) => (this.myFeedback = rows))
      .catch(() => {});
  }

  render() {
    const user = store.user;
    return html`
      <div class="page-grid">
        <div class="glass page">
          <h1>Welcome, ${user.display_name || user.username} 👋</h1>
          <p class="muted">
            You are signed in as <span class="badge role">${user.role}</span> on
            <strong>${store.meta.app_name}</strong> v${store.meta.version}
            ${store.meta.is_production ? nothing : html` · environment <strong>${store.meta.env}</strong>`}
          </p>
        </div>
        <div class="cards">
          <div class="glass stat-tile">
            <div class="stat-label">Quick start</div>
            <div class="stat-value">⚙</div>
            <div class="stat-sub"><a href="#/settings">Add your LLM API keys in Settings</a></div>
          </div>
          ${store.hasRole('sysadmin')
            ? html`<div class="glass stat-tile">
                <div class="stat-label">Usage & cost</div>
                <div class="stat-value">↗</div>
                <div class="stat-sub"><a href="#/tokenomics">Review Tokenomics & forecasts</a></div>
              </div>`
            : nothing}
          <div class="glass stat-tile">
            <div class="stat-label">My reports</div>
            <div class="stat-value">${this.myFeedback.length}</div>
            <div class="stat-sub">bugs & feature requests submitted</div>
          </div>
        </div>
        <div class="glass page placeholder-card" aria-label="Placeholder">
          <div class="placeholder-inner">
            <span class="section-icon" aria-hidden="true">🧩</span>
            <div>
              <h2>Dashboard widgets — coming soon</h2>
              <p class="muted">
                This area is a placeholder for upcoming dashboard widgets (usage snapshots,
                recent activity, provider health). Have an idea for what should live here?
                Use “Report a bug / Request a feature” in the profile menu.
              </p>
            </div>
          </div>
        </div>
        ${this.myFeedback.length
          ? html`<div class="glass page">
              <h2>My bug reports & feature requests</h2>
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr><th>#</th><th>Type</th><th>Priority</th><th>Status</th><th>Details</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    ${this.myFeedback.map(
                      (f) => html`<tr>
                        <td>${f.id}</td>
                        <td>${f.kind === 'bug' ? '🐞 bug' : '✨ feature'}</td>
                        <td>${f.priority}</td>
                        <td><span class="badge">${f.status}</span></td>
                        <td>${f.details.slice(0, 80)}${f.details.length > 80 ? '…' : ''}</td>
                        <td class="muted">${f.created_at}</td>
                      </tr>`
                    )}
                  </tbody>
                </table>
              </div>
            </div>`
          : nothing}
      </div>
    `;
  }
}

customElements.define('dashboard-view', DashboardView);
