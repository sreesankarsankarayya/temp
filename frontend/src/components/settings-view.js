import { LitElement, html, nothing } from 'lit';
import { api, getToken } from '../api.js';
import { store, toast } from '../store.js';
import { applyTheme, getThemePref } from '../theme.js';

/**
 * Settings page: typeahead search over sections; sections stay collapsed
 * when idle and expand when focused, clicked or matched by the search.
 */
export class SettingsView extends LitElement {
  static properties = {
    query: { state: true },
    open: { state: true }, // Set of open section ids
    providers: { state: true },
    keys: { state: true },
    users: { state: true },
    feedback: { state: true },
    backups: { state: true },
    schedule: { state: true },
    upgrades: { state: true },
    skill: { state: true },
    skillDiff: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.query = '';
    this.open = new Set();
    this.providers = {};
    this.keys = [];
    this.users = [];
    this.feedback = [];
    this.backups = [];
    this.schedule = { enabled: false, full_every_hours: 24, incremental_every_hours: 4 };
    this.upgrades = [];
    this.skill = null;
    this.skillDiff = null; // {diff, added, removed, pendingContent, source} | null
    this.skillDraft = '';
  }

  sections() {
    return [
      {
        id: 'appearance',
        icon: '🎨',
        title: 'Appearance',
        keywords: 'theme dark light system mode glass color appearance',
        visible: true,
        body: () => this.renderAppearance(),
      },
      {
        id: 'llm-keys',
        icon: '🔑',
        title: 'LLM API Keys',
        keywords: 'llm key api openai nvidia grok xai openrouter vllm ollama longcat local model secret token provider',
        visible: true,
        body: () => this.renderLlmKeys(),
      },
      {
        id: 'skill',
        icon: '📜',
        title: 'Skill.md Editor',
        keywords: 'skill skill.md editor prompt markdown default restore upload download diff override',
        visible: true,
        body: () => this.renderSkill(),
      },
      {
        id: 'users',
        icon: '👥',
        title: 'Users & Roles',
        keywords: 'user role admin operator sysadmin account create password access',
        visible: store.hasRole('admin'),
        body: () => this.renderUsers(),
      },
      {
        id: 'feedback',
        icon: '📋',
        title: 'Bug Reports & Feature Requests',
        keywords: 'feedback bug feature request triage report priority inbox',
        visible: store.hasRole('admin'),
        body: () => this.renderFeedback(),
      },
      {
        id: 'backup',
        icon: '💾',
        title: 'Backup & DR',
        keywords: 'backup restore disaster recovery dr full incremental schedule snapshot',
        visible: store.hasRole('sysadmin'),
        body: () => this.renderBackup(),
      },
      {
        id: 'upgrade',
        icon: '⬆️',
        title: 'Upgrades',
        keywords: 'upgrade update bundle signed signature version rollback restore point self-upgrade',
        visible: store.hasRole('sysadmin'),
        body: () => this.renderUpgrade(),
      },
    ].filter((s) => s.visible);
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadSection('llm-keys');
  }

  async loadSection(id) {
    try {
      if (id === 'llm-keys') {
        [this.providers, this.keys] = await Promise.all([api('/api/llm-keys/providers'), api('/api/llm-keys')]);
      } else if (id === 'users') {
        this.users = await api('/api/auth/users');
      } else if (id === 'feedback') {
        this.feedback = await api('/api/feedback');
      } else if (id === 'backup') {
        [this.backups, this.schedule] = await Promise.all([api('/api/backup'), api('/api/backup/schedule')]);
      } else if (id === 'upgrade') {
        this.upgrades = await api('/api/upgrade');
      } else if (id === 'skill') {
        this.skill = await api('/api/skill');
        this.skillDraft = this.skill.content;
        this.skillDiff = null;
      }
      this.requestUpdate();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  toggle(id, force) {
    const next = new Set(this.open);
    const shouldOpen = force !== undefined ? force : !next.has(id);
    if (shouldOpen) {
      next.add(id);
      this.loadSection(id);
    } else {
      next.delete(id);
    }
    this.open = next;
  }

  onSearch(e) {
    this.query = e.target.value;
    const q = this.query.trim().toLowerCase();
    if (!q) return;
    // typeahead: expand matches, collapse the rest
    const next = new Set();
    for (const s of this.sections()) {
      if (this.matches(s, q)) {
        next.add(s.id);
        this.loadSection(s.id);
      }
    }
    this.open = next;
  }

  matches(section, q) {
    return (section.title + ' ' + section.keywords).toLowerCase().includes(q);
  }

  highlight(title) {
    const q = this.query.trim();
    if (!q) return title;
    const idx = title.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return title;
    return html`${title.slice(0, idx)}<mark>${title.slice(idx, idx + q.length)}</mark>${title.slice(idx + q.length)}`;
  }

  render() {
    const q = this.query.trim().toLowerCase();
    const visible = this.sections().filter((s) => !q || this.matches(s, q));
    return html`
      <div class="page-grid">
        <div class="glass settings-search">
          <input
            type="search"
            placeholder="Search settings… (e.g. keys, backup, theme, upgrade)"
            aria-label="Search settings"
            .value=${this.query}
            @input=${this.onSearch}
          />
          <div class="typeahead-hint">
            ${this.sections().map(
              (s) => html`<button class="chip" @click=${() => { this.query = s.title; this.onSearch({ target: { value: s.title } }); }}>
                ${s.title}
              </button>`
            )}
          </div>
        </div>
        ${visible.length === 0 ? html`<div class="glass page muted">No settings match “${this.query}”.</div>` : nothing}
        ${visible.map((s) => this.renderSection(s))}
      </div>
    `;
  }

  renderSection(s) {
    const isOpen = this.open.has(s.id);
    return html`
      <section
        class="glass setting-section ${isOpen ? 'open' : ''}"
        @focusin=${() => !isOpen && this.toggle(s.id, true)}
      >
        <div
          class="section-head"
          role="button"
          tabindex="0"
          aria-expanded=${isOpen}
          @click=${() => this.toggle(s.id)}
          @keydown=${(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(s.id))}
        >
          <span class="section-icon" aria-hidden="true">${s.icon}</span>
          <span>${this.highlight(s.title)}</span>
          <span class="chev" aria-hidden="true">›</span>
        </div>
        <div class="section-body">${isOpen ? s.body() : nothing}</div>
      </section>
    `;
  }

  /* ---------------- Appearance ---------------- */

  renderAppearance() {
    const pref = getThemePref();
    return html`
      <p class="muted">Choose how the interface follows your system.</p>
      <div class="actions-row" role="radiogroup" aria-label="Theme">
        ${['system', 'light', 'dark'].map(
          (mode) => html`<button
            class=${pref === mode ? 'btn-primary' : ''}
            @click=${() => { applyTheme(mode); this.requestUpdate(); }}
          >
            ${mode === 'system' ? '🖥 System' : mode === 'light' ? '☀️ Light' : '🌙 Dark'}
          </button>`
        )}
      </div>
    `;
  }

  /* ---------------- LLM keys ---------------- */

  async addKey(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api('/api/llm-keys', {
        method: 'POST',
        body: {
          provider: form.get('provider'),
          label: form.get('label'),
          base_url: form.get('base_url'),
          model: form.get('model'),
          api_key: form.get('api_key'),
        },
      });
      toast('Key stored (encrypted at rest).');
      e.target.reset();
      this.loadSection('llm-keys');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async deleteKey(id) {
    try {
      await api(`/api/llm-keys/${id}`, { method: 'DELETE' });
      toast('Key removed.');
      this.loadSection('llm-keys');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  onProviderChange(e) {
    const p = this.providers[e.target.value];
    const form = e.target.closest('form');
    if (p && form) {
      form.querySelector('[name=base_url]').value = p.base_url;
      const dl = form.querySelector('#model-options');
      if (dl) dl.innerHTML = p.models.map((m) => `<option value="${m}"></option>`).join('');
    }
  }

  renderLlmKeys() {
    const canManage = store.hasRole('operator');
    return html`
      <p class="muted">
        Keys are encrypted (Fernet) before they touch the database and only ever shown masked.
        Supported: OpenAI, NVIDIA, Grok (xAI), OpenRouter, vLLM, Ollama and local deployments such as LongCat.
      </p>
      ${this.keys.length
        ? html`<div class="table-scroll"><table>
            <thead><tr><th>Provider</th><th>Label</th><th>Base URL</th><th>Model</th><th>Key</th><th></th></tr></thead>
            <tbody>
              ${this.keys.map(
                (k) => html`<tr>
                  <td><span class="badge">${this.providers[k.provider]?.label || k.provider}</span></td>
                  <td>${k.label}</td>
                  <td class="muted">${k.base_url}</td>
                  <td>${k.model || '—'}</td>
                  <td><code>${k.api_key_masked}</code></td>
                  <td>
                    ${canManage
                      ? html`<button class="btn-sm btn-danger" @click=${() => this.deleteKey(k.id)}>Delete</button>`
                      : nothing}
                  </td>
                </tr>`
              )}
            </tbody>
          </table></div>`
        : html`<p class="muted">No keys configured yet.</p>`}
      ${canManage
        ? html`<form @submit=${this.addKey}>
            <div class="form-grid">
              <div>
                <label for="key-provider">Provider</label>
                <select id="key-provider" name="provider" required @change=${this.onProviderChange}>
                  ${Object.entries(this.providers).map(
                    ([id, p]) => html`<option value=${id}>${p.label}</option>`
                  )}
                </select>
              </div>
              <div>
                <label for="key-label">Label</label>
                <input id="key-label" name="label" required placeholder="e.g. team OpenAI key" />
              </div>
              <div>
                <label for="key-base">Base URL</label>
                <input id="key-base" name="base_url"
                  placeholder=${this.providers.openai?.base_url || 'https://…'} />
              </div>
              <div>
                <label for="key-model">Model</label>
                <input id="key-model" name="model" list="model-options" placeholder="any model id" />
                <datalist id="model-options">
                  ${(this.providers.openai?.models || []).map((m) => html`<option value=${m}></option>`)}
                </datalist>
              </div>
            </div>
            <label for="key-secret">API key</label>
            <input id="key-secret" name="api_key" type="password" required autocomplete="off"
              placeholder="sk-…" />
            <div class="actions-row"><button class="btn-primary">Add key</button></div>
          </form>`
        : html`<p class="muted">Ask an operator or admin to add or remove keys.</p>`}
    `;
  }

  /* ---------------- Skill.md editor ---------------- */

  async downloadDefaultSkill() {
    try {
      const res = await fetch('/api/skill/default', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      this.triggerDownload(await res.text(), 'skill-default.md');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  triggerDownload(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async requestSkillDiff(content, source) {
    try {
      const d = await api('/api/skill/diff', { method: 'POST', body: { content } });
      if (d.identical) {
        toast('No changes — the proposed skill.md is identical to the current one.');
        this.skillDiff = null;
        return;
      }
      this.skillDiff = { ...d, pendingContent: content, source };
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async uploadSkillFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast('File too large (max 512 KiB).', 'error');
      return;
    }
    const content = await file.text();
    await this.requestSkillDiff(content, `upload: ${file.name}`);
  }

  async confirmSkillApply() {
    try {
      this.skill = await api('/api/skill', {
        method: 'PUT',
        body: { content: this.skillDiff.pendingContent },
      });
      this.skillDraft = this.skill.content;
      this.skillDiff = null;
      toast('skill.md updated.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async restoreSkillDefault() {
    if (!confirm('Restore skill.md to the shipped default? Your current version will be overwritten.')) return;
    try {
      this.skill = await api('/api/skill/restore', { method: 'POST' });
      this.skillDraft = this.skill.content;
      this.skillDiff = null;
      toast('skill.md restored to default.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  diffLineClass(line) {
    if (line.startsWith('+++') || line.startsWith('---')) return 'diff-file';
    if (line.startsWith('@@')) return 'diff-hunk';
    if (line.startsWith('+')) return 'diff-add';
    if (line.startsWith('-')) return 'diff-del';
    return '';
  }

  renderSkill() {
    if (!this.skill) return html`<p class="muted">Loading…</p>`;
    const canManage = store.hasRole('operator');
    return html`
      <p class="muted">
        The active <code>skill.md</code> drives the platform assistant. Review the diff and
        confirm before any change overrides the current version; the shipped default can
        always be restored.
        ${this.skill.is_default
          ? html`<span class="badge">default</span>`
          : html`<span class="badge">modified</span>`}
        ${this.skill.updated_at ? html`<span class="muted"> · updated ${this.skill.updated_at}</span>` : nothing}
      </p>
      <label for="skill-editor">skill.md ${canManage ? '' : '(read-only for your role)'}</label>
      <textarea
        id="skill-editor"
        rows="14"
        spellcheck="false"
        style="font-family: ui-monospace, monospace; font-size: 0.82rem"
        .value=${this.skillDraft}
        ?readonly=${!canManage}
        @input=${(e) => (this.skillDraft = e.target.value)}
      ></textarea>
      <div class="actions-row">
        ${canManage
          ? html`
              <button class="btn-primary" @click=${() => this.requestSkillDiff(this.skillDraft, 'editor')}>
                Review & save changes
              </button>
              <label class="btn" style="margin:0; width:auto; display:inline-flex; align-items:center; cursor:pointer">
                ⤒ Upload modified skill.md
                <input type="file" accept=".md,.markdown,.txt" hidden @change=${this.uploadSkillFile} />
              </label>
            `
          : nothing}
        <button @click=${this.downloadDefaultSkill}>⤓ Download default</button>
        <button @click=${() => this.triggerDownload(this.skill.content, 'skill.md')}>⤓ Download current</button>
        ${canManage
          ? html`<button class="btn-danger" ?disabled=${this.skill.is_default} @click=${this.restoreSkillDefault}>
              ↺ Restore to default
            </button>`
          : nothing}
      </div>
      ${this.skillDiff
        ? html`
            <div class="diff-panel">
              <div class="diff-head">
                <strong>Review changes</strong>
                <span class="muted">(${this.skillDiff.source})</span>
                <span class="success-text">+${this.skillDiff.added}</span>
                <span class="error-text">−${this.skillDiff.removed}</span>
              </div>
              <pre class="diff-view">${this.skillDiff.diff.map(
                (l) => html`<span class=${this.diffLineClass(l)}>${l}\n</span>`
              )}</pre>
              <div class="actions-row">
                <button class="btn-primary" @click=${this.confirmSkillApply}>
                  Confirm — override current skill.md
                </button>
                <button @click=${() => (this.skillDiff = null)}>Cancel</button>
              </div>
            </div>
          `
        : nothing}
    `;
  }

  /* ---------------- Users (admin) ---------------- */

  async addUser(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api('/api/auth/users', {
        method: 'POST',
        body: {
          username: form.get('username'),
          password: form.get('password'),
          role: form.get('role'),
          display_name: form.get('display_name'),
        },
      });
      toast('User created.');
      e.target.reset();
      this.loadSection('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async toggleUser(u) {
    try {
      await api(`/api/auth/users/${u.username}/active?active=${!u.active}`, { method: 'PATCH' });
      this.loadSection('users');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  renderUsers() {
    return html`
      <div class="table-scroll"><table>
        <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${this.users.map(
            (u) => html`<tr>
              <td>${u.username}</td>
              <td>${u.display_name}</td>
              <td><span class="badge role">${u.role}</span></td>
              <td>${u.active ? html`<span class="success-text">active</span>` : html`<span class="error-text">disabled</span>`}</td>
              <td>
                ${u.username !== store.user.username
                  ? html`<button class="btn-sm" @click=${() => this.toggleUser(u)}>
                      ${u.active ? 'Disable' : 'Enable'}
                    </button>`
                  : nothing}
              </td>
            </tr>`
          )}
        </tbody>
      </table></div>
      <form @submit=${this.addUser}>
        <div class="form-grid">
          <div><label for="u-name">Username</label><input id="u-name" name="username" required /></div>
          <div><label for="u-display">Display name</label><input id="u-display" name="display_name" /></div>
          <div><label for="u-pass">Password</label><input id="u-pass" name="password" type="password" required minlength="4" /></div>
          <div>
            <label for="u-role">Role</label>
            <select id="u-role" name="role">
              ${['user', 'operator', 'sysadmin', 'admin'].map((r) => html`<option value=${r}>${r}</option>`)}
            </select>
          </div>
        </div>
        <div class="actions-row"><button class="btn-primary">Create user</button></div>
      </form>
    `;
  }

  /* ---------------- Feedback triage (admin) ---------------- */

  async setFeedbackStatus(id, status) {
    try {
      await api(`/api/feedback/${id}/status`, { method: 'PATCH', body: { status } });
      this.loadSection('feedback');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  renderFeedback() {
    if (!this.feedback.length) return html`<p class="muted">No bug reports or feature requests yet.</p>`;
    return html`<div class="table-scroll"><table>
      <thead><tr><th>#</th><th>User</th><th>Type</th><th>Priority</th><th>Details</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>
        ${this.feedback.map(
          (f) => html`<tr>
            <td>${f.id}</td>
            <td>${f.username}</td>
            <td>${f.kind === 'bug' ? '🐞 bug' : '✨ feature'}</td>
            <td>${f.priority}</td>
            <td style="max-width:340px">${f.details}</td>
            <td>
              <select @change=${(e) => this.setFeedbackStatus(f.id, e.target.value)}>
                ${['open', 'triaged', 'in-progress', 'done', 'rejected'].map(
                  (s) => html`<option value=${s} ?selected=${f.status === s}>${s}</option>`
                )}
              </select>
            </td>
            <td class="muted">${f.created_at}</td>
          </tr>`
        )}
      </tbody>
    </table></div>`;
  }

  /* ---------------- Backup & DR (sysadmin) ---------------- */

  async runBackup(kind) {
    try {
      const res = await api(`/api/backup/${kind}`, { method: 'POST' });
      toast(`${kind} backup created (${(res.size_bytes / 1024).toFixed(1)} KiB).`);
      this.loadSection('backup');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async restoreBackup(b) {
    if (!confirm(`Restore backup #${b.id} (${b.kind})? Current databases will be snapshotted first.`)) return;
    try {
      const res = await api(`/api/backup/${b.id}/restore`, { method: 'POST' });
      toast(`Restored: ${res.restored.join(', ') || 'nothing'} — reload recommended.`);
      this.loadSection('backup');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async saveSchedule(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      this.schedule = await api('/api/backup/schedule', {
        method: 'PUT',
        body: {
          enabled: form.get('enabled') === 'on',
          full_every_hours: Number(form.get('full_every_hours')),
          incremental_every_hours: Number(form.get('incremental_every_hours')),
        },
      });
      toast('Backup schedule saved.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  renderBackup() {
    return html`
      <p class="muted">
        Consistent snapshots of the application, system and audit databases.
        Restores automatically take a safety snapshot first.
      </p>
      <form @submit=${this.saveSchedule}>
        <div class="form-grid">
          <div>
            <label for="b-enabled">Scheduled backups</label>
            <select id="b-enabled" name="enabled">
              <option value="off" ?selected=${!this.schedule.enabled}>Disabled</option>
              <option value="on" ?selected=${this.schedule.enabled}>Enabled</option>
            </select>
          </div>
          <div>
            <label for="b-full">Full backup every (hours)</label>
            <input id="b-full" name="full_every_hours" type="number" min="1" .value=${String(this.schedule.full_every_hours)} />
          </div>
          <div>
            <label for="b-incr">Incremental every (hours)</label>
            <input id="b-incr" name="incremental_every_hours" type="number" min="1" .value=${String(this.schedule.incremental_every_hours)} />
          </div>
        </div>
        <div class="actions-row">
          <button class="btn-primary">Save schedule</button>
          <button type="button" @click=${() => this.runBackup('full')}>Run full backup now</button>
          <button type="button" @click=${() => this.runBackup('incremental')}>Run incremental now</button>
        </div>
      </form>
      ${this.backups.length
        ? html`<div class="table-scroll" style="margin-top:1rem"><table>
            <thead><tr><th>#</th><th>Kind</th><th>Size</th><th>Note</th><th>By</th><th>Created</th><th></th></tr></thead>
            <tbody>
              ${this.backups.map(
                (b) => html`<tr>
                  <td>${b.id}</td>
                  <td><span class="badge">${b.kind}</span></td>
                  <td>${(b.size_bytes / 1024).toFixed(1)} KiB</td>
                  <td class="muted">${b.note}</td>
                  <td>${b.created_by}</td>
                  <td class="muted">${b.created_at}</td>
                  <td><button class="btn-sm" @click=${() => this.restoreBackup(b)}>Restore</button></td>
                </tr>`
              )}
            </tbody>
          </table></div>`
        : html`<p class="muted" style="margin-top:1rem">No backups yet.</p>`}
    `;
  }

  /* ---------------- Upgrades (sysadmin) ---------------- */

  async uploadBundle(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    try {
      await api('/api/upgrade/upload', { method: 'POST', formData: fd });
      toast('Bundle verified and uploaded.');
      form.reset();
      this.loadSection('upgrade');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async applyUpgrade(id) {
    if (!confirm(`Stage upgrade #${id}? A restore point is created automatically.`)) return;
    try {
      const res = await api(`/api/upgrade/${id}/apply`, { method: 'POST' });
      toast(res.message);
      this.loadSection('upgrade');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async rollbackUpgrade(id) {
    try {
      const res = await api(`/api/upgrade/${id}/rollback`, { method: 'POST' });
      toast(res.message);
      this.loadSection('upgrade');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  renderUpgrade() {
    return html`
      <p class="muted">
        Upload a signed bundle (.tar.gz + HMAC-SHA256 hex signature). The signature is verified
        before the bundle is accepted; applying stages the upgrade behind an automatic restore point
        and can be rolled back safely.
      </p>
      <form @submit=${this.uploadBundle}>
        <div class="form-grid">
          <div>
            <label for="up-file">Bundle (.tar.gz)</label>
            <input id="up-file" type="file" name="bundle" accept=".tar.gz,.tgz" required />
          </div>
          <div>
            <label for="up-version">Version</label>
            <input id="up-version" name="version" placeholder="e.g. 0.0.2" />
          </div>
        </div>
        <label for="up-sig">Signature (HMAC-SHA256 hex)</label>
        <input id="up-sig" name="signature" required placeholder="64 hex chars" pattern="[0-9a-fA-F]{64}" />
        <div class="actions-row"><button class="btn-primary">Upload & verify</button></div>
      </form>
      ${this.upgrades.length
        ? html`<div class="table-scroll" style="margin-top:1rem"><table>
            <thead><tr><th>#</th><th>Bundle</th><th>Version</th><th>Status</th><th>By</th><th>Created</th><th></th></tr></thead>
            <tbody>
              ${this.upgrades.map(
                (u) => html`<tr>
                  <td>${u.id}</td>
                  <td class="muted">${u.filename}</td>
                  <td>${u.version || '—'}</td>
                  <td><span class="badge">${u.status}</span></td>
                  <td>${u.uploaded_by}</td>
                  <td class="muted">${u.created_at}</td>
                  <td>
                    ${u.status === 'verified'
                      ? html`<button class="btn-sm" @click=${() => this.applyUpgrade(u.id)}>Apply</button>`
                      : u.status === 'staged'
                        ? html`<button class="btn-sm btn-danger" @click=${() => this.rollbackUpgrade(u.id)}>Rollback</button>`
                        : nothing}
                  </td>
                </tr>`
              )}
            </tbody>
          </table></div>`
        : html`<p class="muted" style="margin-top:1rem">No upgrade bundles uploaded yet.</p>`}
    `;
  }
}

customElements.define('settings-view', SettingsView);
