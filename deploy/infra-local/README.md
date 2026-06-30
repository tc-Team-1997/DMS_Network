# ZorDMS — local infra harness (MinIO · Kafka · Vault)

Stands up the three **optional** backends ZorDMS can use, so you can exercise
their code paths end-to-end on a laptop:

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| **MinIO** | `minio/minio` | `9000` API, `9001` console | S3-compatible object storage (`STORAGE_DRIVER=s3`) |
| **Kafka** | `bitnami/kafka` (KRaft) | `9092` | event bus (`EVENT_BUS=kafka`) |
| **Vault** | `hashicorp/vault` (dev) | `8200` | secrets (`VAULT_ADDR`) |

> **DEV ONLY.** No auth/TLS hardening, fixed dev credentials, Vault runs in
> in-memory `-dev` mode (unsealed, root token). Never use this compose file in
> any shared/UAT/prod environment.

Every ZorDMS provider **degrades gracefully** if its service is down — S3 falls
back to local disk, Kafka falls back to Redis Streams, Vault falls back to env.
So this stack is entirely optional; it just lets you validate the real paths.

---

## 1. Start the stack

```bash
docker compose -f deploy/infra-local/docker-compose.yml up -d
```

A one-shot `bootstrap` container then:
- creates the MinIO bucket **`zordms-documents`**, and
- seeds a Vault secret at **`secret/zordms`** (`JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`).

Kafka auto-creates topics on first publish, so no topic step is needed.

Validate the compose file without starting anything:

```bash
docker compose -f deploy/infra-local/docker-compose.yml config -q && echo OK
```

## 2. Point core at it

Install the optional peers once (only needed to use these paths):

```bash
pnpm --filter @zordms/core add @aws-sdk/s3-request-presigner kafkajs
```

Then set the env (e.g. in your root `.env`) and restart:

```bash
# Object storage
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=zordms-documents
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

# Event bus
EVENT_BUS=kafka
KAFKA_BROKERS=localhost:9092
KAFKA_TOPIC=zordms.events

# Secrets
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=zordms-dev-root
VAULT_KV_MOUNT=secret
VAULT_SECRET_PATH=zordms
```

```bash
./restart.sh
```

## 3. Verify

```bash
# MinIO: console at http://localhost:9001 (minioadmin / minioadmin)
# Upload a document via the app, then confirm the object landed:
#   mc alias set local http://localhost:9000 minioadmin minioadmin
#   mc ls --recursive local/zordms-documents
# A document download now 302-redirects to a presigned MinIO URL.

# Kafka: tail the events topic
docker exec zordms-kafka kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic zordms.events --from-beginning

# Vault: read the seeded secret
curl -s --header "X-Vault-Token: zordms-dev-root" \
  http://localhost:8200/v1/secret/data/zordms | jq .data.data
```

## 4. Tear down

```bash
docker compose -f deploy/infra-local/docker-compose.yml down        # keep data
docker compose -f deploy/infra-local/docker-compose.yml down -v     # wipe volumes
```
