terraform {
  required_version = ">= 1.5"
  required_providers {
    aws        = { source = "hashicorp/aws",        version = "~> 5.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.30" }
    helm       = { source = "hashicorp/helm",       version = "~> 2.13" }
    random     = { source = "hashicorp/random",     version = "~> 3.6" }
  }
  backend "s3" {
    # Configure via `terraform init -backend-config=...` in CI.
    # bucket  = "nbe-dms-tf-state"
    # key     = "python-service/terraform.tfstate"
    # region  = "eu-west-1"
    # encrypt = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "nbe-dms"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
