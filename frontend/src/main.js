import './styles.css';
import './components/app-root.js';
import './components/login-view.js';
import './components/side-bar.js';
import './components/top-bar.js';
import './components/dashboard-view.js';
import './components/activity-view.js';
import './components/settings-view.js';
import './components/tokenomics-view.js';
import './components/changelog-modal.js';
import './components/feedback-modal.js';
import './components/help-modal.js';

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
