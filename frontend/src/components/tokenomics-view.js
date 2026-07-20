import { LitElement, html, nothing, svg } from 'lit';
import { api } from '../api.js';
import { toast } from '../store.js';

const W = 860;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(Math.round(n));
}

/** Tokenomics: module-wise metrics, usage forecast line chart, savings tips. */
export class TokenomicsView extends LitElement {
  static properties = {
    summary: { state: true },
    series: { state: true },
    suggestions: { state: true },
    hover: { state: true }, // {i, x, y, clientX, clientY} | null
    error: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.summary = null;
    this.series = null;
    this.suggestions = null;
    this.hover = null;
    this.error = '';
    this._onTheme = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('theme:changed', this._onTheme);
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('theme:changed', this._onTheme);
  }

  async load() {
    try {
      [this.summary, this.series, this.suggestions] = await Promise.all([
        api('/api/tokenomics/summary'),
        api('/api/tokenomics/series?horizon=14'),
        api('/api/tokenomics/suggestions'),
      ]);
    } catch (err) {
      this.error = err.message;
      toast(err.message, 'error');
    }
  }

  chartPoints() {
    const history = this.series.history;
    const forecast = this.series.forecast;
    const all = [
      ...history.map((h, i) => ({ i, day: h.day, tokens: h.tokens, kind: 'history' })),
      ...forecast.map((v, j) => ({
        i: history.length + j,
        day: `+${j + 1}d`,
        tokens: v,
        kind: 'forecast',
      })),
    ];
    const n = all.length;
    const max = Math.max(...all.map((p) => p.tokens)) * 1.08 || 1;
    const x = (i) => PAD.left + (i / Math.max(1, n - 1)) * (W - PAD.left - PAD.right);
    const y = (v) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
    return { all, n, max, x, y, historyLen: history.length };
  }

  onChartMove(e) {
    const svgEl = e.currentTarget;
    const rect = svgEl.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const { all, x } = this.chartPoints();
    let best = 0;
    let bestDist = Infinity;
    for (const p of all) {
      const d = Math.abs(x(p.i) - px);
      if (d < bestDist) {
        bestDist = d;
        best = p.i;
      }
    }
    this.hover = { i: best, clientX: e.clientX, clientY: e.clientY };
  }

  renderChart() {
    const { all, max, x, y, historyLen } = this.chartPoints();
    const historyPts = all.slice(0, historyLen);
    const forecastPts = all.slice(historyLen - 1); // connect the two segments
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.tokens).toFixed(1)}`).join(' ');

    const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
      const v = max * f;
      return svg`
        <line x1=${PAD.left} x2=${W - PAD.right} y1=${y(v)} y2=${y(v)}
          stroke=${cssVar('--chart-grid')} stroke-width="1" />
        <text x=${PAD.left - 8} y=${y(v) + 4} text-anchor="end" font-size="11"
          fill=${cssVar('--chart-muted')} style="font-variant-numeric: tabular-nums">${fmt(v)}</text>`;
    });

    const hovered = this.hover ? all[this.hover.i] : null;
    const seriesColor = cssVar('--series-1');

    return html`
      <div class="viz-legend">
        <span class="key"><span class="swatch" style="background:${seriesColor}"></span>Daily tokens (actual)</span>
        <span class="key">
          <span class="swatch" style="background:repeating-linear-gradient(90deg, ${seriesColor} 0 4px, transparent 4px 8px)"></span>
          Forecast (next 14 days)
        </span>
      </div>
      <svg
        viewBox="0 0 ${W} ${H}"
        role="img"
        aria-label="Daily token usage with a 14 day forecast"
        @pointermove=${this.onChartMove}
        @pointerleave=${() => (this.hover = null)}
      >
        <rect x="0" y="0" width=${W} height=${H} rx="12" fill=${cssVar('--chart-surface')} />
        ${gridLines}
        <line x1=${PAD.left} x2=${W - PAD.right} y1=${y(0)} y2=${y(0)}
          stroke=${cssVar('--chart-axis')} stroke-width="1" />
        <path d=${line(historyPts)} fill="none" stroke=${seriesColor} stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round" />
        <path d=${line(forecastPts)} fill="none" stroke=${seriesColor} stroke-width="2"
          stroke-dasharray="5 5" stroke-linejoin="round" stroke-linecap="round" />
        <line x1=${x(historyLen - 1)} x2=${x(historyLen - 1)} y1=${PAD.top} y2=${H - PAD.bottom}
          stroke=${cssVar('--chart-axis')} stroke-width="1" stroke-dasharray="2 4" />
        <text x=${x(historyLen - 1) + 6} y=${PAD.top + 12} font-size="11" fill=${cssVar('--chart-muted')}>today</text>
        <text x=${PAD.left} y=${H - 8} font-size="11" fill=${cssVar('--chart-muted')}>${all[0]?.day || ''}</text>
        <text x=${W - PAD.right} y=${H - 8} font-size="11" text-anchor="end" fill=${cssVar('--chart-muted')}>
          ${all[all.length - 1]?.day || ''}
        </text>
        ${hovered
          ? svg`
            <line x1=${x(hovered.i)} x2=${x(hovered.i)} y1=${PAD.top} y2=${H - PAD.bottom}
              stroke=${cssVar('--chart-muted')} stroke-width="1" />
            <circle cx=${x(hovered.i)} cy=${y(hovered.tokens)} r="4.5"
              fill=${seriesColor} stroke=${cssVar('--chart-surface')} stroke-width="2" />`
          : nothing}
      </svg>
      ${hovered
        ? html`<div class="viz-tooltip" style="left:${this.hover.clientX + 14}px; top:${this.hover.clientY - 10}px">
            <strong>${hovered.day}</strong> · ${fmt(hovered.tokens)} tokens
            <div class="muted">${hovered.kind === 'forecast' ? 'forecast' : 'actual'}</div>
          </div>`
        : nothing}
    `;
  }

  renderModules() {
    const modules = this.summary.modules;
    const max = Math.max(...modules.map((m) => m.total_tokens)) || 1;
    const palette = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'];
    return html`
      ${modules.map((m, i) => {
        const color = cssVar(palette[i % palette.length]);
        return html`<div class="bar-row">
          <span>${m.module}</span>
          <div class="bar-track" title="${m.total_tokens.toLocaleString()} tokens">
            <div class="bar-fill" style="width:${(m.total_tokens / max) * 100}%; background:${color}"></div>
          </div>
          <span class="muted" style="text-align:right; font-variant-numeric: tabular-nums">
            ${fmt(m.total_tokens)} · $${m.cost_usd}
          </span>
        </div>`;
      })}
    `;
  }

  render() {
    if (this.error) return html`<div class="glass page error-text">${this.error}</div>`;
    if (!this.summary || !this.series || !this.suggestions) {
      return html`<div class="glass page muted">Loading tokenomics…</div>`;
    }
    const t = this.summary.totals;
    return html`
      <div class="page-grid">
        <div class="cards">
          <div class="glass stat-tile">
            <div class="stat-label">Total tokens (${t.days} days)</div>
            <div class="stat-value">${fmt(t.total_tokens)}</div>
          </div>
          <div class="glass stat-tile">
            <div class="stat-label">Estimated cost</div>
            <div class="stat-value">$${t.cost_usd}</div>
          </div>
          <div class="glass stat-tile">
            <div class="stat-label">Avg tokens / day</div>
            <div class="stat-value">${fmt(t.days ? t.total_tokens / t.days : 0)}</div>
          </div>
          <div class="glass stat-tile">
            <div class="stat-label">Modules tracked</div>
            <div class="stat-value">${this.summary.modules.length}</div>
          </div>
        </div>
        <div class="glass viz-root">
          <h2>Usage & 14-day forecast</h2>
          ${this.renderChart()}
        </div>
        <div class="glass viz-root">
          <h2>Module-wise usage</h2>
          ${this.renderModules()}
        </div>
        <div class="glass page">
          <h2>Suggested ways to reduce usage</h2>
          <h3 style="margin-top:0.8rem">Operational</h3>
          <div class="suggestions-grid">
            ${this.suggestions.operational.map(
              (s) => html`<div class="suggestion"><h4>💡 ${s.title}</h4><p>${s.detail}</p></div>`
            )}
          </div>
          <h3 style="margin-top:1rem">Development</h3>
          <div class="suggestions-grid">
            ${this.suggestions.development.map(
              (s) => html`<div class="suggestion"><h4>🛠 ${s.title}</h4><p>${s.detail}</p></div>`
            )}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('tokenomics-view', TokenomicsView);
