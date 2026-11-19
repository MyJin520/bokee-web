#!/usr/bin/env bash
# BOKEE Web 静态站点部署脚本（按版本号部署，产物来自 MinIO）
#
# 由 GitHub Actions 通过 SSH 调用，也可在服务器上手工执行。
# 产物存放位置与后端一致：桶内 web/<版本号>/bokee-web.tar.gz（另有 web/bokee-web.tar.gz 固定指向最新）。
#
# 用法:
#   ./deploy.sh deploy <version> [tarball]   部署该版本；给了 tarball 则改用本地文件（应急）
#   ./deploy.sh rollback <version>           回滚到该版本（本地没有就从 MinIO 拉取）
#   ./deploy.sh list                         查看服务器上保留的历史版本
#
# 环境变量:
#   WEB_ROOT          站点根目录       默认 /home/kim/composes/nginx
#   KEEP              保留历史版本数    默认 5
#   SITE_HOST         自检域名         默认 bokee.online
#   MINIO_CONTAINER   MinIO 容器名     默认 bokee-minio（复用容器内的 mc 与 local 别名）
#   MINIO_ALIAS       容器内 mc 别名    默认 local
#   MINIO_BUCKET      桶名             默认 bokee-artifacts
#   MINIO_PREFIX      桶内前缀         默认 web
#   MINIO_OBJECT      产物对象名       默认 bokee-web.tar.gz
#   SKIP_VERIFY=1     跳过部署后的站点自检（仅演练时使用）
set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/home/kim/composes/nginx}"
KEEP="${KEEP:-5}"
SITE_HOST="${SITE_HOST:-bokee.online}"
MINIO_CONTAINER="${MINIO_CONTAINER:-bokee-minio}"
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_BUCKET="${MINIO_BUCKET:-bokee-artifacts}"
MINIO_PREFIX="${MINIO_PREFIX:-web}"
MINIO_OBJECT="${MINIO_OBJECT:-bokee-web.tar.gz}"

INCOMING="$WEB_ROOT/incoming"
RELEASES="$WEB_ROOT/releases"
DIST="$WEB_ROOT/dist"

STAGE=""
DOWNLOAD=""

log() { printf '==> [%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  [ -n "$DOWNLOAD" ] && rm -f "$DOWNLOAD"
  return 0
}
trap cleanup EXIT

usage() {
  cat >&2 <<'EOF'
用法:
  deploy.sh deploy <version> [tarball]
  deploy.sh rollback <version>
  deploy.sh list
EOF
  exit 1
}

# 版本号只允许字母数字、点、下划线、短横线，防止路径穿越和命令注入
check_version() {
  [[ "${1:-}" =~ ^[A-Za-z0-9._-]+$ ]] || die "非法版本号: ${1:-<空>}"
}

# 从 MinIO 按版本号拉取产物（复用 bokee-minio 容器内的 mc 与 local 别名，无需在宿主机存凭据）
fetch_from_minio() {
  local version="$1" dest="$2"
  local key="$MINIO_PREFIX/$version/$MINIO_OBJECT"
  log "从 MinIO 拉取 $MINIO_BUCKET/$key"
  if ! docker exec "$MINIO_CONTAINER" mc cat "$MINIO_ALIAS/$MINIO_BUCKET/$key" > "$dest" 2>/dev/null; then
    rm -f "$dest"
    die "MinIO 中没有该版本产物: $MINIO_BUCKET/$key（请确认版本号或先跑一次 CI）"
  fi
  [ -s "$dest" ] || { rm -f "$dest"; die "拉取到的产物为空: $MINIO_BUCKET/$key"; }
  log "产物大小: $(du -h "$dest" | cut -f1)"
}

# 部署后自检：首页与首页引用的首个 JS 资源必须返回 200
verify_site() {
  if [ "${SKIP_VERIFY:-0}" = "1" ]; then
    log "已跳过站点自检（SKIP_VERIFY=1）"
    return 0
  fi

  local code asset
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST/" || true)"
  [ "$code" = "200" ] || die "站点首页访问异常: HTTP $code（请检查 bokee-nginx 容器状态）"

  asset="$(curl -s --max-time 10 --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST/" \
    | grep -o '/assets/[^"]*\.js' | head -n1 || true)"
  if [ -n "$asset" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      --resolve "$SITE_HOST:443:127.0.0.1" "https://$SITE_HOST$asset" || true)"
    [ "$code" = "200" ] || die "首页引用的资源访问异常: $asset -> HTTP $code"
    log "自检通过：首页 200，首个资源 $asset 200"
  else
    log "自检通过：首页 200（首页未引用 /assets/*.js，跳过资源校验）"
  fi
}

# rsync 先写新文件再清理旧文件，尽量缩短文件不一致的窗口
sync_into_dist() {
  local src="$1"
  [ -d "$src" ] || die "待同步目录不存在: $src"
  mkdir -p "$DIST"
  [ -w "$DIST" ] || die "$DIST 不可写，请确认属主为部署用户（sudo chown -R $(id -u):$(id -g) $DIST）"
  rsync -a --delete --delay-updates "$src"/ "$DIST"/
}

prune_releases() {
  local keep_version="${1:-}"
  # 按修改时间倒序保留前 KEEP 个（本次部署的版本一定保留）
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r dir; do
    [ "$(basename "$dir")" = "$keep_version" ] && continue
    rm -rf "$dir"
  done
}

# 解压产物到暂存目录 / 拷贝进 releases，返回暂存目录路径（变量 STAGE）
prepare_release() {
  local version="$1" pkg="$2"
  STAGE="$WEB_ROOT/.staging-$version"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"

  tar -xzf "$pkg" -C "$STAGE" --no-same-owner
  [ -s "$STAGE/index.html" ] || die "产物内缺少 index.html，构建包不完整"

  mkdir -p "$RELEASES"
  rm -rf "${RELEASES:?}/$version"
  mkdir -p "$RELEASES/$version"
  cp -a "$STAGE"/. "$RELEASES/$version"/
  # cp -a 会把源目录 mtime 一起带过来，重置为当前时间，保证保留策略按部署先后排序
  touch "$RELEASES/$version"
  log "已留存发布副本: $RELEASES/$version"
}

do_deploy() {
  local version="${1:-}" tarball="${2:-}"
  check_version "$version"

  local pkg=""
  if [ -n "$tarball" ]; then
    # 应急路径：直接部署本地压缩包
    case "$tarball" in
      /*) ;;
      *) tarball="$INCOMING/$tarball" ;;
    esac
    [ -f "$tarball" ] || die "压缩包不存在: $tarball"
    pkg="$tarball"
    log "使用本地压缩包部署: $(basename "$pkg")"
  else
    DOWNLOAD="$WEB_ROOT/.download-$version.tar.gz"
    fetch_from_minio "$version" "$DOWNLOAD"
    pkg="$DOWNLOAD"
  fi

  log "部署版本: $version"
  prepare_release "$version" "$pkg"

  # bind mount 实时生效，静态文件替换后无需重启/重载 nginx
  log "同步到 $DIST"
  sync_into_dist "$STAGE"

  verify_site
  prune_releases "$version"

  log "部署完成: $version（MinIO 中保留全部历史，可 deploy.sh rollback <版本> 切换）"
}

do_rollback() {
  local version="${1:-}"
  check_version "$version"

  local pkg=""
  if [ -d "$RELEASES/$version" ]; then
    log "回滚到版本: $version（使用本地 releases 副本）"
    sync_into_dist "$RELEASES/$version"
  else
    log "回滚到版本: $version（本地无副本，从 MinIO 拉取）"
    DOWNLOAD="$WEB_ROOT/.download-$version.tar.gz"
    fetch_from_minio "$version" "$DOWNLOAD"
    prepare_release "$version" "$DOWNLOAD"
    sync_into_dist "$STAGE"
  fi

  verify_site
  log "回滚完成: $version"
}

do_list() {
  if [ ! -d "$RELEASES" ] || [ -z "$(ls -A "$RELEASES" 2>/dev/null)" ]; then
    echo "本地暂无历史版本（MinIO 中仍保留全部版本）"
    return 0
  fi
  echo "本地历史版本（按时间倒序）:"
  ls -1dt "$RELEASES"/*/ | while read -r dir; do
    printf '  %-24s %s\n' "$(basename "$dir")" "$(date -r "$dir" '+%F %T')"
  done
  echo
  echo "当前 dist 文件数: $(find "$DIST" -type f 2>/dev/null | wc -l)"
}

case "${1:-}" in
  deploy) shift; do_deploy "${1:-}" "${2:-}" ;;
  rollback) shift; do_rollback "${1:-}" ;;
  list) shift; do_list ;;
  *) usage ;;
esac
