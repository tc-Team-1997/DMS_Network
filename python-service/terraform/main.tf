data "aws_availability_zones" "available" { state = "available" }

locals {
  name = "${var.name_prefix}-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name            = "${local.name}-vpc"
  cidr            = var.vpc_cidr
  azs             = local.azs
  private_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment != "prod"
  enable_dns_hostnames = true

  public_subnet_tags  = { "kubernetes.io/role/elb"          = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1 }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = "${local.name}-eks"
  cluster_version = var.eks_version
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_size]
      min_size       = var.node_min
      max_size       = var.node_max
      desired_size   = var.node_min
    }
  }
}

# S3 bucket for document store (swap STORAGE_DIR for an S3 driver in app).
resource "random_id" "bucket_suffix" { byte_length = 4 }

resource "aws_s3_bucket" "documents" {
  bucket        = var.documents_bucket_name != "" ? var.documents_bucket_name : "${local.name}-docs-${random_id.bucket_suffix.hex}"
  force_destroy = var.environment != "prod"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# RDS Postgres for metadata
resource "aws_db_subnet_group" "dms" {
  name       = "${local.name}-db-subnets"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db-sg"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    cidr_blocks     = [var.vpc_cidr]
    description     = "Postgres from VPC"
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "dms" {
  identifier              = "${local.name}-db"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = var.db_instance
  allocated_storage       = var.db_storage
  storage_encrypted       = true
  username                = var.db_username
  password                = var.db_password
  db_name                 = "dms"
  db_subnet_group_name    = aws_db_subnet_group.dms.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  backup_retention_period = 7
  skip_final_snapshot     = var.environment != "prod"
  deletion_protection     = var.environment == "prod"
  multi_az                = var.environment == "prod"
}

# ElastiCache Redis for task queue (when swapping the in-process queue for RQ)
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis-subnets"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis-sg"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_cluster" "dms" {
  cluster_id           = "${local.name}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]
}
