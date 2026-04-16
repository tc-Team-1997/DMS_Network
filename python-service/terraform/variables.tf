variable "region"       { type = string  default = "eu-west-1" }
variable "environment"  { type = string  default = "dev" }
variable "name_prefix"  { type = string  default = "nbe-dms" }
variable "vpc_cidr"     { type = string  default = "10.40.0.0/16" }

variable "eks_version"  { type = string  default = "1.29" }
variable "node_size"    { type = string  default = "t3.large" }
variable "node_min"     { type = number  default = 2 }
variable "node_max"     { type = number  default = 6 }

variable "db_username"  { type = string  default = "dms" }
variable "db_password"  { type = string  sensitive = true }
variable "db_instance"  { type = string  default = "db.t3.medium" }
variable "db_storage"   { type = number  default = 100 }

variable "documents_bucket_name" {
  type    = string
  default = ""  # empty → auto-name
}
