#!/usr/bin/env bash
# 发布前生产构建，把 dist 打包为 tar.gz 并生成 SHA256 校验和
# 依赖环境变量：APP_NAME、VERSION
set -euo pipefail

APP_NAME="${APP_NAME:-bokee-web}"

# 类型检查 + 生产构建（vue-tsc + vite build）
npm run build

# 版本清单随产物发布，服务器/Release 据此确认是哪个版本
cat > dist/version.json <<EOF
{
  "version": "${VERSION}",
  "commit": "$(git rev-parse --short HEAD)",
  "builtAt": "$(TZ=Asia/Shanghai date '+%F %T')"
}
EOF

# 静态站点产物与 CPU 架构无关，包名不带 linux_amd64
# 归档先写到仓库根再移入 dist，避免打包源 dist/ 读到正在写入的归档自身
ARCHIVE="${APP_NAME}_${VERSION}.tar.gz"
tar -C dist -czf "$ARCHIVE" .
test -s "$ARCHIVE"

# 包内条目断言：列表先落临时文件，避免 tar 经管道被 grep 提前关闭而触发 SIGPIPE
LIST_FILE="$(mktemp)"
trap 'rm -f "$LIST_FILE"' EXIT
tar -tzf "$ARCHIVE" > "$LIST_FILE"
grep -qx './index.html' "$LIST_FILE"
grep -qx './version.json' "$LIST_FILE"

sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
mv "$ARCHIVE" "$ARCHIVE.sha256" dist/

echo "archive=${ARCHIVE}" >> "$GITHUB_OUTPUT"
ls -l dist
