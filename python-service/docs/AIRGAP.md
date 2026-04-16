# Air-gap Deployment

For NBE branches or regulator-segregated environments that never touch the public internet.

## Build (on a connected build host)

```bash
cd python-service
bash scripts/build_airgap.sh 1.0.0
# → produces nbe-dms-airgap-1.0.0.tar.zst (~4-6 GB)
```

The bundle contains:
- Docker images (api + worker + Postgres + Redis + Elasticsearch + Prometheus + Grafana) — `docker save`'d
- Helm chart + `values-airgap.yaml`
- All Python wheels for `requirements.txt` + `requirements-extras.txt` (manylinux 2014 / py3.11)
- Kubernetes manifests (policy, falco rules, network policy, rollouts, chaos templates)
- SPDX SBOMs for every image (via syft)
- `install.sh` / `verify.sh` / `uninstall.sh`
- `checksums.txt` with SHA-256 of every file

## Ship

Copy the `.tar.zst` onto **two independent** write-once media (e.g. two USB sticks from
different manufacturers). Verify SHA-256 on the target side before expansion.

## Install (on the airgapped host)

Prereqs (must pre-exist on the host — they are NOT in the bundle intentionally):
- Docker engine 20+
- Kubernetes (k3s / RKE2 / microk8s is fine)
- `helm` 3.14+
- A local container registry at `localhost:5000` (k3s ships one; otherwise
  `docker run -d -p 5000:5000 registry:2`)

```bash
zstd -d nbe-dms-airgap-1.0.0.tar.zst -o nbe-dms-airgap.tar
tar -xvf nbe-dms-airgap.tar
cd airgap-bundle
bash scripts/install.sh
API_KEY=... bash scripts/verify.sh
```

## Update cadence

- **Quarterly** re-builds with latest CVE patches; ship a delta bundle
  (`scripts/build_airgap.sh --delta` — future work to diff images).
- **Monthly** wheel refresh for Python CVEs only (much smaller bundle).
- **Emergency** (critical CVE): build and ship an incremental bundle within 48h.
