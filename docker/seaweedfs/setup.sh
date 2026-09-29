#!/bin/sh
# Create the requested local bucket if missing.
set -eu

export AWS_ACCESS_KEY_ID=local-development
export AWS_SECRET_ACCESS_KEY=local-development-secret
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=

s3() {
    aws --endpoint-url "${S3_ENDPOINT_URL:-http://seaweedfs:8333}" s3api "$@"
}

bucket=${1:?Bucket name is required}

exists=$(s3 list-buckets --query "Buckets[?Name=='$bucket'].Name" --output text)
if [ -z "$exists" ]; then
    s3 create-bucket --bucket "$bucket" > /dev/null
fi

# Browser uploads need preflight permission and readable multipart ETags.
s3 put-bucket-cors --bucket "$bucket" --cors-configuration '{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","PUT","POST","DELETE","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"]}]}'

printf 'Local S3 bucket %s is ready.\n' "$bucket"
