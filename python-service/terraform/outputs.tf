output "eks_cluster_name"    { value = module.eks.cluster_name }
output "eks_cluster_endpoint" { value = module.eks.cluster_endpoint }
output "vpc_id"              { value = module.vpc.vpc_id }

output "documents_bucket"    { value = aws_s3_bucket.documents.bucket }
output "db_endpoint"         { value = aws_db_instance.dms.address }
output "db_name"             { value = aws_db_instance.dms.db_name }
output "redis_endpoint"      { value = aws_elasticache_cluster.dms.cache_nodes[0].address }

output "database_url" {
  value     = "postgresql+psycopg://${var.db_username}:${var.db_password}@${aws_db_instance.dms.address}:5432/dms"
  sensitive = true
}
