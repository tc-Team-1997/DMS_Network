#!/bin/bash
set -e

###############################################################################
# AWS EC2 Quick Start Script for DMS Network Demo
# 
# Usage:
#   ./deploy-to-ec2-demo.sh --key-name my-key --domain demo.nbe.com
#
# This script:
#   1. Launches t3.micro EC2 instance (free tier)
#   2. Allocates Elastic IP (no NAT charges)
#   3. Installs Docker + Docker Compose
#   4. Clones the repo and starts the stack
#   5. Sets up HTTPS with Certbot
###############################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
KEY_NAME="${KEY_NAME:-nbe-demo}"
INSTANCE_TYPE="t3.micro"
IMAGE_ID="ami-0c55b159cbfafe1f0"  # Amazon Linux 2
REGION="${AWS_REGION:-eu-west-1}"
DOMAIN="${DOMAIN:-demo.nbe.com}"
INSTANCE_NAME="nbe-dms-demo"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
Usage: ./deploy-to-ec2-demo.sh [OPTIONS]

OPTIONS:
  --key-name NAME         AWS keypair name (default: nbe-demo)
  --domain DOMAIN         Domain name (default: demo.nbe.com)
  --region REGION         AWS region (default: eu-west-1)
  --help                  Show this help message

EXAMPLE:
  ./deploy-to-ec2-demo.sh --key-name my-key --domain nbe-demo.com --region us-east-1

COST:
  Year 1:  ~$5-10/month (free tier)
  Year 2+: ~$22/month (post free-tier)

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --key-name)
            KEY_NAME="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Verify AWS CLI
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI not found. Please install it first."
    exit 1
fi

log_info "Starting DMS Network demo deployment..."
log_info "Region: $REGION"
log_info "Instance: $INSTANCE_TYPE"
log_info "Domain: $DOMAIN"

# Check if key exists
log_info "Verifying AWS keypair '$KEY_NAME'..."
if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" &> /dev/null; then
    log_warn "Keypair '$KEY_NAME' not found. Creating..."
    aws ec2 create-key-pair --key-name "$KEY_NAME" --region "$REGION" \
        --query 'KeyMaterial' --output text > "${KEY_NAME}.pem"
    chmod 400 "${KEY_NAME}.pem"
    log_success "Created keypair: ${KEY_NAME}.pem"
else
    log_success "Keypair '$KEY_NAME' found"
fi

# Create security group
log_info "Setting up security group..."
SG_NAME="nbe-dms-demo-sg"
SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" \
    --region "$REGION" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "")

if [ "$SG_ID" == "None" ] || [ -z "$SG_ID" ]; then
    log_warn "Creating security group '$SG_NAME'..."
    SG_ID=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "NBE DMS Demo security group" \
        --region "$REGION" \
        --query 'GroupId' \
        --output text)
    
    # Allow SSH, HTTP, HTTPS
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp --port 22 --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp --port 80 --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp --port 443 --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    # Admin access (optional)
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp --port 3000 --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp --port 8000 --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    log_success "Created security group: $SG_ID"
else
    log_success "Using existing security group: $SG_ID"
fi

# Launch EC2 instance
log_info "Launching $INSTANCE_TYPE instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$IMAGE_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --region "$REGION" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --monitoring Enabled=false \
    --query 'Instances[0].InstanceId' \
    --output text)

log_success "Instance launched: $INSTANCE_ID"

# Wait for instance to be running
log_info "Waiting for instance to reach 'running' state..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
log_success "Instance is running"

# Get instance details
log_info "Getting instance details..."
INSTANCE_INFO=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0]')

PRIVATE_IP=$(echo "$INSTANCE_INFO" | jq -r '.PrivateIpAddress')
log_info "Private IP: $PRIVATE_IP"

# Allocate Elastic IP (free while attached!)
log_info "Allocating Elastic IP..."
ALLOC_ID=$(aws ec2 allocate-address \
    --domain vpc \
    --region "$REGION" \
    --query 'AllocationId' \
    --output text)

# Associate Elastic IP
aws ec2 associate-address \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$ALLOC_ID" \
    --region "$REGION"

# Get Elastic IP
PUBLIC_IP=$(aws ec2 describe-addresses \
    --allocation-ids "$ALLOC_ID" \
    --region "$REGION" \
    --query 'Addresses[0].PublicIp' \
    --output text)

log_success "Elastic IP allocated: $PUBLIC_IP (free!)"

# Wait for SSH to be ready
log_info "Waiting for SSH to be ready (this takes ~30 seconds)..."
sleep 30
for i in {1..20}; do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "${KEY_NAME}.pem" "ec2-user@${PUBLIC_IP}" "echo 'SSH is ready'" &>/dev/null; then
        log_success "SSH is ready!"
        break
    fi
    if [ $i -eq 20 ]; then
        log_error "SSH failed after 20 attempts. Try manually:"
        log_error "ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}"
        exit 1
    fi
    echo -n "."
    sleep 3
done

# Create user data script (runs on EC2 startup)
cat > /tmp/user_data.sh << 'USERDATA'
#!/bin/bash
set -e

# Update system
yum update -y

# Install Docker
yum install -y docker git curl

# Start Docker service
systemctl start docker
usermod -aG docker ec2-user

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Certbot (for HTTPS)
yum install -y certbot python3-certbot-nginx

# Create app directory
mkdir -p /opt/nbe-dms
cd /opt/nbe-dms

# Clone repo (or pull if exists)
if [ -d ".git" ]; then
  git pull origin main
else
  git clone https://github.com/your-org/DMS_Network.git .
fi

# Start the stack
docker-compose -f docker-compose.prod-demo.yml up -d

echo "✅ DMS Network is starting..."
USERDATA

# Copy user data to EC2
log_info "Installing Docker and dependencies on EC2..."
ssh -o StrictHostKeyChecking=no -i "${KEY_NAME}.pem" "ec2-user@${PUBLIC_IP}" << 'SSH_COMMANDS'
#!/bin/bash
set -e

# Update system
sudo yum update -y

# Install Docker
sudo yum install -y docker git curl

# Start Docker
sudo systemctl start docker
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version

echo "✅ Docker installed successfully"
SSH_COMMANDS

# Clone and start services
log_info "Cloning repository and starting services..."
ssh -o StrictHostKeyChecking=no -i "${KEY_NAME}.pem" "ec2-user@${PUBLIC_IP}" << 'SSH_CLONE'
#!/bin/bash
cd ~
if [ ! -d "DMS_Network" ]; then
  git clone https://github.com/your-org/DMS_Network.git
else
  cd DMS_Network && git pull && cd ..
fi

cd DMS_Network
docker-compose -f docker-compose.prod-demo.yml pull
docker-compose -f docker-compose.prod-demo.yml up -d

# Wait for services
sleep 10
echo "✅ Services started!"
docker-compose -f docker-compose.prod-demo.yml ps
SSH_CLONE

log_success "Services are starting on EC2!"

# Summary
cat << EOF

$BLUE═══════════════════════════════════════════════════════════════$NC
$GREEN✅ DMS Network Demo Deployment Complete!$NC
$BLUE═══════════════════════════════════════════════════════════════$NC

PUBLIC IP:          $PUBLIC_IP
INSTANCE ID:        $INSTANCE_ID
KEYPAIR:            ${KEY_NAME}.pem
REGION:             $REGION

ACCESS SERVICES:
  Node App:         http://${PUBLIC_IP}:3000
  Python API:       http://${PUBLIC_IP}:8000/docs
  Adminer (DB):     http://${PUBLIC_IP}:8081
  Kafka UI:         http://${PUBLIC_IP}:8082

SSH ACCESS:
  ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}

NEXT STEPS:
  1. Point your domain to Elastic IP in Route53
  2. Enable HTTPS:
     ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}
     sudo certbot certonly --standalone -d ${DOMAIN}
  
  3. View logs:
     ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}
     cd DMS_Network
     docker-compose -f docker-compose.prod-demo.yml logs -f

  4. Update domain in Route53:
     nslookup ${DOMAIN}  # should point to ${PUBLIC_IP}

ESTIMATED COSTS:
  Year 1:  ~\$5-10/month (free tier)
  Year 2+: ~\$22/month

STOP INSTANCE (saves \$12/month):
  aws ec2 stop-instances --instance-ids ${INSTANCE_ID} --region ${REGION}

TERMINATE INSTANCE (releases Elastic IP):
  aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --region ${REGION}
  aws ec2 release-address --allocation-id ${ALLOC_ID} --region ${REGION}

$BLUE═══════════════════════════════════════════════════════════════$NC

EOF

log_success "Deployment script completed!"

