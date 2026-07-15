"""Role-aware help manual.

Content is maintained here as markdown sections, each with a minimum role.
The endpoint returns only the sections the requesting user is allowed to see,
so every role gets the right amount of detail — no more, no less.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import config, security

router = APIRouter(prefix="/api/help", tags=["help"])

# (id, title, icon, min_role, markdown)
SECTIONS: list[dict] = [
    {
        "id": "getting-started",
        "title": "Getting started",
        "icon": "🚀",
        "min_role": "user",
        "body": """
Sign in with the username and password provided by your administrator. The sidebar
on the left is your main navigation:

- **Dashboard** — your landing page with quick links and your submitted reports.
- **Activity** — a log of your own actions in the application.
- **Settings** — appearance and the settings sections available to your role.

The app is an installable PWA: use your browser's *Install app* option to add it
to your home screen or desktop. Your session expires after a period of inactivity;
just sign in again.
""",
    },
    {
        "id": "appearance",
        "title": "Themes & appearance",
        "icon": "🎨",
        "min_role": "user",
        "body": """
Open **Settings → Appearance** and pick **System**, **Light** or **Dark**.
*System* follows your operating system preference automatically. The choice is
stored on your device, so each device can have its own theme.
""",
    },
    {
        "id": "feedback",
        "title": "Reporting bugs & requesting features",
        "icon": "🐞",
        "min_role": "user",
        "body": """
Use **Report a bug / Request a feature** at the bottom of the sidebar (above
Logout). Choose the type, set a priority (*low*, *medium*, *high*, *critical*)
and describe the issue or idea — what you did, what you expected, and what
happened. You can track the status of your submissions on the **Dashboard**
under *My bug reports & feature requests*.
""",
    },
    {
        "id": "activity",
        "title": "Your activity log",
        "icon": "≡",
        "min_role": "user",
        "body": """
The **Activity** page lists your recorded actions — sign-ins, requests and
changes you made. Use the search box and action filter to narrow the list.
This is a read-only view of the application's audit trail, scoped to your own
account.
""",
    },
    {
        "id": "llm-keys",
        "title": "Managing LLM API keys",
        "icon": "🔑",
        "min_role": "operator",
        "body": """
**Settings → LLM API Keys** stores provider credentials for the whole platform.
As an operator you can add and remove keys; regular users can only see which
providers are configured (keys are always masked).

- Supported providers: **OpenAI, NVIDIA NIM, Grok (xAI), OpenRouter, vLLM,
  Ollama**, and **local deployments** such as LongCat. Any model id is accepted.
- The *Base URL* is pre-filled per provider; override it for self-hosted
  endpoints (vLLM, Ollama, local).
- Keys are encrypted (Fernet) before they reach the database and are only ever
  displayed masked (first/last four characters). There is no way to read a
  stored key back — if one is lost, delete the entry and add it again.
- Every add/delete is audit-logged with your username.
""",
    },
    {
        "id": "activity-all",
        "title": "Application-wide activity",
        "icon": "🔎",
        "min_role": "sysadmin",
        "body": """
On the **Activity** page you see the full audit trail for all users, with an
extra *User* filter. Each entry records the user, role, action, request, HTTP
status, client IP and latency. The data lives in the dedicated audit database
(`<app>-audit.log`), separate from application and system data, and is included
in every full backup.
""",
    },
    {
        "id": "tokenomics",
        "title": "Tokenomics",
        "icon": "📈",
        "min_role": "sysadmin",
        "body": """
The **Tokenomics** page (sysadmin/admin) tracks LLM consumption:

- **Module-wise usage** — total tokens and estimated cost per application module.
- **Forecast** — the line chart shows daily token usage; the dashed segment is a
  linear (least-squares) projection of the next 14 days based on the observed
  trend. Hover for exact values.
- **Suggestions** — operational levers (caching, routing to smaller models,
  budgets) and development levers (prompt trimming, output constraints, batch
  embeddings) to reduce spend. Review after each significant usage change.
""",
    },
    {
        "id": "backup-dr",
        "title": "Backup & disaster recovery",
        "icon": "💾",
        "min_role": "sysadmin",
        "body": """
**Settings → Backup & DR** protects the three SQLite databases (application,
system, audit). All backups are consistent snapshots taken with SQLite's online
backup API — no downtime.

- **Full backup** — snapshots all three databases into one `.tar.gz`.
- **Incremental** — only databases changed since the previous backup.
- **Schedule** — enable and set the full/incremental cadence in hours; the
  scheduler runs inside the app process.
- **Restore** — restoring any backup first takes an automatic *restore-point*
  snapshot of the current state, so a restore can itself be undone. After a
  restore, ask users to reload the app.

Backups are stored under `backups/` on the data volume. For real DR, copy them
off the host regularly.
""",
    },
    {
        "id": "upgrades",
        "title": "Upgrades & rollback",
        "icon": "⬆️",
        "min_role": "sysadmin",
        "body": """
**Settings → Upgrades** performs safe self-upgrades from signed bundles.

1. **Sign** — bundles are `.tar.gz` archives signed with HMAC-SHA256 using the
   shared `UPGRADE_SIGNING_KEY`. Use `scripts/sign_bundle.py` to pack and sign;
   it prints the hex signature to upload alongside the file.
2. **Upload & verify** — the server recomputes the signature and rejects any
   mismatch before the bundle is stored.
3. **Apply** — creates an automatic restore point (database snapshot), then
   stages the bundle. The staged files are activated by the container
   entrypoint on the next restart.
4. **Rollback** — removes a staged bundle before restart. To also revert data
   changes, restore the linked restore point from Backup & DR.

Never share the signing key; rotate it if you suspect exposure (previously
uploaded bundles remain valid records but new uploads must be re-signed).
""",
    },
    {
        "id": "users",
        "title": "User & role management",
        "icon": "👥",
        "min_role": "admin",
        "body": """
**Settings → Users & Roles** creates accounts and controls access. Roles are
hierarchical — each level includes everything below it:

| Role | Adds |
|---|---|
| **user** | dashboard, own activity, feedback, theme |
| **operator** | manage LLM API keys |
| **sysadmin** | tokenomics, full activity, Backup & DR, Upgrades |
| **admin** | user management, feedback triage |

Accounts are disabled, not deleted, so their audit history stays intact. You
cannot disable your own account. The initial `admin` account is seeded on first
boot from `ADMIN_USERNAME`/`ADMIN_PASSWORD` — change that password immediately.
""",
    },
    {
        "id": "feedback-triage",
        "title": "Triaging feedback",
        "icon": "📋",
        "min_role": "admin",
        "body": """
**Settings → Bug Reports & Feature Requests** shows every submission from all
users with type, priority and details. Move items through the workflow with the
status dropdown: *open → triaged → in-progress → done* (or *rejected*). Users
see the updated status of their own items on their Dashboard. Status changes
are audit-logged.
""",
    },
]


@router.get("")
def get_help(user: dict = Depends(security.current_user)):
    level = config.ROLE_LEVELS[user["role"]]
    sections = [
        {k: s[k] for k in ("id", "title", "icon", "min_role", "body")}
        for s in SECTIONS
        if level >= config.ROLE_LEVELS[s["min_role"]]
    ]
    return {"role": user["role"], "sections": sections}
