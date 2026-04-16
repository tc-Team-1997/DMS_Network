# Active-active: second live region with its own EKS + writable DB + S3.
# Replication is bidirectional — each region's app pod stamps sync_clock and
# posts mutation events to the sibling via /api/v1/replication/apply.

provider "aws" {
  alias  = "aa"
  region = var.dr_region
}

module "vpc_aa" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"
  providers = { aws = aws.aa }

  name            = "${local.name}-vpc-aa"
  cidr            = cidrsubnet("10.50.0.0/16", 0, 0)
  azs             = slice(data.aws_availability_zones.available_aa.names, 0, 3)
  private_subnets = [for i in range(3) : cidrsubnet("10.50.0.0/16", 4, i)]
  public_subnets  = [for i in range(3) : cidrsubnet("10.50.0.0/16", 4, i + 8)]
  enable_nat_gateway   = true
  single_nat_gateway   = var.environment != "prod"
  enable_dns_hostnames = true
}

data "aws_availability_zones" "available_aa" {
  provider = aws.aa
  state    = "available"
}

module "eks_aa" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"
  providers = { aws = aws.aa }

  cluster_name    = "${local.name}-eks-aa"
  cluster_version = var.eks_version
  vpc_id          = module.vpc_aa.vpc_id
  subnet_ids      = module.vpc_aa.private_subnets
  eks_managed_node_groups = {
    default = { instance_types = [var.node_size], min_size = var.node_min, max_size = var.node_max }
  }
}

# Global accelerator or Route 53 latency-based record routes traffic regionally.
resource "aws_route53_record" "dms_latency_primary" {
  zone_id        = var.route53_zone_id
  name           = "dms.${var.domain}"
  type           = "A"
  set_identifier = "eu-west-1"
  latency_routing_policy { region = var.region }
  alias { name = var.primary_alb_dns name = var.primary_alb_dns zone_id = var.primary_alb_zone evaluate_target_health = true }
}

resource "aws_route53_record" "dms_latency_secondary" {
  zone_id        = var.route53_zone_id
  name           = "dms.${var.domain}"
  type           = "A"
  set_identifier = "eu-central-1"
  latency_routing_policy { region = var.dr_region }
  alias { name = var.secondary_alb_dns name = var.secondary_alb_dns zone_id = var.secondary_alb_zone evaluate_target_health = true }
}

variable "route53_zone_id"      { type = string  default = "" }
variable "domain"               { type = string  default = "nbe.local" }
variable "primary_alb_dns"      { type = string  default = "" }
variable "primary_alb_zone"     { type = string  default = "" }
variable "secondary_alb_dns"    { type = string  default = "" }
variable "secondary_alb_zone"   { type = string  default = "" }

output "active_active_eks"      { value = module.eks_aa.cluster_name }
output "active_active_endpoint" { value = module.eks_aa.cluster_endpoint }
