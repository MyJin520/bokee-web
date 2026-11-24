#!/usr/bin/env bash
# 读取 VERSION，生成 version.json 清单，把 dist 打包为 tar.gz 并回传版本号与包名
# 产物包内为 dist 的平铺内容，部署脚本解压后直接落到 nginx 的 dist/
set -euo pipefail

APP_VERSION="$(tr -d '\r\n' < VERSION)"
test -n "$APP_VERSION" || { echo "VERSION 文件为空" >&2; exit 1; }
TARBALL="bokee-web-${APP_VERSION}.tar.gz"

# 版本清单随产物发布，服务器据此确认 dist 里是哪个版本
cat > dist/version.json <<EOF
{
  "version": "${APP_VERSION}",
  "commit": "$(git rev-parse --short HEAD)",
  "builtAt": "$(TZ=Asia/Shanghai date '+%F %T')"
}
EOF

# 压缩包内为 dist 的平铺内容
tar -czf "$TARBALL" -C dist .
test -s "$TARBALL"
tar -tzf "$TARBALL" | grep -qx './index.html'
tar -tzf "$TARBALL" | grep -qx './version.json'

# 回传版本号与包名给下游 job
echo "version=${APP_VERSION}" >> "$GITHUB_OUTPUT"
echo "tarball=${TARBALL}" >> "$GITHUB_OUTPUT"
echo "构建版本: $APP_VERSION（产物 $(du -h "$TARBALL" | cut -f1)）"
