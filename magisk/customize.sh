#!/system/bin/sh
SKIPUNZIP=0
ui_print "- 安装 CPA 网关模块"
ui_print "- 请在 cpa/ 放入 arm64 的 cpa-server 二进制"
ui_print "- 面板：cpa/static/management.html"
ui_print "- 首次启动后访问 http://127.0.0.1:8317/management.html"
mkdir -p "$MODPATH/cpa/static"
set_perm_recursive "$MODPATH" 0 0 0755 0644
[ -f "$MODPATH/cpa/cpa-server" ] && set_perm "$MODPATH/cpa/cpa-server" 0 0 0755
