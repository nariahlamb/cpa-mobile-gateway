#!/system/bin/sh
# CPA gateway boot service (late_start). Magisk BusyBox ash standalone 模式下无登录 HOME，须自设。
MODDIR=${0%/*}
CPA_DIR="$MODDIR/cpa"
BIN="$CPA_DIR/cpa-server"
CFG="$CPA_DIR/config.yaml"
LOG="$CPA_DIR/cpa.log"

# 关键：CPA 用 ~ 解析 auth-dir，依赖 HOME；boot 环境无 HOME 会拼成 /.cli-proxy-api 落只读根分区。
export HOME="$CPA_DIR"

# 等待存储/二进制就绪
for i in $(seq 1 30); do
  [ -f "$BIN" ] && [ -f "$CFG" ] && break
  sleep 2
done
[ -f "$BIN" ] || exit 0
chmod 0755 "$BIN"
mkdir -p "$CPA_DIR/auth"

# 防重复拉起
if pgrep -f "cpa-server .*$CFG" >/dev/null 2>&1; then exit 0; fi

: > "$LOG"
setsid "$BIN" --config "$CFG" >>"$LOG" 2>&1 &
