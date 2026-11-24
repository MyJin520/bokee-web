#!/usr/bin/env bash
# 下载 mc 客户端，把 dist 产物按版本号上传 MinIO：版本目录留档 + 覆盖 latest 固定文件
# 依赖环境变量：APP_VERSION、MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET
set -euo pipefail

MC_VERSION="RELEASE.2025-08-13T08-35-41Z"

curl -fsSL -o mc "https://github.com/minio/mc/releases/download/${MC_VERSION}/mc.linux-amd64.${MC_VERSION}"
chmod +x mc

./mc alias set minio "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

cp "bokee-web-${APP_VERSION}.tar.gz" bokee-web.tar.gz

# 版本目录留档 + 覆盖 latest 固定文件
./mc cp bokee-web.tar.gz "minio/${MINIO_BUCKET}/web/${APP_VERSION}/bokee-web.tar.gz"
./mc cp "minio/${MINIO_BUCKET}/web/${APP_VERSION}/bokee-web.tar.gz" "minio/${MINIO_BUCKET}/web/bokee-web.tar.gz"
