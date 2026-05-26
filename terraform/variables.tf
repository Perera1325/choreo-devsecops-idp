variable "aws_region" {
  type        = string
  description = "The target AWS Region for deployment"
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Primary tag prefix for resource naming"
  default     = "devsecops-idp"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the custom VPC"
  default     = "10.0.0.0/16"
}

variable "db_username" {
  type        = string
  description = "Administrator username for WSO2 metadata RDS instance"
  default     = "wso2admin"
}

variable "db_password" {
  type        = string
  description = "Administrator password for WSO2 metadata RDS instance"
  sensitive   = true
  default     = "WSO2devsecopsPassword2026!"
}
