# Hybrid Kubernetes Platform — Architecture & Implementation Plan

A single-executable, Rust-powered platform that turns any machine it runs on
(with admin privileges) into a self-provisioning, capacity-adaptive Kubernetes
environment — able to grow into a hybrid local + cloud cluster when
connectivity and resources allow, and shrink gracefully to a minimal
k3s-style footprint when they don't. Interaction happens through a
Hermes-style learning agent and a visual dashboard (Vite + Lit).

---

## 1. Product summary

| Aspect | Decision |
|---|---|
| Core runtime | Rust (single static executable per OS/arch) |
| UI | Vite + Lit PWA, compiled and **embedded into the binary** |
| Periphery | Python 3.12 (only where no permissively-licensed Rust library exists) |
| Cluster engines | k3s (default), k0s / kubeadm (large hosts), managed cloud K8s (EKS/GKE/AKS) for hybrid expansion |
| Node autoscaling | Karpenter (cloud node pools) + a built-in local node manager (on-prem) |
| Forecasting | Usage prediction feeding autoscaling recommendations |
| Agent | "Hermes"-style interact → learn → skill-store loop; primary interaction mode alongside dashboards |
| Licensing rule | All dependencies must be permissive OSS (MIT / Apache-2.0 / BSD / MPL-2.0). No GPL/AGPL runtime linking. |

### What the executable does end-to-end

1. **Run as admin** → detect OS, CPU, RAM, disk, virtualization support, network.
2. **Bootstrap infra**: install/verify git, a container runtime, a virtualizer
   when needed, and the Kubernetes flavor that fits the machine's capacity.
3. **Serve the control plane UI + agent** on localhost (tunnel-exposed on demand).
4. **Expand interactively**: join more local/LAN nodes, or attach cloud K8s
   node groups → hybrid cluster.
5. **Degrade gracefully**: when cloud/peers are unreachable, continue as a
   minimal k3s-style single node that can still accept new deployments,
   run isolated pods, and host images from its embedded registry.
6. **Expose apps**: tunnel workloads and auto-register `app.env.example.com`
   style sub- and sub-subdomains, keeping DNS + certs maintained.
7. **Scale intelligently**: Karpenter for cloud capacity, usage forecasting to
   tune scale-up/scale-down policies over time.
8. **Learn**: the agent observes repeated operator activities and promotes them
   into reusable, versioned "skills."

---

## 2. Requirement interpretation & clarifications

The raw requirements, restated as testable capabilities:

| # | Requirement | Interpretation |
|---|---|---|
| R1 | Rust + Vite + Lit, single executable | Rust binary embeds the compiled Vite/Lit assets (rust-embed) and serves them via axum. No external web server. |
| R2 | Python only for periphery | Python sub-processes for cloud SDK gaps and ML forecasting; shipped as an embedded, self-extracting runtime (python-build-standalone) — the user never installs Python. |
| R3 | Admin-run infra setup | Idempotent bootstrap: git, container runtime, virtualizer, K8s flavor chosen from a capacity matrix (§5). |
| R4 | Interactive node/cluster expansion incl. cloud | Wizard + agent-driven flows to join LAN nodes and attach EKS/GKE/AKS node groups → one hybrid cluster (§6). |
| R5 | Minimize to k3s-style when isolated | Offline/degraded mode keeps scheduling, deployments, isolated pods, and a local image registry alive (§6.4). |
| R6 | Tunneling + auto sub/sub-subdomain registration | Tunnel manager (cloudflared / rathole / frp) + DNS automation with cert issuance and renewal (§7). |
| R7 | Karpenter + usage forecasting to tune autoscaling | Karpenter provisions cloud nodes; a forecasting service predicts per-app load and adjusts HPA/Karpenter parameters (§8). |
| R8 | Hermes-like agent with skills memory | Conversational agent that executes platform operations, observes frequent action sequences, and stores them as replayable skills (§9). |

**Important honesty note on Karpenter (R7):** Karpenter provisions *cloud*
instances via provider integrations (AWS, Azure, GCP, AlibabaCloud, Oracle —
all permissive OSS). It cannot conjure bare-metal machines. The plan therefore
uses Karpenter for the cloud side of the hybrid cluster and a built-in
**Local Node Manager** (VM-based, via the installed virtualizer) for elastic
capacity on the host machine and LAN.

---

## 3. High-level architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  hyphae (single Rust executable)                                   │
│                                                                    │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────────┐  │
│  │ UI server    │  │ Hermes agent  │  │ Bootstrap engine        │  │
│  │ axum + embed │  │ chat + skills │  │ detect / install / heal │  │
│  │ (Vite+Lit)   │  └──────┬────────┘  └───────────┬─────────────┘  │
│  └──────┬───────┘         │                       │                │
│         │        ┌────────┴───────────┐           │                │
│         │        │ Orchestration core │◄──────────┘                │
│         │        │ (state machine +   │                            │
│         │        │  task queue, SQLite│                            │
│         │        │  event log)        │                            │
│         │        └───┬────┬────┬───┬──┘                            │
│  ┌──────┴───┐ ┌──────┴─┐ ┌┴───┐ ┌┴───────┐ ┌─────────────────┐    │
│  │ Cluster  │ │Workload│ │Net │ │Scaling │ │ Python sidecar  │    │
│  │ manager  │ │manager │ │mgr │ │& fcast │ │ host (uv-run,   │    │
│  │ (k8s     │ │(deploy,│ │(tun│ │(metrics│ │ JSON-RPC over   │    │
│  │ install, │ │ pods,  │ │nel,│ │ +      │ │ stdio)          │    │
│  │ join,    │ │registry│ │DNS,│ │Karpen- │ │  • forecasting  │    │
│  │ hybrid)  │ │)       │ │TLS)│ │ter)    │ │  • cloud gaps   │    │
│  └──────────┘ └────────┘ └────┘ └────────┘ └─────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
        │                 │                    │
   k3s/k0s/kubeadm   embedded OCI         cloudflared / rathole
   + cloud K8s       registry (distribution)   + DNS providers
```

Working name: **hyphae** (fungal threads that grow a network from a single
spore — rename freely).

### 3.1 Crate layout (Cargo workspace)

```
hyphae/
├── Cargo.toml                  # workspace
├── crates/
│   ├── hyphae-cli/             # main binary: CLI + TUI entry, embeds UI + python payloads
│   ├── hyphae-core/            # orchestration state machine, task queue, event log
│   ├── hyphae-detect/          # OS/hardware/virtualization capability probing
│   ├── hyphae-bootstrap/       # installers: git, runtimes, virtualizers, k8s flavors
│   ├── hyphae-cluster/         # cluster lifecycle: init, join, hybrid attach, degrade/recover
│   ├── hyphae-workload/        # deployments, isolated pods, embedded registry
│   ├── hyphae-net/             # tunnels, DNS registration, certificates
│   ├── hyphae-scale/           # metrics, Karpenter integration, autoscale tuning
│   ├── hyphae-agent/           # Hermes agent: LLM loop, skills store, activity miner
│   ├── hyphae-pyhost/          # embedded Python runtime manager + JSON-RPC bridge
│   └── hyphae-api/             # axum HTTP/WS API + embedded UI assets
├── ui/                         # Vite + Lit PWA (built → embedded via rust-embed)
├── py/                         # Python periphery packages (vendored wheels, uv lockfile)
│   ├── forecasting/            # usage prediction service
│   └── cloudbridge/            # cloud/DNS gap-fillers
└── docs/
```

### 3.2 Key Rust dependencies (all permissive)

| Concern | Crate |
|---|---|
| HTTP/WS server | `axum`, `tower`, `tokio` |
| Embedded UI | `rust-embed` |
| Kubernetes API | `kube` + `k8s-openapi` (Apache-2.0) |
| State/event store | `rusqlite` (bundled SQLite) |
| System probing | `sysinfo`, `nix`, `windows` crates |
| Downloads/verification | `reqwest`, `sha2`, `sigstore` (optional) |
| TUI | `ratatui` |
| Serialization | `serde`, `serde_yaml`, `serde_json` |
| Templating manifests | `minijinja` |
| Certificates | `rcgen` (internal CA), `instant-acme` (Let's Encrypt) |
| Tunnels | shell out to `cloudflared`; `rathole` (Apache-2.0) embeddable as a library/binary |
| AWS (native) | `aws-sdk-rust` (Apache-2.0) — EKS, EC2, Route53 |
| Metrics scrape | `prometheus-parse` / direct `kube` metrics API |

### 3.3 Python periphery — the explicit inventory

Python is used **only** where the Rust ecosystem lacks a permissive,
production-grade library. Each item below is a separately shippable
JSON-RPC service run by `hyphae-pyhost`:

| Service | Why Python | Libraries (license) |
|---|---|---|
| `forecasting` | Mature time-series ML | `statsforecast`/`neuralforecast` (Apache-2.0), `pandas` (BSD), `scikit-learn` (BSD). *Not* Prophet (its Stan backend chain is heavier; keep optional). |
| `cloudbridge.gcp` | GKE/GCE management — official Rust SDK still immature | `google-cloud-container`, `google-cloud-dns` (Apache-2.0) |
| `cloudbridge.azure` | AKS management — Azure Rust SDK not GA for all services | `azure-mgmt-containerservice`, `azure-mgmt-dns` (MIT) |
| `dnsbridge` | Long-tail DNS registrars (Namecheap, Porkbun, deSEC…) via one abstraction | `octodns` (MIT) or per-provider clients |

Rules:
- Rust ↔ Python contract is JSON-RPC 2.0 over stdio; schemas defined once in
  JSON Schema and code-genned both ways.
- Python runtime ships inside the executable as a compressed
  `python-build-standalone` (PSF/permissive) payload + vendored wheels,
  extracted to the app data dir on first run. Offline-safe, no pip at runtime.
- AWS deliberately stays in Rust (`aws-sdk-rust` is mature) — Python is the
  exception, not the default.
- Any periphery service that later gains a good Rust crate gets migrated; the
  RPC seam makes this a drop-in swap.

---

## 4. Single-executable packaging & privilege model

### 4.1 Packaging

- One binary per target: `x86_64/aarch64` × `linux-musl`, `windows-msvc`,
  `apple-darwin`.
- Embedded payloads (compressed, integrity-checked): UI dist, Python runtime +
  wheels, pinned tool versions manifest (k3s, k0s, cloudflared, helm,
  crictl…). Tools themselves are downloaded on demand with SHA-256
  verification against the pinned manifest; an optional "fat" build embeds
  them for air-gapped installs.
- Self-update: staged binary swap with rollback (pattern already proven in
  this repo's upgrade flow).

### 4.2 Privileges

- **Linux**: require root (or re-exec via `sudo`/`pkexec`); after bootstrap,
  the long-running daemon drops to a dedicated `hyphae` user; privileged
  operations go through a small setuid-free helper invoked via systemd units.
- **Windows**: manifest requests elevation (UAC); installs as a Windows
  service; Hyper-V/WSL2 feature enablement handled with clear reboot prompts.
- **macOS** (dev-grade support): admin via `authorization services`; Lima/Vz
  virtualization backend.
- Everything the bootstrapper changes on the host is recorded in a **host
  ledger** (SQLite) enabling `hyphae uninstall` to fully revert.

---

## 5. Bootstrap engine & capacity-adaptive K8s flavor

### 5.1 Detection pass (`hyphae-detect`)

CPU cores, RAM, free disk, architecture, OS/version, cgroup version,
virtualization flags (VT-x/AMD-V, Hyper-V, KVM available), existing
container runtimes, existing kubeconfigs (never clobber), network egress,
and whether we're inside a VM/container ourselves.

### 5.2 Installation pass (`hyphae-bootstrap`)

Each installer is an idempotent, versioned, resumable step with
verify → install → configure → health-check phases:

- **git** — native package manager (apt/dnf/pacman/winget/brew) with pinned
  minimum version; skip when present.
- **Container runtime** — containerd (preferred; bundled with k3s/k0s).
- **Virtualizer** — only when needed for local node expansion or isolation:
  Linux → KVM/QEMU + `libvirt`; Windows → Hyper-V or WSL2; macOS → Lima.
- **Kubernetes flavor** — from the capacity matrix:

| Machine profile | Flavor | Rationale |
|---|---|---|
| < 2 GiB RAM or 1 vCPU | k3s, single node, sqlite datastore, servicelb, traefik off | absolute minimum footprint |
| 2–8 GiB, 2–4 vCPU | k3s single node, embedded etcd off, metrics-server on | default desktop/laptop |
| 8–32 GiB, 4–16 vCPU | k3s server + capacity to host **local VM worker nodes** | can act as multi-node seed |
| > 32 GiB / server class | k0s or kubeadm HA-capable control plane | room for real control plane; can head a hybrid fleet |
| Existing cluster detected | *attach mode* — never install a second cluster | operate as a management plane only |

- Flavor choice is a **recommendation the user confirms** (via agent or UI),
  with overrides.
- All manifests we lay down (registry, tunnel agents, forecasting collectors)
  are Helm-free static YAML rendered by `minijinja`, applied via `kube` —
  fewer moving parts than depending on helm at bootstrap time.

---

## 6. Cluster manager: hybrid topology, expansion, degradation

### 6.1 Topology model

One logical **fleet** = local seed cluster + optional attached capacity:

- **Local nodes**: the host itself; VMs the Local Node Manager creates on the
  host; other LAN machines running the same executable in *agent mode*.
- **Cloud nodes**: managed K8s (EKS/GKE/AKS) node groups attached to the fleet.

Hybrid strategy (phased, honest about complexity):

- **Phase A — federated hybrid (ship first):** local cluster and cloud
  cluster(s) remain separate K8s control planes; hyphae is the multi-cluster
  scheduler that places *deployments* (not pods) per policy (cost, latency,
  data locality) and syncs images/secrets/DNS. This is robust and achievable.
- **Phase B — stretched hybrid (later, opt-in):** cloud VMs join the local
  control plane as worker nodes over a WireGuard mesh (k3s has first-class
  `--node-external-ip` + WireGuard flannel backend). Single control plane,
  higher blast radius — gated behind an "advanced" flag.

### 6.2 Interactive node expansion

- **LAN node join**: `hyphae join <token-url>` on the new machine, or the
  seed generates a one-shot QR/URL; mDNS discovery lists candidate machines in
  the UI ("expand cluster → detected devices").
- **Local VM workers**: UI slider / agent command ("add a 4 GiB worker") →
  Local Node Manager provisions a VM via libvirt/Hyper-V/Lima with a minimal
  OS image and k3s agent, joins automatically.
- **Cloud attach wizard**: credentials → pick/create cluster → node group
  sizing → Karpenter installed and configured → fleet registration. AWS via
  Rust SDK; GCP/Azure via the Python cloudbridge.

### 6.3 Fleet state & reconciliation

`hyphae-core` keeps desired fleet state in SQLite and reconciles
continuously (controller pattern). Every mutation is an event in an
append-only log — this feeds the UI timeline, the audit trail, *and* the
agent's activity-mining (§9).

### 6.4 Degraded / offline mode (R5)

Connectivity watcher classifies state: `hybrid`, `local-only`,
`island` (no egress at all). On degradation:

- Cloud placements are frozen (not deleted); local replicas scale to the
  configured minimum viable set.
- The **embedded OCI registry** (CNCF Distribution, Apache-2.0) keeps serving
  cached images — new deployments of cached images still work offline.
- Tunnels and DNS updates queue; the platform keeps serving on the LAN.
- On recovery: state diff → reconciliation plan → user (or policy) approves →
  re-expand.

---

## 7. Workloads, isolation, registry, tunneling & DNS

### 7.1 Workload manager

- Deploy from: image reference, git repo (buildpacks or Dockerfile build via
  BuildKit), or a compose-like `hyphae.yaml`.
- **Isolated pods**: per-workload namespaces + NetworkPolicy + PSA
  `restricted` by default; optional **gVisor** (`runsc`, Apache-2.0) runtime
  class for untrusted workloads, or **Kata Containers** where virtualization
  allows.
- **Embedded registry**: CNCF Distribution deployed in-cluster with
  pull-through cache of upstream registries; images survive offline periods;
  UI for image inventory and GC.

### 7.2 Tunnel manager

Pluggable backends, chosen by what the user has:

| Backend | When |
|---|---|
| `cloudflared` (Apache-2.0) | user has a Cloudflare-managed domain — best DX: tunnel + DNS + TLS in one |
| `rathole` (Apache-2.0) | user owns a public VPS — self-hosted tunnel, embedded natively (it's a Rust crate) |
| `frp` (Apache-2.0) | alternative self-hosted option |
| WireGuard mesh | node-to-node fleet traffic (not app publishing) |

### 7.3 Sub / sub-subdomain automation

- Naming scheme: `{app}.{env}.{cluster}.{base-domain}` — e.g.
  `api.dev.home.example.com` (sub-subdomains are just deeper labels; DNS
  handles them natively; note wildcard certs only cover one level, so we
  issue per-app certs or per-env wildcards `*.dev.home.example.com`).
- A lightweight **ingress-DNS controller** inside hyphae watches Ingress/
  Service objects and reconciles records via: Cloudflare API (Rust), Route53
  (Rust SDK), others through `dnsbridge` (Python).
- TLS: `instant-acme` for Let's Encrypt DNS-01 (works behind tunnels);
  internal CA (`rcgen`) for LAN-only names; renewal + revocation maintained
  automatically ("and maintain" in the requirement = renewal, drift repair,
  and cleanup of records for deleted apps).

---

## 8. Autoscaling: Karpenter + forecasting

### 8.1 Karpenter (cloud capacity)

- Installed automatically on attached cloud clusters (or on the stretched
  cluster in Phase B with the matching provider).
- hyphae generates and manages `NodePool`/`NodeClass` resources from the
  user's cost/instance constraints; consolidation enabled by default.

### 8.2 Local elasticity (no Karpenter on bare metal)

- The Local Node Manager mimics Karpenter's contract: watches unschedulable
  pods → provisions a local VM worker (within host headroom limits) →
  deprovisions when consolidation criteria hit. Same UI surface, different
  engine — users see one "capacity" story.

### 8.3 Forecasting & autoscale tuning loop

```
metrics-server / kube-state-metrics
        │  (scraped by hyphae-scale, stored in SQLite ring buffer)
        ▼
forecasting service (Python: statsforecast — AutoETS/AutoARIMA/MSTL,
        per-workload seasonal profiles: daily/weekly)
        ▼
recommendations engine (Rust):
  • HPA min/max & target utilization per workload
  • Karpenter NodePool limits & consolidation windows
  • pre-scale schedules for predicted spikes (cron-like warm-up)
        ▼
apply modes: observe → suggest (default) → auto-apply (opt-in, guarded
by budget caps and change windows)
```

- Every recommendation records its predicted vs. actual outcome — this
  closes the "help finetune" loop and is surfaced in a Tokenomics-style
  savings dashboard (pattern reusable from this repo's existing UI).

---

## 9. The Hermes agent: interact → learn → skills

### 9.1 Role

The agent is a **first-class interaction mode** next to the dashboard: a chat
panel (and `hyphae chat` TUI) that can execute any platform operation the UI
can, through the same internal API with the same RBAC.

### 9.2 Architecture

- **LLM connectivity**: reuse the existing key-vault pattern (OpenAI,
  Anthropic, OpenRouter, vLLM, Ollama, local models) — Fernet/age-encrypted
  keys; fully functional with a local Ollama model for offline/island mode.
- **Tooling layer**: every orchestration-core operation is exposed as a typed
  tool (JSON Schema), so the agent's capabilities and the REST API never
  drift. Destructive tools require confirmation unless a policy pre-approves.
- **Memory**: SQLite-backed — episodic (conversations + executed plans),
  semantic (facts about this fleet: domains, clusters, quirks), and the
  skills store.

### 9.3 The learn loop (activities → skills)

1. **Observe**: the append-only event log (§6.3) already captures every
   operation with its parameters, actor, and outcome.
2. **Mine**: a background job runs frequent-sequence mining (n-gram /
   prefix-span over operation sequences, windowed by session) to find
   recurring multi-step activities, e.g. *"deploy image X → create tunnel →
   register dev subdomain → set HPA 2–5"*.
3. **Propose**: candidates above support/confidence thresholds are drafted by
   the LLM into a **skill**: name, description, parameterized step list
   (which parts varied become parameters), preconditions, rollback notes.
4. **Approve & store**: user approves in UI/chat; skill saved as versioned
   YAML in the skills store (git-backed directory → shareable/exportable).
5. **Invoke**: skills become one-click UI actions *and* agent tools
   ("spin up the usual dev stack for repo Y"); execution is replayed through
   the same task queue with full audit.
6. **Refine**: failed or edited runs update the skill (new version), keeping
   a diffable history.

### 9.4 Safety rails

- Skills and agent actions run under the invoking user's role (existing
  user/operator/sysadmin/admin model fits).
- Dry-run/plan mode for any skill; budget guards for anything that creates
  cloud resources; island mode disables cloud-touching tools automatically.

---

## 10. UI (Vite + Lit)

Reuse the glassmorphic design system, auth/roles, settings, feedback, audit,
backup and upgrade machinery already built in this repo. New surfaces:

1. **Fleet map** — nodes (local/VM/LAN/cloud) with live health, capacity, and
   connectivity state; expansion actions inline.
2. **Workloads** — deployments, pods, images (registry browser), one-click
   expose (tunnel + domain).
3. **Network** — tunnels, domains/subdomains, certificates with expiry.
4. **Scaling & forecast** — usage graphs with forecast overlay,
   recommendations queue (accept/dismiss/auto), realized-savings tracker.
5. **Agent** — chat panel (persistent, per-user), skills library with run
   history and approval queue.
6. **Bootstrap wizard** — first-run experience mirroring the CLI/TUI flow.

Transport: REST + WebSocket (live events); the TUI (`ratatui`) offers the
same core flows for headless servers.

---

## 11. Security model

- Single admin bootstrap → least-privilege daemon afterwards (§4.2).
- All fleet traffic over WireGuard/mTLS; join tokens one-shot and short-lived.
- Secrets: age/Fernet-encrypted at rest in the system DB; cloud creds never
  written to disk unencrypted; SOPS-compatible export.
- Pod Security Admission `restricted` default; gVisor class for untrusted
  workloads; NetworkPolicy default-deny between app namespaces.
- Full audit: every API/agent/skill action → audit log (existing pattern).
- Supply chain: pinned tool manifest with SHA-256, cosign verification where
  publishers sign (k3s, cloudflared); reproducible builds goal for our binary.

---

## 12. Delivery roadmap

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Skeleton** (2–3 wk) | Workspace, CI (lint/test/cross-build), axum + embedded UI shell, SQLite core, detect module | one binary serves UI, reports full host profile |
| **M1 — Bootstrap** (3–4 wk) | git/runtime installers, k3s single-node with capacity matrix, host ledger + uninstall | fresh Linux VM → running k3s + dashboard in one command |
| **M2 — Workloads** (3 wk) | deploy/manage via `kube`, embedded registry, isolated-pod defaults | deploy, isolate, and serve an app fully offline |
| **M3 — Expose** (3 wk) | tunnel backends, ingress-DNS controller, ACME certs, sub/sub-subdomain lifecycle | app reachable at `app.env.base` with valid TLS, auto-cleaned on delete |
| **M4 — Expansion** (4 wk) | LAN join, Local Node Manager (VM workers), degradation/recovery state machine | 3-node mixed cluster survives unplug → island → recover cycle |
| **M5 — Cloud hybrid** (4–5 wk) | EKS attach (Rust), GKE/AKS via pyhost, federated placement, Karpenter install/config | one workload policy-placed across local + cloud; Karpenter scales node group |
| **M6 — Forecasting** (3 wk) | metrics pipeline, forecasting service, recommendations engine (suggest mode) | forecasts with tracked accuracy; HPA/Karpenter suggestions with predicted savings |
| **M7 — Agent & skills** (4 wk) | chat agent + typed tools, activity mining, skills store/replay, auto-apply scaling (opt-in) | a mined skill is approved and successfully re-run from chat |
| **M8 — Hardening** (ongoing) | Windows/macOS parity, stretched-hybrid Phase B, air-gapped fat build, docs | beta release |

Parallelization: M3 and M4 are independent after M2; agent groundwork
(event log discipline) starts at M0.

---

## 13. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Stretched hybrid control plane instability (latency, etcd) | cluster outages | ship federated model first; stretch mode opt-in + WireGuard + local-first scheduling |
| Karpenter expectations on-prem | confusion | explicit capacity story: Karpenter = cloud, Local Node Manager = local; one UI |
| Windows support breadth (Hyper-V/WSL2 matrix) | delays | Linux first-class at every milestone; Windows gated to M8 beta |
| Embedded Python payload size (~40–60 MB compressed) | binary bloat | lazy-extract, optional "slim" build without forecasting/cloudbridge |
| DNS provider API sprawl | maintenance | Cloudflare + Route53 native; everything else via one Python abstraction |
| LLM dependency for agent | offline dead agent | tools/skills replay work without an LLM; local Ollama supported |
| Privilege footprint scares users | adoption | host ledger + full uninstall + dry-run plan shown before any host mutation |
| GPL contamination (e.g. some virtualization tooling) | licensing | CI license gate (`cargo-deny`, `pip-licenses`); shell-out (not link) for GPL system tools like QEMU |

---

## 14. Open questions (need product decisions)

1. **Base domain ownership** — bring-your-own-domain only, or also offer a
   free shared suffix (like `*.loca.lt` today) for zero-config users?
2. **Multi-tenancy depth** — are isolated pods per-user tenants (quota +
   RBAC per user) or just per-app isolation?
3. **Agent autonomy ceiling** — may auto-apply mode ever create *cloud* (i.e.
   billable) resources without a human click? Default answer proposed: no.
4. **Telemetry** — opt-in anonymous usage stats to improve the capacity
   matrix defaults?
5. **Name** — "hyphae" is a placeholder.

---

## 15. Immediate next steps

1. Approve/adjust this plan (especially §6.1 phasing and §14 answers).
2. Scaffold the Cargo workspace + CI license gate (M0).
3. Port the existing Lit design system into `ui/` as the shell.
4. Spike: k3s unattended install + `kube`-driven health check on a clean VM —
   validates the bootstrap pattern end-to-end before wider build-out.
