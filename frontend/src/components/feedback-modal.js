import { LitElement, html, nothing } from 'lit';
import { api } from '../api.js';
import { store, toast } from '../store.js';

export class FeedbackModal extends LitElement {
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
  }

  close() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  async submit(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    this.busy = true;
    this.error = '';
    try {
      await api('/api/feedback', {
        method: 'POST',
        body: {
          kind: form.get('kind'),
          priority: form.get('priority'),
          details: form.get('details'),
        },
      });
      toast('Thanks — your report was submitted.');
      this.close();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  render() {
    const user = store.user;
    return html`
      <div class="modal-overlay" @click=${(e) => e.target === e.currentTarget && this.close()}>
        <form class="glass glass-strong modal" role="dialog" aria-modal="true"
          aria-label="Report a bug or request a feature" @submit=${this.submit}>
          <div class="modal-head">
            <h2>Report a bug / Request a feature</h2>
            <button type="button" class="close-btn" aria-label="Close" @click=${this.close}>✕</button>
          </div>
          <p class="muted">Submitting as <strong>${user.display_name || user.username}</strong> (${user.role})</p>
          <div class="form-grid">
            <div>
              <label for="fb-kind">Type</label>
              <select id="fb-kind" name="kind" required>
                <option value="bug">🐞 Bug</option>
                <option value="feature">✨ New feature request</option>
              </select>
            </div>
            <div>
              <label for="fb-priority">Priority</label>
              <select id="fb-priority" name="priority" required>
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <label for="fb-details">Details</label>
          <textarea id="fb-details" name="details" rows="5" required minlength="5"
            placeholder="What happened, or what would you like to see?"></textarea>
          ${this.error ? html`<p class="error-text">${this.error}</p>` : nothing}
          <div class="actions-row">
            <button type="submit" class="btn-primary" ?disabled=${this.busy}>
              ${this.busy ? 'Submitting…' : 'Submit'}
            </button>
            <button type="button" @click=${this.close}>Cancel</button>
          </div>
        </form>
      </div>
    `;
  }
}

customElements.define('feedback-modal', FeedbackModal);
