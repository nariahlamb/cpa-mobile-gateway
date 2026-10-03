#!/usr/bin/env bash
# 构建 Android 真机可用的 cpa-server（在 CPA 仓库根目录执行）。
# 关键：必须 GOOS=android（不是 linux）。GOOS=linux 时 crypto/x509 的 IsAndroid=0，
# 不会扫描 /system/etc/security/cacerts，导致所有出站 HTTPS 报
# "x509: certificate signed by unknown authority"（api-call 拉取模型 502 的根因）。
# -checklinkname=0：wlynxg/anet 的 go:linkname net.zoneCache 在 Go>=1.23 被禁，需放行。
set -e
GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -checklinkname=0" -o cpa-server ./cmd/server
echo "built: $(ls -la cpa-server)"
