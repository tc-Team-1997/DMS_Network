# DMS Network — Quick Demo Setup Guide

## 🚀 Get Started in 30 Minutes

### Option A: **Local Demo** (No AWS Cost, Your Machine)

Perfect for: Quick feature testing, demos to investors, local development

```bash
# 1. Clone or navigate to repo
cd /path/to/DMS_Network

# 2. Start the full stack
docker-compose -f docker-compose.prod-demo.yml up

# 3. Open in browser
open http://localhost:3000

# 4. Login with demo credentials
# Username: admin
# Password: admin123

# 5. Check Python API
open http://localhost:8000/docs

# 6. Admin tools (optional)
open http://localhost:8081  # Database (Adminer)
open http://localhost:8082  # Kafka UI
```

**Costs:** $0 (runs on your laptop)
**Performance:** Limited by your machine's CPU/RAM
**Best for:** Development & testing

---

### Option B: **AWS Demo** (t3.micro, ~$5–10/month Year 1)

Perfect for: Remote demo, investor showcase, accessible 24/7

#### Prerequisites
- AWS account (create free tier at https://aws.amazon.com/free/)
- AWS CLI installed: `brew install awscli`
- Keypair created in AWS (or script will create it)

#### Step 1: Prepare Your Domain (5 min)
```bash
# Get an Elastic IP from AWS
# Point your domain (e.g., nbe-demo.com) to this IP via Route53

# Or use AWS nameservers:
# In Route53, create hosted zone for nbe-demo.com
# Get nameserver IPs from Route53
# Update your domain registrar's nameserver settings
```

#### Step 2: Deploy (15 min)
```bash
cd /path/to/DMS_Network

# Run deployment script
./deploy-to-ec2-demo.sh \
  --key-name my-aws-key \
  --domain nbe-demo.com \
  --region eu-west-1

# Script will:
# ✅ Create/use EC2 keypair
# ✅ Launch t3.micro instance (free tier)
# ✅ Allocate Elastic IP (free while attached)
# ✅ Install Docker + Docker Compose
# ✅ Clone repo and start stack
# ✅ Output IP address & access URLs
```

#### Step 3: Enable HTTPS (5 min)
```bash
# SSH into instance
ssh -i my-aws-key.pem ec2-user@<ELASTIC_IP>

# Install Certbot
sudo yum install -y certbot

# Get certificate (free from Let's Encrypt)
sudo certbot certonly --standalone -d nbe-demo.com

# Certificates auto-renew via cron
```

#### Step 4: Access Your Demo
```
Web UI:         https://nbe-demo.com:3000
Python API:     https://nbe-demo.com:8000/docs
Database UI:    https://nbe-demo.com:8081
Kafka UI:       https://nbe-demo.com:8082
```

**Costs:** 
- Year 1: **~$5–10/month** (free tier)
- Year 2+: **~$22/month**
- Can stop instance: **$0/month** (but keeps $2/month EBS storage)

**Uptime:** 24/7 availability
**Best for:** Production demos, investor presentations

---

## 📊 Feature Checklist

All these features work in both local and AWS demo:

- [x] **Multi-tenant document repository** — S3 or local disk
- [x] **Web UI** — Node.js Express + HTML forms
- [x] **REST API** — FastAPI Python service
- [x] **OCR** — Tesseract (local) or AWS Textract (serverless)
- [x] **Full-text search** — PostgreSQL FTS
- [x] **Workflows** — BPMN simulation (simplified)
- [x] **RBAC** — Role-based access (Doc Admin / Maker / Checker / Viewer)
- [x] **Audit logs** — Database + JSON export
- [x] **Real-time updates** — WebSocket server
- [x] **Duplicate detection** — SHA-256 + pHash
- [x] **Mobile app** — Expo React Native (connects to API)
- [x] **Event streaming** — Kafka (embedded in Docker)
- [x] **Caching** — Redis (sessions & query cache)
- [x] **Authentication** — JWT + session cookies
- [x] **Data export** — ZIP downloads
- [x] **Compliance** — Audit trail, retention policies

---

## 🎬 Demo Script (2 Hours)

### Setup (10 min)
1. Deploy using Option A or B above
2. Login with `admin / admin123`
3. Show the admin dashboard

### Core Demo (50 min)

#### 1. Document Upload (5 min)
```
Action: Upload PDF (Invoice_2026.pdf)
Show: Upload progress, file in repository
Assert: File in DB, stored on S3 or disk
```

#### 2. OCR Processing (10 min)
```
Action: Open document → View OCR tab
Show: Live tesseract running, extracting text
Assert: Searchable text extracted
```

#### 3. AI Classification (5 min)
```
Action: View AI classification results
Show: Document tagged as "Invoice", confidence 95%
Assert: Metadata enriched with AI tags
```

#### 4. Full-Text Search (5 min)
```
Action: Search for "Invoice 2026"
Show: Results appear instantly
Assert: FTS working with OCR text
```

#### 5. Workflow (15 min)
```
Action: Create workflow: Maker → Checker → Approved
Step 1: Login as Maker
  - Upload doc "Payment Slip"
  - Mark as "Ready for review"
  - Logout

Step 2: Login as Checker
  - View pending documents
  - Review "Payment Slip"
  - Click "Approve"
  - Logout

Step 3: Login as Admin
  - View audit log
  - Show all steps recorded with timestamps
```

#### 6. API Demo (5 min)
```bash
# Show Python API at /docs
curl -H "X-API-Key: dev-key-demo" \
  https://nbe-demo.com:8000/api/v1/documents

# Response: JSON list of all documents
```

#### 7. Export & Compliance (5 min)
```
Action: Export documents as ZIP
Show: All files + audit log + metadata
Download and show contents
Assert: WORM compliance (can't modify)
```

### Q&A (10 min)
- Scalability: "Moves to EKS with zero code changes"
- Security: "End-to-end encryption, audit logs, OPA policies"
- Cost: "Demo costs $5–10/month; production is $2,000+/month but includes SLA"
- Integration: "Adapters for Temenos, FLEXCUBE, Finastra, Salesforce"

---

## 🛑 Cleanup (Avoid Unnecessary Charges)

### Stop Instance (Keeps Data, Saves $12/month)
```bash
aws ec2 stop-instances --instance-ids i-xxx --region eu-west-1
# Later: aws ec2 start-instances --instance-ids i-xxx --region eu-west-1
```

### Terminate Completely (Delete Everything)
```bash
INSTANCE_ID="i-xxx"
ALLOC_ID="eipalloc-xxx"
REGION="eu-west-1"

# Terminate instance
aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION

# Release Elastic IP
aws ec2 release-address --allocation-id $ALLOC_ID --region $REGION

# Delete security group
aws ec2 delete-security-group --group-name nbe-dms-demo-sg --region $REGION
```

### Monitor Costs (Real-time)
```bash
# See current month spending
aws ce get-cost-and-usage \
  --time-period Start=2026-04-01,End=2026-04-19 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE

# Set billing alert
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget BudgetName=DMS-Demo,BudgetLimit=Amount=50,Unit=USD
```

---

## 📚 Documentation Files Created

| File | Purpose |
|------|---------|
| `docs/AWS_COST_OPTIMIZED_DEMO.md` | Complete AWS setup guide (this doc) |
| `docs/AWS_COST_CALCULATOR.md` | Detailed cost breakdown & comparison |
| `docker-compose.prod-demo.yml` | Production-ready Docker Compose (all services) |
| `deploy-to-ec2-demo.sh` | One-command AWS deployment script |
| This file | Quick start guide |

---

## ❓ FAQ

### Q: Will AWS charge me after the free tier?
**A:** Yes. After 12 months, you'll pay:
- **Year 1 (Free):** $5–10/month
- **Year 2+:** $22/month for t3.micro demo
- To save: `aws ec2 stop-instances` (keeps data, costs only $2/mo for storage)

### Q: Can I use this for production?
**A:** t3.micro is **not recommended for production**. Use it for:
- ✅ Demos & POCs
- ✅ Development & testing
- ✅ Investor presentations

For production, upgrade to EKS (3 nodes) = ~$2,000/month

### Q: How do I upgrade to production without downtime?
**A:** Zero code changes! Just:
1. Deploy to EKS cluster (parallel stack)
2. Point DNS to new ALB
3. Stop old EC2 instance
No data loss, no rewrite.

### Q: Can I run this locally instead?
**A:** Yes! Use `docker-compose -f docker-compose.prod-demo.yml up`
Costs: $0 (but limited by your machine's CPU/RAM)

### Q: How long does deployment take?
**A:** 
- Local: 5 minutes
- AWS: 15 minutes (automated)

### Q: What if I need more features (Kafka, Elasticsearch, etc.)?
**A:** They're already in the code! This demo includes everything—just runs on one machine. Scale whenever needed.

### Q: Is this multi-tenant?
**A:** Yes! Internally designed for multi-tenant. Configure at runtime via `X-Tenant-ID` header. Demo uses single tenant.

---

## 🔗 Useful Links

- [AWS Free Tier](https://aws.amazon.com/free/) — Sign up
- [AWS Console](https://console.aws.amazon.com/) — Manage instances
- [AWS CLI Reference](https://docs.aws.amazon.com/cli/) — Commands
- [DMS Network Docs](../docs/ARCHITECTURE.md) — Full tech details
- [Cost Calculator](./AWS_COST_CALCULATOR.md) — Detailed pricing

---

## ✅ Pre-Flight Checklist

Before you run the demo:

- [ ] AWS account created & free tier eligible
- [ ] AWS CLI installed: `aws --version`
- [ ] Domain registered (or use subdomain of existing domain)
- [ ] DNS provider access (Route53 or third-party)
- [ ] 15 minutes of free time
- [ ] Internet connection (for deployment)

**Ready? Let's go!**

```bash
./deploy-to-ec2-demo.sh --key-name my-key --domain nbe-demo.com
```

