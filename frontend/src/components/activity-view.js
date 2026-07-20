import { LitElement, html, nothing } from 'lit';
import { api } from '../api.js';
import { toast } from '../store.js';

const PAGE_SIZE = 50;

/** Application activity log (audit trail). Users see their own activity;
 * sysadmin/admin see everyone's with a user filter. */
export class ActivityView extends LitElement {
  static properties = {
    items: { state: true },
    total: { state: true },
    actions: { state: true },
    privileged: { state: true },
    q: { state: true },
    action: { state: true },
    username: { state: true },
    busy: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.items = [];
    this.total = 0;
    this.actions = [];
    this.privileged = false;
    this.q = '';
    this.action = '';
    this.username = '';
    this.busy = false;
    this._debounce = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.load();
  }

  async load(append = false) {
    this.busy = true;
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(append ? this.items.length : 0),
      });
      if (this.q) params.set('q', this.q);
      if (this.action) params.set('action', this.action);
      if (this.username) params.set('username', this.username);
      const data = await api(`/api/activity?${params}`);
      this.items = append ? [...this.items, ...data.items] : data.items;
      this.total = data.total;
      this.actions = data.actions;
      this.privileged = data.privileged;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      this.busy = false;
    }
  }

  onSearch(e) {
    this.q = e.target.value;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.load(), 250);
  }

  statusClass(status) {
    if (!status) return '';
    return status >= 400 ? 'error-text' : status >= 200 && status < 300 ? 'success-text' : '';
  }

  render() {
    return html`
      <div class="page-grid">
        <div class="glass page">
          <h1>Activity log</h1>
          <p class="muted">
            ${this.privileged
              ? 'Application-wide activity from the audit trail.'
              : 'Your activity in the application.'}
            ${this.total ? html` <span class="badge">${this.total} entries</span>` : nothing}
          </p>
          <div class="form-grid" style="margin-top:0.5rem">
            <div>
              <label for="act-q">Search</label>
              <input id="act-q" type="search" placeholder="path, action or detail…"
                .value=${this.q} @input=${this.onSearch} />
            </div>
            <div>
              <label for="act-action">Action</label>
              <select id="act-action" @change=${(e) => { this.action = e.target.value; this.load(); }}>
                <option value="">All actions</option>
                ${this.actions.map((a) => html`<option value=${a} ?selected=${this.action === a}>${a}</option>`)}
              </select>
            </div>
            ${this.privileged
              ? html`<div>
                  <label for="act-user">User</label>
                  <input id="act-user" placeholder="filter by username"
                    .value=${this.username}
                    @change=${(e) => { this.username = e.target.value.trim(); this.load(); }} />
                </div>`
              : nothing}
            <div style="display:flex; align-items:flex-end">
              <button class="btn-sm" ?disabled=${this.busy} @click=${() => this.load()}>↻ Refresh</button>
            </div>
          </div>
        </div>
        <div class="glass page">
          ${this.items.length
            ? html`<div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      ${this.privileged ? html`<th>User</th>` : nothing}
                      <th>Action</th>
                      <th>Request</th>
                      <th>Status</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.items.map(
                      (r) => html`<tr>
                        <td class="muted" style="white-space:nowrap">${r.ts}</td>
                        ${this.privileged
                          ? html`<td>${r.username}${r.role ? html` <span class="badge role">${r.role}</span>` : nothing}</td>`
                          : nothing}
                        <td><code>${r.action}</code></td>
                        <td class="muted">${r.method ? `${r.method} ${r.path}` : '—'}</td>
                        <td class=${this.statusClass(r.status)}>${r.status || '—'}</td>
                        <td class="muted" style="max-width:320px">${r.detail || '—'}</td>
                      </tr>`
                    )}
                  </tbody>
                </table>
              </div>
              ${this.items.length < this.total
                ? html`<div class="actions-row">
                    <button ?disabled=${this.busy} @click=${() => this.load(true)}>
                      ${this.busy ? 'Loading…' : `Load more (${this.total - this.items.length} remaining)`}
                    </button>
                  </div>`
                : nothing}`
            : html`<p class="muted">${this.busy ? 'Loading…' : 'No activity recorded yet.'}</p>`}
        </div>
      </div>
    `;
  }
}

customElements.define('activity-view', ActivityView);
