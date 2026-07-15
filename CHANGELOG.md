# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.1] - 2026-07-15

### Added
- Bootstrap of the platform: fully responsive PWA built with Vite + Lit, backed by FastAPI, packaged in a single multi-stage Dockerfile.
- Glassmorphic (light bluish) design system with system / light / dark theme switching.
- Authentication with JWT sessions and role-based access control: `user`, `operator`, `sysadmin`, `admin`.
- Settings page with typeahead search; sections collapse when idle and expand when focused/matched.
- Secure LLM key vault (Fernet-encrypted at rest) supporting OpenAI, NVIDIA, Grok (xAI), OpenRouter, vLLM, Ollama and local deployments such as LongCat.
- SQLite persistence on a mounted volume: `<app>.db` (application), `<app>-system.db` (system) and `<app>-audit.log` (audit trail, SQLite).
- Full request audit logging plus rotating application logs for traceability.
- Version indicator in the sidebar (below logout) that opens this changelog.
- Environment badge in the top bar (shown when `ENV` is anything other than `PRD`/`None`).
- localtunnel exposure on first build & run at `<app-name>-<env>.loca.lt`.
- Report a bug / request a feature from the profile dropdown; full triage list for admins in Settings.
- Tokenomics page (sysadmin/admin): module-wise usage metrics, usage forecasting line graph, and operational & development savings suggestions.
- Backup & DR settings section (sysadmin): scheduled full/incremental backups, on-demand backup and restore.
- Upgrade settings section (sysadmin): signed bundle upload, automatic restore point, self-upgrade and safe rollback.
- User management section for admins.
