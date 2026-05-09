# DMS Network — AWS Cost Calculator

## Quick Cost Reference

### Scenario 1: **Demo/POC** (Recommended — This Guide)
```
Single t3.micro EC2 + Docker Compose + RDS micro + S3

YEAR 1 (Free Tier):
  EC2 t3.micro ................... $0 ✅
  RDS db.t3.micro ................ $0 ✅
  S3 (5GB free tier) ............. $0 ✅
  Lambda (1M invokes free) ....... $0 ✅
  Data transfer (first 1GB) ...... $0 ✅
  Overages (100GB @ $0.09/GB) .... ~$5
  ─────────────────────────────────
  TOTAL/MONTH:             $5–10 💰

YEAR 2+ (Post Free-Tier):
  EC2 t3.micro ................... $12
  EBS 20GB gp3 ................... $2
  S3 (10GB usage) ................ $0.23
  Data transfer (100GB/mo) ....... $5
  CloudWatch logs ................ $3
  ─────────────────────────────────
  TOTAL/MONTH:             $22 💰
```

### Scenario 2: **Staging** (Higher Capacity)
```
2 × t3.small EC2 + RDS db.t3.small + ElastiCache t3.micro

YEAR 1 (Free Tier — partial):
  EC2 t3.small × 2 .............. $24 (not free)
  RDS db.t3.small ............... $0 ✅
  ElastiCache t3.micro .......... $24/1 node, $72/3 nodes
  S3 ............................ $0 ✅
  ─────────────────────────────────
  TOTAL/MONTH:             $25–50 💰

YEAR 2+:
  EC2 × 2 ....................... $24
  RDS db.t3.small (500GB) ....... $80
  ElastiCache (cluster) ......... $70
  S3 (50GB) ..................... $1.15
  Data transfer ................. $10
  ─────────────────────────────────
  TOTAL/MONTH:             $185 💰
```

### Scenario 3: **Production on EKS** (Original Proposal)
```
EKS Cluster: 3 × t3.large + RDS multi-AZ + MSK + OpenSearch

  EKS Cluster ................... $150 (1x control plane)
  EC2 Nodes (3 × t3.large) ...... $240
  RDS db.t3.large (1TB, multi-AZ) $500
  MSK (3 brokers, 1TB storage) .. $400
  OpenSearch (3 data nodes) ..... $300
  ElastiCache ................... $150
  ALB ........................... $20
  NAT Gateway × 2 ............... $60
  Data transfer ................. $100
  Other (CloudWatch, S3, etc) ... $100
  ─────────────────────────────────
  TOTAL/MONTH:             $2,020 💰
```

---

## Cost Breakdown by Service

| Service | Demo | Staging | Production |
|---------|------|---------|-----------|
| **Compute** | $12 (t3.micro) | $25 (2×t3.small) | $390 (EKS + 3×t3.large) |
| **Database** | $0–50 | $0–80 | $500 |
| **Caching** | $0 | $24–72 | $150 |
| **Event Bus** | $0 (embedded) | $0 (SQS) | $400 (MSK) |
| **Search** | $0 (Postgres FTS) | $0 (DynamoDB) | $300 (OpenSearch) |
| **Storage** | $0 (S3 free) | $1 | $50 |
| **Network** | $0 (Elastic IP) | $20 | $180 |
| **Observability** | $0–5 | $5–10 | $100 |
| **Total/Month** | **$12–22** | **$50–180** | **$2,000+** |

---

## Free Tier Timeline

### ✅ AWS Free Tier Eligibility (12 Months)

```
SERVICE              DEMO USAGE    FREE TIER       COST AFTER YR 1
─────────────────────────────────────────────────────────────────
EC2 t3.micro         ✅ 750h/mo    ✅ 750h/mo      $0.0104/hr → $12/mo
EBS                  ✅ 20GB       ✅ 30GB         $0.10/GB → $2/mo
RDS db.t3.micro      ✅ 1GB        ✅ 750h/mo      $0.018/hr → $50/mo
S3                   ✅ 5GB        ✅ 5GB + 20K    $0.023/GB
Lambda               ✅ 1M calls   ✅ 1M/mo        $0.20 per 1M after
DynamoDB             ✅ scan       ✅ 25 RCU/WCU   25 = $1.25/mo (perpetual)
CloudWatch           ✅ logs       ✅ 5GB/mo       $0.50/GB after
SQS                  ✅ events     ✅ 1M/mo free   $0.50 per 1M after
SNS                  ✅ email      ✅ 1M/mo free   $0.50 per 1M after
Data Transfer Out    ✅ first 1GB  ✅ 1GB/mo       $0.09/GB
─────────────────────────────────────────────────────────────────
TOTAL (Year 1):                    ~$5–15/month
TOTAL (Year 2+):                   ~$25–35/month
```

---

## Upgrade Path (as Usage Grows)

```
WEEK 1–4: Demo on t3.micro
├─ 1 instance, 1GB RAM
├─ All features work
└─ Cost: $5–15/mo

MONTH 2–3: Add High Availability
├─ Upgrade to 2 × t3.small
├─ Add RDS db.t3.small backup
├─ Enable multi-AZ
└─ Cost: $50–80/mo

MONTH 4–6: Prepare for Scale
├─ Add ElastiCache (Redis cluster)
├─ Switch to ECS on t3.medium
├─ Enable CloudWatch X-Ray tracing
└─ Cost: $150–200/mo

MONTH 7+: Production Ready
├─ Migrate to EKS (3 nodes)
├─ Add MSK Kafka (event bus)
├─ Add OpenSearch (full-text search)
├─ Enable WAF + CloudFront CDN
└─ Cost: $1,500–2,000/mo

Each step is backward compatible — NO CODE CHANGES.
```

---

## Money-Saving Tips

### 1. **Use Reserved Instances** (save 30–50%)
```
Instead of on-demand:
  t3.small on-demand:  $0.0208/hr = $152/mo
  t3.small 1-yr RI:    $0.0126/hr = $92/mo
  → Saves $60/month
```

### 2. **Turn Off When Not Demoing**
```bash
# Stop instance (keep data, pay for EBS only)
aws ec2 stop-instances --instance-ids i-xxx

# Savings: $12/mo (compute) but keep $2/mo (storage)
# Perfect for dev/staging!
```

### 3. **Use S3 Transfer Acceleration** (for large uploads)
```
Instead of:     $0.09/GB egress = expensive
With S3 TA:     $0.04/GB + $0.025/100k = $5–10/mo savings
```

### 4. **Compress Data in Transit**
```python
# gzip before S3 upload: saves 50–80% bandwidth
gzip doc.pdf  # 50MB → 10MB
# Saves $4/month per 100 docs
```

### 5. **Use AWS Compute Savings Plans**
```
1-year commitment: -20% off
3-year commitment: -40% off

3-year plan cost:
  EKS: $1,500/mo × 12 × 3 × 0.60 = $32,400 (vs. $54k on-demand)
  → Saves $21,600 over 3 years ($600/mo)
```

### 6. **Skip Managed Services, Self-Host**

| Managed | Cost/mo | Self-hosted | Cost/mo | Saves |
|---------|---------|-------------|---------|-------|
| RDS Postgres | $500 | EC2 + EBS | $30 | $470 |
| OpenSearch | $300 | Elasticsearch in EC2 | $50 | $250 |
| MSK Kafka | $400 | Kafka in EC2 | $80 | $320 |
| ElastiCache | $150 | Redis in Docker | $0 | $150 |
| **Total** | **$1,350** | | **$160** | **$1,190** |

**Tradeoff:** Less managed HA, you handle backups/updates (but demo doesn't need it!)

---

## Example: Scaling Scenarios

### Scenario A: "Ship POC in 2 weeks"
```
Initial:     t3.micro ($0)
Demo phase:  +load test → t3.small ($12/mo)
Customer review: 3 months @ $12–25/mo
Budget:      $25 × 3 = $75
```

### Scenario B: "Scale to 10 concurrent users"
```
Initial:     t3.micro ($0)
Month 3:     Add t3.small + RDS micro ($50/mo)
Month 6:     Upgrade to t3.large × 2 + RDS small ($150/mo)
Months 1–6: $0 + $0 + $0 + $50 + $50 + $150 = $250
```

### Scenario C: "Full enterprise deployment"
```
Dev:         t3.micro ($0 × 3 months)
Staging:     t3.small × 2 ($50/mo × 2 months)
Production:  EKS ($2,000/mo × 1 month)
Total:       $0 + $100 + $2,000 = $2,100
```

---

## Hidden Costs to Avoid

| Hidden Cost | Annual | How to Avoid |
|-------------|--------|-------------|
| **Data Transfer Out (DXO)** | $1,080 (12TB @ $0.09/GB) | Use CloudFront ($0.085/GB) or keep data in same region |
| **NAT Gateway** | $384 (2 × $32 × 6 months) | Use Elastic IP (free!) or VPC endpoints |
| **Unused Elastic IPs** | $360 (12 × $3/mo unattached) | Deallocate or attach to instance |
| **Leftover EBS snapshots** | $48 (10GB snapshot retention) | Delete old snapshots, use lifecycle policies |
| **CloudWatch Log Groups** (verbose) | $600 (10GB/mo @ $0.50/GB) | Use log retention, aggregate to S3 |
| **Load Balancer** (idle) | $240 (12 × $20/mo) | Use target groups efficiently |

---

## Billing Alerts (Set These Up Now!)

```bash
# CloudWatch Alarm: Alert if > $50/month
aws cloudwatch put-metric-alarm \
  --alarm-name DMS-Cost-Alert-50 \
  --alarm-description "Alert if DMS costs exceed $50/month" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 3600 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:xxx:cost-alerts
```

---

## Summary

| Duration | Scenario | Setup Cost | Monthly | Total |
|----------|----------|-----------|---------|-------|
| **2 weeks** | Demo PoC | Free | $5 | $5 |
| **3 months** | Staging | Free | $25 | $75 |
| **6 months** | Scale | Free | $100 | $600 |
| **12 months** | Year-1 Production | Free | $2,000 | $24,000 |

**Bottom line:** Start at **$5–10/month**, scale to **$100–500/month**, and reach production at **$1,500–3,000/month** only when you're ready.

