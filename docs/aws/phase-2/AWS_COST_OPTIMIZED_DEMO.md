# AWS Cost-Optimized Demo Setup

> **Goal:** Ship a fully-featured POC for ~$0–$100/month instead of $1,500+

---

## Option 1: Serverless-First (Recommended for Demo)

### Architecture
```
Single EC2 t3.micro (free tier) runs Node + Python containerized
                ↓
        Single RDS db.t3.micro (free)
                ↓
        S3 (free tier 5GB + 20K PUTs/month)
                ↓
        DynamoDB (free tier: 25GB storage, 25 RCU/WCU)
                ↓
        Lambda + EventBridge for async OCR/AI
                ↓
        CloudWatch logs (free tier: 5GB/month)
```

### Monthly Cost Breakdown

| Service | Config | Free Tier? | Cost |
|---------|--------|-----------|------|
| **EC2** | t3.micro (1 vCPU, 1GB RAM) | ✅ 12mo | **$0** |
| **RDS** | db.t3.micro (1GB storage) | ✅ 12mo | **$0** |
| **S3** | 5GB storage + 20K PUTs | ✅ 12mo | **$0** |
| **DynamoDB** | 25GB, on-demand | ✅ Perpetual | **$0–5** |
| **Lambda** | OCR: 1M invocations/mo | ✅ 12mo | **$0** |
| **EventBridge** | 1.4B events/mo free | ✅ 12mo | **$0** |
| **CloudWatch** | 5GB logs + metrics | ✅ 12mo | **$0–5** |
| **Data Transfer** | 100GB/mo egress | ❌ | **$5–10** |
| **NAT Gateway** | 1 (for EC2 outbound) | ❌ | **$32/mo** |
| **Elastic IP** | 1 (if used) | ✅ While attached | **$0** |
| | | **Total (Months 1–12)** | **~$5–15** |
| | | **Total (Month 13+)** | **~$50–70** |

### ✅ What You Get
- ✅ Full Node + Python stack running
- ✅ Multi-tenant document repo (S3)
- ✅ Database with encryption
- ✅ Async OCR (Lambda + EventBridge)
- ✅ All REST APIs working
- ✅ Full-text search (DynamoDB or Postgres FTS)
- ✅ Real-time notifications (Lambda → SNS)
- ✅ Workflow engine (local or Step Functions free tier)

---

## Option 2: Single EC2 + Docker Compose (Absolute Cheapest)

### Architecture
```
Single t3.micro EC2 instance (free)
        ↓
    Docker Compose:
    ├─ Node.js server (port 3000)
    ├─ Python FastAPI (port 8000)
    ├─ PostgreSQL (SQLite alternative for demo)
    ├─ Redis (for sessions/cache)
    ├─ Kafka (lightweight, embedded)
    └─ All on 1GB RAM + 20GB EBS
```

### Monthly Cost (First 12 Months)

| Service | Config | Cost |
|---------|--------|------|
| EC2 | t3.micro (free tier) | **$0** |
| EBS | 20GB gp3 (free: 30GB) | **$0** |
| Data transfer | ~50GB/mo | **$5** |
| NAT Gateway | (avoid with Elastic IP) | **$0** |
| **Total** | | **$5–10/month** |

**After year 1:**
- EC2 t3.micro off-demand: ~$12/month
- EBS: ~$2/month
- Data transfer: ~$5/month
- **Total: ~$19–25/month**

### Docker Compose File (works as-is)

```yaml
# docker-compose.prod-demo.yml
version: '3.8'
services:
  node:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://dms:demo123@postgres:5432/nbe_dms
      PYTHON_SERVICE_URL: http://python:8000
      STORAGE_DIR: /mnt/uploads
      REDIS_URL: redis://redis:6379
    volumes:
      - ./uploads:/mnt/uploads
      - ./db:/app/db
    depends_on:
      - postgres
      - redis
    networks:
      - dms

  python:
    build: ./python-service
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+asyncpg://dms:demo123@postgres:5432/nbe_dms
      STORAGE_DIR: /app/storage
      REDIS_URL: redis://redis:6379
      KAFKA_BROKERS: kafka:9092
    volumes:
      - ./python-service/storage:/app/storage
    depends_on:
      - postgres
      - kafka
    networks:
      - dms

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: dms
      POSTGRES_PASSWORD: demo123
      POSTGRES_DB: nbe_dms
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    networks:
      - dms

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    networks:
      - dms

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    depends_on:
      - zookeeper
    networks:
      - dms

  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    networks:
      - dms

volumes:
  postgres_data:
  redis_data:

networks:
  dms:
```

### Deploy to EC2 (5 min setup)

```bash
#!/bin/bash
# 1. Launch EC2 t3.micro (free tier, Amazon Linux 2 or Ubuntu 22.04)
# 2. SSH in
ssh -i my-key.pem ec2-user@<EC2_PUBLIC_IP>

# 3. Install Docker + Docker Compose
sudo yum update -y
sudo yum install -y docker
sudo usermod -aG docker $USER
sudo systemctl start docker

sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. Clone repo
git clone https://github.com/your-org/DMS_Network.git
cd DMS_Network

# 5. Start stack
docker-compose -f docker-compose.prod-demo.yml up -d

# 6. Create Elastic IP + point DNS
aws ec2 allocate-address --domain vpc
# Point nbe-demo.com to the Elastic IP (no NAT charges!)

# 7. Add HTTPS via Certbot in EC2
sudo yum install -y certbot
sudo certbot certonly --standalone -d nbe-demo.com
# Auto-renew with cron

echo "✅ Demo running at https://nbe-demo.com"
```

---

## Option 3: Hybrid (Best Balance)

### Architecture
```
2 × t3.small EC2 (1 for Node, 1 for Python) = ~$25/mo
       ↓
RDS db.t3.micro (free year 1, ~$50/mo after) = $0 / $50
       ↓
S3 bucket (5GB free tier) = $0 / $10
       ↓
LocalStack for DynamoDB/SQS testing (runs in EC2) = $0
       ↓
Lambda for async OCR (free tier) = $0
```

| Period | EC2 | RDS | S3 | Other | Total |
|--------|-----|-----|----|----|-------|
| **Months 1–12** | $25 | $0 | $0 | $5 | **$30–40** |
| **Month 13+** | $25 | $50 | $10 | $5 | **$90–100** |

---

## Quick Wins: Cut Costs Further

### 1. **Skip NAT Gateway** → Use Elastic IP (~$32/mo saved)
```hcl
# In Terraform: don't create a NAT; use Elastic IP on EC2
resource "aws_eip" "node" {
  instance = aws_instance.node.id
  domain   = "vpc"
  tags     = { Name = "nbe-demo-eip" }
}
# Cost: $0 while attached to running instance
```

### 2. **Skip Managed Kafka** → Use Lightweight Job Queue
```python
# Instead of MSK, use SQS FIFO (free tier-eligible)
import boto3
sqs = boto3.client('sqs')

# For async OCR, Lambda + SQS
sqs.send_message(
    QueueUrl='https://sqs.eu-west-1.amazonaws.com/123/ocr-queue.fifo',
    MessageBody=json.dumps({'doc_id': 'xxx'})
)
# Free tier: 1M requests/month
```

### 3. **Use DynamoDB Instead of OpenSearch**
```python
# DynamoDB free tier: 25 RCU + 25 WCU, 25GB storage perpetually
# Skip $400/mo OpenSearch
import boto3
ddb = boto3.resource('dynamodb')
table = ddb.Table('documents')

# Scan with FilterExpression for FTS
response = table.scan(
    FilterExpression='contains(ocr_text, :query)',
    ExpressionAttributeValues={':query': 'invoice'}
)
```

### 4. **Self-Hosted Redis in EC2** → Skip ElastiCache (~$100/mo saved)
```bash
# Redis runs alongside Node/Python in Docker Compose
# Cost: $0 (included in EC2 CPU)
```

### 5. **Use AWS Textract (Serverless OCR)** → Skip GPU workers
```python
# Pay per page (~$0.015/page), NOT $400/mo for always-on GPU
import boto3
textract = boto3.client('textract')

response = textract.detect_document_text(Document={'S3Object': {...}})
# 1000 pages/month = $15 (free tier sometimes available)
```

### 6. **Consolidate to Single EC2 (t3.small)**
```
Instead of 2 × t3.small ($50/mo):
  → 1 × t3.small ($12/mo) running Node + Python
```

---

## 🎯 Recommended Demo Setup (Best for Shipping Features Fast)

### **Option: Single EC2 t3.micro + Docker Compose + S3 + RDS micro**

```
┌─────────────────────────────────────────┐
│  EC2 t3.micro (free tier, 1 year)       │
│  ├─ Node.js (port 3000)                 │
│  ├─ Python FastAPI (port 8000)          │
│  ├─ PostgreSQL 15 (1GB, via container)  │
│  ├─ Redis 7 (in-memory, via container)  │
│  └─ Kafka (lightweight, for events)     │
│                                          │
│  + Elastic IP (free while attached)     │
│                                          │
├─ S3 (free tier: 5GB + 20K PUTs)         │
├─ RDS Postgres db.t3.micro (free year 1)│  ← optional: if you want managed DB
└─ Lambda (free tier: 1M invokes/mo)      │  ← for serverless OCR
```

### **Exact Monthly Costs**

#### **Year 1 (Free Tier)**
```
EC2 t3.micro:       $0
EBS 20GB:           $0 (free tier: 30GB)
Elastic IP:         $0 (free while running)
S3:                 $0 (free tier: 5GB)
RDS db.t3.micro:    $0 (free tier, optional)
Lambda:             $0 (free tier: 1M invokes)
Data transfer out:  $5 (charged after 1GB/mo)
CloudWatch logs:    $0 (free tier: 5GB)
────────────────────────
TOTAL MONTH 1–12:   $5–10/month
```

#### **Year 2+ (Post Free-Tier)**
```
EC2 t3.micro:       $12  (off-demand)
EBS 20GB gp3:       $2
Data transfer out:  $5
Elastic IP:         $0 (free while attached)
S3:                 $0 (small usage)
RDS db.t3.micro:    $0 (skip; keep in-container Postgres)
Lambda:             $0 (low usage)
CloudWatch:         $3
────────────────────────
TOTAL MONTH 13+:    $22/month
```

---

## 📋 Launch Steps (30 min total)

### 1. Create AWS Free Tier Account
```bash
# Go to https://aws.amazon.com/free/
# Sign up → Verify email → Add payment method
# Set up billing alerts (CloudWatch)
```

### 2. Launch EC2 Instance
```bash
# Via AWS Console or CLI
aws ec2 run-instances \
  --image-ids ami-0c55b159cbfafe1f0 \  # Amazon Linux 2
  --instance-type t3.micro \
  --key-name my-key \
  --security-groups default \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=nbe-demo}]'

# Allocate Elastic IP (free!)
aws ec2 allocate-address --domain vpc --output text | awk '{print $1}' > eip-id.txt
aws ec2 associate-address --instance-id <INSTANCE_ID> --allocation-id $(cat eip-id.txt)
```

### 3. SSH In & Install Docker
```bash
ssh -i my-key.pem ec2-user@<ELASTIC_IP>

sudo yum update -y && sudo yum install -y docker git
sudo systemctl start docker && sudo usermod -aG docker $USER

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-Linux-x86_64" \
  -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose
```

### 4. Clone & Start Stack
```bash
git clone https://github.com/your-org/DMS_Network.git
cd DMS_Network
docker-compose -f docker-compose.prod-demo.yml up -d

# Verify
curl http://localhost:3000  # Node app
curl http://localhost:8000/docs  # Python Swagger
```

### 5. Point DNS
```bash
# In Route53 or your DNS provider:
# A record: nbe-demo.com → <ELASTIC_IP>
# Wait 5 min for propagation

curl https://nbe-demo.com  # ✅
```

### 6. Enable HTTPS (Free via Certbot)
```bash
sudo yum install -y certbot nginx

# Or use Let's Encrypt in EC2 directly
sudo certbot certonly --standalone -d nbe-demo.com
# Certificate renewed automatically via cron
```

---

## 🚀 What Works at This Cost

| Feature | Status | Notes |
|---------|--------|-------|
| **Multi-tenant document repo** | ✅ | S3 or local EBS |
| **Web UI (Node Express)** | ✅ | Runs in container |
| **API Gateway (Python FastAPI)** | ✅ | Full /api/v1/* surface |
| **Full-text search** | ✅ | Postgres FTS or DynamoDB scan |
| **OCR (Tesseract)** | ✅ | Local or Lambda Textract |
| **Workflows (Temporal/Zeebe)** | ⚠️ | Simplified local scheduler |
| **Real-time notifications** | ✅ | SNS/SQS (free tier) |
| **Mobile app (Expo)** | ✅ | Connects to /api/v1 |
| **RBAC** | ✅ | Built-in |
| **Audit logs** | ✅ | DynamoDB or Postgres |
| **Duplicate detection** | ✅ | SHA-256 + pHash |
| **Vector search (RAG)** | ⚠️ | Use pgvector in Postgres (free) |
| **Compliance reports** | ✅ | Lambda functions (free) |

---

## Cost Comparison Matrix

| Tier | Compute | Database | Storage | Events | Total Year 1 | Total Year 2 |
|------|---------|----------|---------|--------|--------------|-------------|
| **Serverless** (this guide) | EC2 free | RDS free | S3 free | Lambda free | **$60–120** | **$270–350** |
| **Managed K8s** (Option 1) | EKS $150 | RDS $200 | S3 $50 | MSK $400 | **$1,800** | **$1,800** |
| **Full SaaS** (prod-ready) | ECS $300 | RDS $500 | S3 $100 | Lambda $200 | **$3,600** | **$3,600** |

---

## ⚠️ Limitations (Know Before You Ship)

| Limitation | Workaround |
|-----------|-----------|
| t3.micro: 1 vCPU, 1GB RAM (tight) | Upgrade to t3.small ($12/mo) for room |
| Single AZ (not HA) | Add second instance + load balancer ($30/mo more) |
| Local Postgres in container (no managed backup) | Use RDS db.t3.micro (free year 1) |
| No auto-scaling | Manual: stop/start or scale instance size |
| 100GB/mo free egress → overages $0.09/GB | Use CloudFront ($0.085/GB cheaper) |

---

## 🎬 Demo Script (2 Hours)

```bash
# Terminal 1: Start stack
docker-compose -f docker-compose.prod-demo.yml up

# Terminal 2: Run demo
# 1. Login: nbe-demo.com/login (admin/admin123)
# 2. Upload doc: "Invoice_2026.pdf"
# 3. Watch OCR: Document→OCR Text (live Tesseract)
# 4. Classify: "Invoice" tag applied (AI)
# 5. Workflow: Maker→Checker→Approved (RBAC)
# 6. Search: "Invoice 2026" → FTS results
# 7. Export: ZIP download via S3
# 8. Mobile: Scan with Expo app, auto-upload
# 9. API: curl https://nbe-demo.com/api/v1/documents
# 10. Audit: View all actions in admin panel

# Show costs: aws ce get-cost-and-usage ...
```

---

## Next: Production Migration

Once demo is approved, scale to:
- **Month 13**: Add second EC2 (HA) + RDS multi-AZ → ~$100/mo
- **Month 15**: Migrate to EKS (1 cluster, 3 nodes) → ~$300/mo
- **Month 18**: Add MSK Kafka → ~$700/mo
- **Month 24**: Full multi-region SaaS → ~$2,000/mo

**Each step is backward-compatible; no code changes needed.**

