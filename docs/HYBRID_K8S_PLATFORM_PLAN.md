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
| OS support | **OS-agnostic by design**: Linux, Windows, and macOS are all Tier-1 from day one — one behavior contract, per-OS backends behind a platform abstraction layer (§4.3) |
| UI | Vite + Lit PWA, compiled and **embedded into the binary** |
| Periphery | Python 3.12 (only where no permissively-licensed Rust library exists) |
| Cluster engines | k3s (default), k0s / kubeadm (large hosts), managed cloud K8s (EKS/GKE/AKS) for hybrid expansion |
| Node autoscaling | Karpenter (cloud node pools) + a built-in local node manager (on-prem) |
| Forecasting | Usage prediction feeding autoscaling recommendations |
| Agent | "Hermes"-style interact → learn → skill-store loop; primary interaction mode alongside dashboards |
| LLM gateway | Built-in OpenAI/Anthropic-compatible gateway: hosts local models (vLLM / Ollama), proxies external providers, mints per-app API keys |
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
| R9 | Built-in LLM gateway with vLLM; connect external + host local models; issue OpenAI/Anthropic-style API keys; configure apps to use the gateway | Gateway subsystem exposing `/v1/chat/completions` and `/v1/messages`; vLLM (GPU) / Ollama (CPU) hosted as managed cluster workloads; virtual keys (`sk-hyphae-…`) minted per app/user with quotas; one-click env-var injection into deployments (§10). |
| R10 | OS agnostic | Identical user-facing behavior on Linux, Windows, and macOS. Native binary per OS; OS differences isolated behind a platform abstraction layer; where a dependency is Linux-only (Kubernetes node components), hyphae transparently manages a lightweight Linux VM as the cluster host (§4.3). CI builds and tests all Tier-1 targets from M0, and every milestone's exit criteria are verified on all three. |
| R11 | UI accessible on all screen types incl. mobile; agent interaction everywhere | Mobile-first responsive PWA (installable); every critical operation — above all the Hermes chat — usable on small screens; agent chat is the primary mobile surface (§11). |
| R12 | Zip upload (code + Dockerfile/compose) → auto-created project under user or shared group → deploy, host, manage under that project; same via GitHub/GitLab URL + branch | First-class **Project** entity with owner (user or group), dedicated storage folder, namespace, and UI grouping — auto-created on intake if absent; build → registry → deploy pipeline with redeploys, rollbacks, and per-project domains/keys (§7.1). |
| R13 | Base info organized per the latest OKF version; viewable as an Obsidian vault from the source machine and via the UI | Per-project + platform knowledge base as plain Markdown with YAML frontmatter and wiki-links following OKF conventions (pinned latest version); stored as a valid Obsidian vault on disk; rendered read/write in the UI (§7.5). |

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
│   ├── hyphae-platform/        # OS abstraction: privilege, services, packages, virt, mesh (only crate with cfg(target_os))
│   ├── hyphae-detect/          # OS/hardware/virtualization capability probing
│   ├── hyphae-bootstrap/       # installers: git, runtimes, virtualizers, k8s flavors
│   ├── hyphae-cluster/         # cluster lifecycle: init, join, hybrid attach, degrade/recover
│   ├── hyphae-workload/        # deployments, isolated pods, embedded registry
│   ├── hyphae-net/             # tunnels, DNS registration, certificates
│   ├── hyphae-scale/           # metrics, Karpenter integration, autoscale tuning
│   ├── hyphae-agent/           # Hermes agent: LLM loop, skills store, activity miner
│   ├── hyphae-llmgw/           # LLM gateway: OpenAI/Anthropic-compatible API, virtual keys, routing, metering
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
- **macOS**: admin via Authorization Services; installs as a `launchd`
  daemon; Lima / Virtualization.framework backend.
- Everything the bootstrapper changes on the host is recorded in a **host
  ledger** (SQLite) enabling `hyphae uninstall` to fully revert.

### 4.3 Platform abstraction layer (OS-agnostic by construction)

hyphae is OS-agnostic as a hard requirement, not a porting afterthought.
All OS-specific behavior lives behind a single crate boundary
(`hyphae-platform`) of capability traits with one backend per OS:

| Capability trait | Linux | Windows | macOS |
|---|---|---|---|
| Privilege escalation | sudo / pkexec | UAC elevation | Authorization Services |
| Service supervision | systemd | Service Control Manager | launchd |
| Package installation | apt / dnf / pacman / apk / zypper | winget (choco fallback) | brew (pkg fallback) |
| Virtualization | KVM/QEMU via libvirt | Hyper-V / WSL2 | Lima / Virtualization.framework |
| VPN mesh | WireGuard kernel module | WireGuardNT | wireguard-go |
| Firewall/network | nftables | Windows Filtering Platform | pf |
| Paths, ledger, logs | XDG dirs | ProgramData/known folders | /Library + ~/Library |

Rules that keep it honest:

- **No `#[cfg(target_os)]` outside `hyphae-platform`.** Core, cluster,
  workload, net, scale, agent, and gateway code compile against traits only —
  the compiler enforces the boundary.
- **The Linux-kernel reality, handled once:** Kubernetes node components
  (kubelet, containerd, CNI) are Linux-native. On Linux, k3s/k0s run directly
  on the host. On Windows and macOS, the platform layer provisions and
  manages a lightweight Linux **cluster-host VM** (WSL2 on Windows, Lima on
  macOS) that runs the exact same k3s payload — same version, same manifests,
  same registry. Everything above the platform layer is unaware of the shim:
  port forwarding, file shares, and VM lifecycle (start at boot, health
  checks, resource resizing) are the platform backend's job. Windows worker
  nodes for Windows containers remain a possible Tier-2 extension.
- **Capability probing, not OS probing:** the detect module reports
  capabilities ("has KVM", "has Hyper-V", "GPU passthrough possible") and the
  capacity matrix consumes those — so a new OS or a new virtualization
  backend is a new platform backend, not a core change.
- **Linux is itself many environments** — the Linux backend is a matrix, not
  a single target, and the same capability-probing discipline applies inside
  it:

  | Axis | Variants handled | Strategy |
  |---|---|---|
  | Package manager | apt, dnf, pacman, apk, zypper, **none/unknown** | native manager preferred; unknown distro → self-contained static payloads (git, tools) from the pinned manifest, no package manager required |
  | Init system | systemd; OpenRC / runit / SysV; **no init** (containers, WSL, minimal VMs) | systemd units first-class; generic service-file templates for alternatives; initless environments run k3s as a directly supervised child of the hyphae daemon |
  | libc | glibc, musl (Alpine) | musl-static hyphae build; k3s is static already |
  | cgroups | v2 (required by modern K8s), v1 legacy | detect pass flags v1 with exact remediation steps before any install is attempted |
  | Security modules | SELinux (enforcing), AppArmor, none | install k3s-selinux policy where applicable; ship AppArmor profiles; never advise disabling enforcement |
  | Mutability | conventional; **immutable/atomic** (NixOS, Fedora Silverblue/ostree, SteamOS) | on immutable hosts skip host-package installs entirely — containerized/user-space payloads only, with a capability flag for what that excludes |
  | Where Linux runs | bare metal, VM guest, **LXC/Proxmox container, WSL itself** | nested-virtualization probe decides whether VM workers are offered; k3s still runs directly when virtualization is absent |
  | Architecture | x86_64, aarch64 (incl. ARM SBCs as LAN nodes) | Tier-1 builds for both; SBC images preconfigured as join-ready workers |
- **CI parity from M0:** build + unit tests on all Tier-1 targets every PR;
  an e2e bootstrap smoke test per OS gates every milestone — and the Linux
  smoke test runs across a distro matrix (Debian/Ubuntu, Fedora/RHEL-family,
  Arch, Alpine, openSUSE, one systemd-free image) in containers/VMs, not just
  one Ubuntu runner. Tier-1: `x86_64/aarch64-linux` (glibc + musl),
  `x86_64/aarch64-windows`, `aarch64/x86_64-macos`. Tier-2 (best-effort):
  immutable distros, FreeBSD.
- **Feature-gap policy:** when an OS genuinely cannot support a feature
  (e.g. GPU passthrough into WSL2 constraints), the feature degrades with an
  explicit, documented capability flag surfaced in the UI — never a silent
  difference in behavior.

---

## 5. Bootstrap engine & capacity-adaptive K8s flavor

### 5.1 Detection pass (`hyphae-detect`)

CPU cores, RAM, free disk, architecture, OS/version, cgroup version,
virtualization flags (VT-x/AMD-V, Hyper-V, KVM available), existing
container runtimes, existing kubeconfigs (never clobber), network egress,
**GPU inventory** (NVIDIA/AMD devices, driver + CUDA/ROCm versions — feeds
the LLM-gateway model-hosting matrix in §10.2), and whether we're inside a
VM/container ourselves.

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
- The matrix is OS-independent: on Windows and macOS the chosen flavor runs
  inside the managed cluster-host VM (§4.3), sized against the host's real
  capacity minus a reserved headroom; on Linux it runs directly on the host.
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

## 7. Projects, workloads, isolation, registry, tunneling & DNS

### 7.1 Project model & intake (zip / git)

A **Project** is the first-class unit everything hangs off: workloads,
domains, gateway keys, backups, and knowledge-base notes.

- **Ownership**: each project belongs to a user or a **shared group**
  (groups build on the existing role model). Storage layout mirrors it:
  `/data/projects/<user-or-group>/<project>/` — source snapshots, build
  logs, manifests, deploy history. The owner folder and UI grouping are
  auto-created on first intake when they don't exist.
- **Zip intake** (UI/agent, works from mobile): upload a codebase archive
  containing a `Dockerfile` or `docker-compose.yml` →
  server-side safety pass (size limits, path-traversal/zip-bomb checks) →
  detect build type → BuildKit build → push to the embedded registry →
  deploy into the project's namespace. Compose files are converted to
  Kubernetes manifests (compose-spec translation; `kompose`, Apache-2.0, as
  the reference implementation); multi-service compose maps to one project
  with multiple workloads.
- **Git intake**: repo URL + branch for GitHub or GitLab (including
  self-hosted instances); PAT/deploy-key credentials live in the encrypted
  vault. Clone (git is guaranteed present — bootstrap installed it) → same
  build/deploy pipeline.
- **Environment-aware deploy policies** (per project, per environment —
  environments map to namespaces and to the `{app}.{env}.…` subdomain
  scheme):

  | Environment | What is tracked | When it deploys |
  |---|---|---|
  | dev / qa | branch head (configurable branch per env) | **auto-sense and deploy latest**: webhook (delivered through the tunnel endpoint) when reachable, poll-on-interval fallback — every push builds and rolls out automatically |
  | prod | releases/tags (semver-ordered), not branch heads | **scheduled check windows** (cron-style, e.g. `Sun 02:00`): at each window, if a newer release exists it is built and deployed; optional approval gate and change-freeze windows |
  | any | — | manual "deploy now" always available (UI/agent), subject to the same pipeline |

  Policy is configuration, not code: switching qa from auto to scheduled, or
  pointing prod at a release channel, is an edit in the project's settings
  (agent-operable: "make prod check for releases nightly at 2am").
- **Rollback & restoration** — applies to every app on the system, whether
  it arrived via git or zip:
  - every deploy creates an immutable **revision**: image digest(s), rendered
    manifests, config/env, and the source ref (commit SHA / release tag / zip
    checksum) that produced it;
  - one-click (or one-sentence, via agent) rollback to **any** prior
    revision — not just the previous one; rollbacks re-use images pinned by
    digest from the embedded registry, so they work offline and never
    rebuild;
  - for stateful workloads, deploys optionally snapshot attached volumes as a
    **restore point** (reusing the existing backup/DR machinery), so a
    rollback can restore data alongside code — chosen explicitly at rollback
    time, since code-only vs. code+data rollback are different decisions;
  - prod scheduled deploys always create a restore point automatically before
    applying;
  - every rollback is itself a revision and an audited event, recorded in the
    project's KB note with the reason.
- **Lifecycle under the project**: logs, metrics, scaling recommendations,
  exposed domains, and LLM-gateway keys are all scoped and listed per
  project; deleting a project tears down workloads, DNS records, keys, and
  (optionally, after confirmation) storage.

### 7.2 Workload manager

- Deploy from: a project intake (§7.1 — zip or git), a bare image reference,
  or a compose-like `hyphae.yaml`.
- **Isolated pods**: per-workload namespaces + NetworkPolicy + PSA
  `restricted` by default; optional **gVisor** (`runsc`, Apache-2.0) runtime
  class for untrusted workloads, or **Kata Containers** where virtualization
  allows.
- **Embedded registry**: CNCF Distribution deployed in-cluster with
  pull-through cache of upstream registries; images survive offline periods;
  UI for image inventory and GC.

### 7.3 Tunnel manager

Pluggable backends, chosen by what the user has:

| Backend | When |
|---|---|
| `cloudflared` (Apache-2.0) | user has a Cloudflare-managed domain — best DX: tunnel + DNS + TLS in one |
| `rathole` (Apache-2.0) | user owns a public VPS — self-hosted tunnel, embedded natively (it's a Rust crate) |
| `frp` (Apache-2.0) | alternative self-hosted option |
| WireGuard mesh | node-to-node fleet traffic (not app publishing) |

### 7.4 Sub / sub-subdomain automation

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

### 7.5 Knowledge base — OKF organization, Obsidian-vault compatible

All "base info" — platform facts and per-project documentation — is managed
as a structured, plain-text knowledge base:

- **Format**: Markdown files with YAML frontmatter and `[[wiki-links]]`,
  organized per the **OKF** conventions, pinned to the latest published OKF
  version at build time; the version in use is recorded in the vault's
  metadata and migrations between OKF versions are applied by the platform,
  never by hand. *(Interpretation to confirm in §15: OKF read as the
  open knowledge-organization framework/spec you intend; the storage layer is
  spec-agnostic Markdown + frontmatter, so pinning to a different convention
  is a template change, not an architecture change.)*
- **Layout**: `/data/kb/` is a **valid Obsidian vault** (a `.obsidian/`
  config with sane defaults is generated) — open it directly from the source
  machine in Obsidian; the exact path is surfaced in the UI and via
  `hyphae kb path`. Structure mirrors ownership:
  `kb/projects/<owner-or-group>/<project>/…`, `kb/platform/…`,
  `kb/skills/…`.
- **Content, written by the system**: per-project overview (source origin —
  zip or repo+branch), deploy history with outcomes, exposed endpoints and
  domains, gateway keys in use (names only, never secrets), scaling
  recommendations and their realized results, incident notes, and the
  agent's learnings — the KB is the agent's human-readable long-term memory
  surface, cross-linked with the skills store (skills are themselves
  Markdown-described in `kb/skills/`).
- **Obsidian is a viewer, not a dependency**: Obsidian itself is not open
  source, so it is never bundled or required — hyphae only guarantees the
  vault is fully compatible. The files stay plain Markdown; any editor works.
- **OKF view in the UI**: the UI renders the vault read/write — Markdown
  editing, frontmatter forms, wiki-link navigation, backlink panel, and a
  link-graph view — so the same knowledge is reachable from a phone, the
  desktop UI, or Obsidian on the source machine. Concurrent edits are
  handled by the KB being a local git repository under the hood (auto-commit
  with attributed authorship; history browsable in the UI).

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

- **LLM connectivity**: the agent is itself a client of the built-in LLM
  gateway (§10) — it holds a gateway virtual key and picks a model alias, so
  provider keys, routing, fallbacks, and metering live in one place; fully
  functional with a gateway-hosted local model for offline/island mode.
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

## 10. Built-in LLM gateway (vLLM + external providers)

The environment ships an **LLM gateway** as a core subsystem: one
OpenAI/Anthropic-compatible endpoint that fronts both locally hosted models
and external providers, and mints its own API keys that apps (and the Hermes
agent) consume. Apps never see upstream provider keys.

### 10.1 API surface (`hyphae-llmgw`, Rust, in the main binary)

- **OpenAI-compatible**: `/v1/chat/completions`, `/v1/completions`,
  `/v1/embeddings`, `/v1/models` — anything built for the OpenAI SDK works by
  changing only `base_url` and `api_key`.
- **Anthropic-compatible**: `/v1/messages` — Anthropic SDKs work the same way.
- Streaming (SSE) passed through end-to-end; request/response normalized
  internally to one canonical schema so routing and metering are
  backend-agnostic.
- Reachable in-cluster at a stable service DNS name
  (`http://llm-gateway.hyphae.svc`), on the host at `localhost`, and — if the
  user chooses — published externally through the tunnel + subdomain
  machinery of §7 (e.g. `llm.home.example.com`) with TLS.

### 10.2 Model hosting backends (capacity-adaptive, like everything else)

Hosted models run as **managed cluster workloads** (not in-process), deployed
and health-checked by the workload manager:

| Host profile | Serving engine | Notes |
|---|---|---|
| NVIDIA GPU present | **vLLM** (Apache-2.0) | flagship backend: continuous batching, paged attention, OpenAI-compatible natively; bootstrap installs NVIDIA driver check + `nvidia-device-plugin` + container toolkit |
| AMD GPU (ROCm) | vLLM ROCm build | best-effort tier |
| CPU-only, ≥ 8 GiB | **Ollama** or `llama.cpp` server (MIT) | small quantized models; keeps agent + apps functional on modest hosts |
| Island mode | whichever local engine is installed | gateway keeps serving with zero egress |

- **Model catalog**: curated list (weights pulled from Hugging Face with
  license shown per model — gated/non-commercial models flagged before
  download); custom model paths supported. Weights cached in a PVC so they
  survive restarts and are shared across replicas.
- Model lifecycle in UI/agent: pull → serve (pick engine + quantization/
  context-length) → warm/cold status → retire. GPU sharing via time-slicing
  config where applicable.

### 10.3 Provider connectivity (external models through the same door)

- Upstream connectors: OpenAI, Anthropic, OpenRouter, xAI, NVIDIA NIM,
  any OpenAI-compatible endpoint (existing vLLM/Ollama elsewhere, LongCat…).
- Upstream credentials live in the existing encrypted key vault — entered
  once in the gateway settings, never exposed to apps.
- **Model aliases & routing**: a logical name (e.g. `default-chat`,
  `fast-embed`) maps to an ordered backend list — e.g. *local vLLM first,
  fall back to OpenRouter on overload, freeze to local-only in island mode*.
  Aliases are what apps and skills reference, so swapping providers never
  touches app config.

### 10.4 Virtual API keys (the "pick a key from here" flow)

- Gateway mints keys in the familiar format: `sk-hyphae-<random>` — created,
  named, and revoked from the UI or agent chat, exactly like the
  OpenAI/Anthropic console experience.
- Each key carries: owner (user/app), allowed model aliases, rate limits,
  token/cost quotas (day/month), and expiry. Stored hashed (argon2) — shown
  once at creation.
- Per-key metering: tokens in/out, latency, cost (provider price sheets for
  external, amortized estimate for local) — this feeds the existing
  Tokenomics dashboard and the forecasting loop (§8.3), so LLM traffic gets
  the same usage-prediction treatment as any workload, and vLLM deployments
  can be scaled/pre-warmed from predicted demand.

### 10.5 Configuring apps to use the gateway

- **One-click attach** (UI) / "wire this app to the gateway" (agent): creates
  a scoped virtual key, stores it as a K8s Secret, and injects standard env
  vars into the deployment:
  `OPENAI_BASE_URL=http://llm-gateway.hyphae.svc/v1`,
  `OPENAI_API_KEY=sk-hyphae-…` (and `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`
  equivalents) — zero code changes for apps using standard SDKs.
- Detach/rotate re-issues the key and rolls the deployment; deleting an app
  garbage-collects its keys.
- Skills can require an LLM capability, so a mined skill like "deploy repo Y
  with an LLM sidecar" wires the gateway automatically on replay.

---

## 11. UI (Vite + Lit)

Reuse the glassmorphic design system, auth/roles, settings, feedback, audit,
backup and upgrade machinery already built in this repo.

**Every screen size is a first-class client (R11).** The PWA is mobile-first
and installable: all critical operations work on a phone — approving a
recommendation, uploading a project zip, watching a deploy, revoking a key —
with the **agent chat as the primary mobile surface** (bottom-nav shortcut,
persistent conversation, voice-input friendly). Dashboards reflow from
multi-pane desktop layouts to single-column cards; tables become cards;
diagrams pan/zoom. Touch targets, safe-area insets, and WCAG 2.2 AA are
acceptance criteria, not polish. Anything doable in the UI is also doable by
asking the agent — which is what makes small screens fully capable.

New surfaces:

1. **Projects** — per user/shared group: intake (zip upload or repo+branch),
   build logs, deploy history with rollback, and the project's domains, keys,
   and KB notes in one place.
2. **Fleet map** — nodes (local/VM/LAN/cloud) with live health, capacity, and
   connectivity state; expansion actions inline.
3. **Workloads** — deployments, pods, images (registry browser), one-click
   expose (tunnel + domain).
4. **Network** — tunnels, domains/subdomains, certificates with expiry.
5. **Scaling & forecast** — usage graphs with forecast overlay,
   recommendations queue (accept/dismiss/auto), realized-savings tracker.
6. **Agent** — chat panel (persistent, per-user), skills library with run
   history and approval queue.
7. **LLM Gateway** — model catalog (hosted + external) with serve/retire
   controls, model-alias routing editor, virtual-key console
   (create/scope/revoke, usage per key), and app-attach management.
8. **Knowledge (OKF view)** — the vault rendered read/write: Markdown editor,
   frontmatter forms, wiki-link navigation, backlinks, and link graph (§7.5).
9. **Bootstrap wizard** — first-run experience mirroring the CLI/TUI flow.

Transport: REST + WebSocket (live events); the TUI (`ratatui`) offers the
same core flows for headless servers.

---

## 12. Security model

- Single admin bootstrap → least-privilege daemon afterwards (§4.2).
- All fleet traffic over WireGuard/mTLS; join tokens one-shot and short-lived.
- Secrets: age/Fernet-encrypted at rest in the system DB; cloud creds never
  written to disk unencrypted; SOPS-compatible export.
- LLM gateway: virtual keys stored hashed (argon2), scoped and quota-bound;
  upstream provider keys never leave the gateway process; externally
  published gateway endpoints require TLS + key auth and are rate-limited.
- Pod Security Admission `restricted` default; gVisor class for untrusted
  workloads; NetworkPolicy default-deny between app namespaces.
- Intake hardening: uploaded zips are size-capped and scanned for
  path-traversal/zip bombs before unpack; builds run in isolated BuildKit
  sandboxes; git intake credentials are scoped deploy keys/PATs held in the
  vault, never embedded in project storage.
- Full audit: every API/agent/skill action → audit log (existing pattern).
- Supply chain: pinned tool manifest with SHA-256, cosign verification where
  publishers sign (k3s, cloudflared); reproducible builds goal for our binary.

---

## 13. Delivery roadmap

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Skeleton** (2–3 wk) | Workspace, CI (lint/test/cross-build), axum + embedded UI shell, SQLite core, detect module | one binary serves UI, reports full host profile |
| **M1 — Bootstrap** (3–4 wk) | git/runtime installers, k3s single-node with capacity matrix, host ledger + uninstall | fresh Linux VM → running k3s + dashboard in one command |
| **M2 — Workloads & projects** (4–5 wk) | deploy/manage via `kube`, embedded registry, isolated-pod defaults, project model + zip/git intake, env-aware deploy policies (dev/qa auto-sense, prod scheduled releases), revision history + rollback with restore points | a zip uploaded from a phone becomes a running project-scoped app; a push to the qa branch auto-deploys; prod picks up a new release only in its window; either rolls back to any prior revision offline |
| **M3 — Expose** (3 wk) | tunnel backends, ingress-DNS controller, ACME certs, sub/sub-subdomain lifecycle | app reachable at `app.env.base` with valid TLS, auto-cleaned on delete |
| **M4 — Expansion** (4 wk) | LAN join, Local Node Manager (VM workers), degradation/recovery state machine | 3-node mixed cluster survives unplug → island → recover cycle |
| **M5 — Cloud hybrid** (4–5 wk) | EKS attach (Rust), GKE/AKS via pyhost, federated placement, Karpenter install/config | one workload policy-placed across local + cloud; Karpenter scales node group |
| **M6 — Forecasting** (3 wk) | metrics pipeline, forecasting service, recommendations engine (suggest mode) | forecasts with tracked accuracy; HPA/Karpenter suggestions with predicted savings |
| **M7 — LLM gateway** (3–4 wk) | OpenAI/Anthropic-compatible API, virtual keys + metering, provider connectors, vLLM (GPU) / Ollama (CPU) hosted-model lifecycle, app attach flow | an app with an unmodified OpenAI SDK runs against a gateway key hitting a locally hosted vLLM model, with per-key usage visible |
| **M8 — Agent, skills & knowledge base** (4–5 wk) | chat agent (as a gateway client) + typed tools, activity mining, skills store/replay, auto-apply scaling (opt-in), OKF knowledge base (vault on disk + UI view, system- and agent-written) | a mined skill is approved and re-run from chat; the project's KB note opens identically in Obsidian and the UI |
| **M9 — Hardening** (ongoing) | stretched-hybrid Phase B, air-gapped fat build, Tier-2 targets (immutable distros, FreeBSD), docs | beta release |

OS parity is **not** a milestone — it is part of every milestone: the CI
matrix builds and smoke-tests Linux, Windows, and macOS from M0, and each
milestone's exit criteria must pass on all three (M1's, for example, means a
fresh Windows machine reaches a running k3s-in-WSL2 + dashboard in one
command, same as Linux).

Parallelization: M3 and M4 are independent after M2; the gateway's API/key
layer (M7) only needs M2, so it can start early in parallel — only its
hosted-model piece waits on GPU bootstrap; agent groundwork (event log
discipline) starts at M0.

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Stretched hybrid control plane instability (latency, etcd) | cluster outages | ship federated model first; stretch mode opt-in + WireGuard + local-first scheduling |
| Karpenter expectations on-prem | confusion | explicit capacity story: Karpenter = cloud, Local Node Manager = local; one UI |
| K8s node components are Linux-only → Windows/macOS need a VM shim (WSL2/Lima) | complexity, perf overhead, VM lifecycle bugs | shim owned entirely by the platform layer with its own health checks and e2e suite; same k3s payload on every OS so cluster behavior never forks |
| Three-OS parity slows every milestone | schedule pressure | platform trait boundary keeps OS work parallel to feature work; capability flags allow explicit, documented degradation instead of blocking a release |
| Embedded Python payload size (~40–60 MB compressed) | binary bloat | lazy-extract, optional "slim" build without forecasting/cloudbridge |
| DNS provider API sprawl | maintenance | Cloudflare + Route53 native; everything else via one Python abstraction |
| LLM dependency for agent | offline dead agent | tools/skills replay work without an LLM; gateway-hosted local model keeps the agent alive offline |
| GPU driver/toolkit matrix for vLLM (CUDA versions, container toolkit, ROCm) | hosted models fail on some hosts | driver preflight in detect pass with clear remediation; Ollama/llama.cpp CPU fallback so the gateway always has a working local backend |
| Model weight licenses vary (some non-commercial/gated) | user compliance risk | per-model license surfaced and acknowledged before download; catalog defaults to permissive-weight models |
| Privilege footprint scares users | adoption | host ledger + full uninstall + dry-run plan shown before any host mutation |
| GPL contamination (e.g. some virtualization tooling) | licensing | CI license gate (`cargo-deny`, `pip-licenses`); shell-out (not link) for GPL system tools like QEMU |

---

## 15. Open questions (need product decisions)

1. **Base domain ownership** — bring-your-own-domain only, or also offer a
   free shared suffix (like `*.loca.lt` today) for zero-config users?
2. **Multi-tenancy depth** — are isolated pods per-user tenants (quota +
   RBAC per user) or just per-app isolation?
3. **Agent autonomy ceiling** — may auto-apply mode ever create *cloud* (i.e.
   billable) resources without a human click? Default answer proposed: no.
4. **Telemetry** — opt-in anonymous usage stats to improve the capacity
   matrix defaults?
5. **Gateway exposure default** — is the LLM gateway in-cluster/localhost
   only by default (proposed), with external publishing via tunnel an
   explicit per-gateway opt-in?
6. **OKF spec** — confirm which "OKF" the knowledge organization should pin
   to (the plan assumes an open knowledge-framework convention of Markdown +
   YAML frontmatter + wiki-links, applied as templates over a spec-agnostic
   store — so correcting this is a template change, not a redesign).
7. **Name** — "hyphae" is a placeholder.

---

## 16. Immediate next steps

1. Approve/adjust this plan (especially §6.1 phasing and §15 answers).
2. Scaffold the Cargo workspace + CI license gate (M0).
3. Port the existing Lit design system into `ui/` as the shell.
4. Spike: k3s unattended install + `kube`-driven health check on a clean VM —
   validates the bootstrap pattern end-to-end before wider build-out.
