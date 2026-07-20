import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { api } from '../api.js';
import { mdToHtml } from '../markdown.js';

export class ChangelogModal extends LitElement {
  static properties = {
    content: { state: true },
    version: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.content = 'Loading…';
    this.version = '';
  }

  connectedCallback() {
    super.connectedCallback();
    api('/api/meta/changelog')
      .then((data) => {
        this.version = data.version;
        this.content = mdToHtml(data.changelog);
      })
      .catch((err) => (this.content = `<p class="error-text">${err.message}</p>`));
  }

  close() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  render() {
    return html`
      <div class="modal-overlay" @click=${(e) => e.target === e.currentTarget && this.close()}>
        <div class="glass glass-strong modal" role="dialog" aria-modal="true" aria-label="Changelog">
          <div class="modal-head">
            <h2>Changelog ${this.version ? html`<span class="badge">v${this.version}</span>` : ''}</h2>
            <button class="close-btn" aria-label="Close" @click=${this.close}>✕</button>
          </div>
          <div class="changelog-body">${unsafeHTML(this.content)}</div>
        </div>
      </div>
    `;
  }
}

customElements.define('changelog-modal', ChangelogModal);
