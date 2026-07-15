import { LitElement, html, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { mdToHtml } from '../markdown.js';

/** Role-aware help manual: the backend returns only the sections the
 * current user's role is entitled to see. */
export class HelpModal extends LitElement {
  static properties = {
    sections: { state: true },
    active: { state: true },
    error: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.sections = null;
    this.active = '';
    this.error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    api('/api/help')
      .then((data) => {
        this.sections = data.sections;
        this.active = data.sections[0]?.id || '';
      })
      .catch((err) => (this.error = err.message));
  }

  close() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  render() {
    return html`
      <div class="modal-overlay" @click=${(e) => e.target === e.currentTarget && this.close()}>
        <div class="glass glass-strong modal help-modal" role="dialog" aria-modal="true" aria-label="Help manual">
          <div class="modal-head">
            <h2>Help manual <span class="badge role">${store.user.role}</span></h2>
            <button class="close-btn" aria-label="Close" @click=${this.close}>✕</button>
          </div>
          ${this.error ? html`<p class="error-text">${this.error}</p>` : nothing}
          ${!this.sections && !this.error ? html`<p class="muted">Loading…</p>` : nothing}
          ${this.sections
            ? html`
                <div class="typeahead-hint" style="margin-bottom:0.75rem">
                  ${this.sections.map(
                    (s) => html`<button
                      class="chip ${this.active === s.id ? 'chip-active' : ''}"
                      @click=${() => {
                        this.active = s.id;
                        this.querySelector(`#help-${s.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                      }}
                    >
                      ${s.icon} ${s.title}
                    </button>`
                  )}
                </div>
                ${this.sections.map(
                  (s) => html`
                    <section id="help-${s.id}" class="help-section">
                      <h3><span aria-hidden="true">${s.icon}</span> ${s.title}</h3>
                      <div class="help-body changelog-body">${unsafeHTML(mdToHtml(s.body))}</div>
                    </section>
                  `
                )}
                <p class="muted" style="margin-top:1rem">
                  Sections shown match your role (<strong>${store.user.role}</strong>). Need something
                  not covered here? Use “Report a bug / Request a feature” in the sidebar.
                </p>
              `
            : nothing}
        </div>
      </div>
    `;
  }
}

customElements.define('help-modal', HelpModal);
