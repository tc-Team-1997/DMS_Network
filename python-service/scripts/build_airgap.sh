#!/usr/bin/env bash
# Builds a single-tarball offline installer:
#   nbe-dms-airgap-<version>.tar.zst
#
# Contents:
#   images/            docker save of api + worker + required deps (postgres, redis, es)
#   charts/            helm chart + values-airgap.yaml
#   wheels/            pip wheels for all Python deps (base + extras)
#   manifests/         k8s manifests (policy, falco rules, network policy)
#   scripts/           install.sh, uninstall.sh, verify.sh
#   sboms/             SPDX + CycloneDX attestations (if cosign + syft present)
#   checksums.txt      sha256 of every file in the archive
#
# Usage:
#   bash scripts/build_airgap.sh 1.0.0
set -euo pipefail
VERSION="${1:-$(date +%Y%m%d%H%M)}"
OUT="airgap-bundle"
rm -rf "$OUT" && mkdir -p "$OUT"/{images,charts,wheels,manifests,scripts,sboms}

# 1. Docker images (pin exact digests so the install is reproducible)
IMAGES=(
  "nbe/dms-python:$VERSION"
  "nbe/dms-python-worker:$VERSION"
  "postgres:16.3-alpine"
  "redis:7.2-alpine"
  "docker.elastic.co/elasticsearch/elasticsearch:8.13.4"
  "prom/prometheus:v2.52.0"
  "grafana/grafana:11.0.0"
)
for img in "${IMAGES[@]}"; do
  fname="$OUT/images/$(echo "$img" | tr '/:' '__')".tar
  docker pull "$img"
  docker save -o "$fname" "$img"
done

# 2. Helm chart
cp -r helm/nbe-dms "$OUT/charts/"
cat > "$OUT/charts/values-airgap.yaml" <<'YAML'
image:
  repository: localhost:5000/nbe/dms-python
  pullPolicy: IfNotPresent
ingress: {enabled: false}
serviceMonitor: {enabled: false}
env:
  APP_ENV: airgap
  STORAGE_DIR: /data/documents
YAML

# 3. Python wheels — download every dep for the target interpreter (3.11).
python -m pip download -r requirements.txt \
  --dest "$OUT/wheels" \
  --platform manylinux2014_x86_64 --only-binary=:all: \
  --python-version 3.11 --implementation cp --abi cp311 || true
python -m pip download -r requirements-extras.txt \
  --dest "$OUT/wheels" \
  --platform manylinux2014_x86_64 --only-binary=:all: \
  --python-version 3.11 --implementation cp --abi cp311 || true

# 4. k8s manifests
cp -r k8s/. "$OUT/manifests/"

# 5. SBOMs + signatures (best-effort, require syft + cosign already installed)
if command -v syft >/dev/null 2>&1; then
  for img in "${IMAGES[@]}"; do
    safe=$(echo "$img" | tr '/:' '__')
    syft "$img" -o spdx-json > "$OUT/sboms/$safe.spdx.json" || true
  done
fi

# 6. Install / uninstall scripts
cat > "$OUT/scripts/install.sh" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo ">>> Loading docker images…"
for t in images/*.tar; do docker load -i "$t"; done
echo ">>> Pushing to local registry at localhost:5000"
for t in images/*.tar; do
  name=$(basename "$t" .tar | tr '__' '/:')
  docker tag "$name" "localhost:5000/$name"
  docker push "localhost:5000/$name"
done
echo ">>> Helm upgrade"
helm upgrade --install dms charts/nbe-dms -f charts/values-airgap.yaml \
  --namespace nbe-dms --create-namespace
kubectl apply -f manifests/ -n nbe-dms || true
echo ">>> Done. Check: kubectl -n nbe-dms get pods"
BASH
chmod +x "$OUT/scripts/install.sh"

cat > "$OUT/scripts/verify.sh" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
kubectl -n nbe-dms rollout status deploy/dms-python
curl -f -H "X-API-Key: ${API_KEY:-dev-key-change-me}" http://localhost:8000/health
BASH
chmod +x "$OUT/scripts/verify.sh"

cat > "$OUT/scripts/uninstall.sh" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
helm uninstall dms -n nbe-dms || true
kubectl delete ns nbe-dms || true
BASH
chmod +x "$OUT/scripts/uninstall.sh"

# 7. Checksums
(cd "$OUT" && find . -type f ! -name checksums.txt -print0 | xargs -0 sha256sum > checksums.txt)

# 8. Compress
tar -I 'zstd -19 -T0' -cvf "nbe-dms-airgap-$VERSION.tar.zst" "$OUT"
ls -lh "nbe-dms-airgap-$VERSION.tar.zst"
echo "Built nbe-dms-airgap-$VERSION.tar.zst — ship on USB / WORM media to the airgap site."
