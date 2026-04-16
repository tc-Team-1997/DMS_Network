# Disaster Recovery — cross-region replication.
# Companion region defaults to eu-central-1 if primary is eu-west-1.

variable "dr_region" {
  type    = string
  default = "eu-central-1"
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags {
    tags = {
      Project     = "nbe-dms"
      ManagedBy   = "terraform"
      Environment = var.environment
      Role        = "dr"
    }
  }
}

# DR S3 bucket (destination for cross-region replication)
resource "aws_s3_bucket" "documents_dr" {
  provider      = aws.dr
  bucket        = "${local.name}-docs-dr-${random_id.bucket_suffix.hex}"
  force_destroy = var.environment != "prod"
}

resource "aws_s3_bucket_versioning" "documents_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.documents_dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_iam_role" "s3_replication" {
  name = "${local.name}-s3-replication"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "s3_replication" {
  role = aws_iam_role.s3_replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Resource = [aws_s3_bucket.documents.arn]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObjectVersion", "s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl"]
        Resource = ["${aws_s3_bucket.documents.arn}/*"]
      },
      {
        Effect = "Allow"
        Action = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Resource = ["${aws_s3_bucket.documents_dr.arn}/*"]
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "documents" {
  depends_on = [aws_s3_bucket_versioning.documents, aws_s3_bucket_versioning.documents_dr]
  role       = aws_iam_role.s3_replication.arn
  bucket     = aws_s3_bucket.documents.id

  rule {
    id     = "replicate-all"
    status = "Enabled"
    filter {}
    destination {
      bucket        = aws_s3_bucket.documents_dr.arn
      storage_class = "STANDARD_IA"
    }
    delete_marker_replication { status = "Enabled" }
  }
}

# RDS cross-region read replica (promotes to primary during DR)
resource "aws_db_instance" "dms_dr" {
  provider                = aws.dr
  identifier              = "${local.name}-db-dr"
  replicate_source_db     = aws_db_instance.dms.arn
  instance_class          = var.db_instance
  storage_encrypted       = true
  skip_final_snapshot     = var.environment != "prod"
  deletion_protection     = var.environment == "prod"
  auto_minor_version_upgrade = true
}

output "dr_documents_bucket" { value = aws_s3_bucket.documents_dr.bucket }
output "dr_db_endpoint"       { value = aws_db_instance.dms_dr.address }
