# CPA 移动端网关 · 进展记录

> 本文件记录当前会话的关键进展、根因结论与部署状态。

## 远端仓库
- **面板/Magisk**: https://github.com/nariahlamb/cpa-mobile-gateway (`main`)
- **CPA Go 补丁**: https://github.com/nariahlamb/CLIProxyAPI (fork, 分支 `feat/model-groups`)
- 上游: https://github.com/router-for-me/CLIProxyAPI (本地 main = v7.3.18，落后上游 v8.0.9 共 88 提交)

## 已修复/已完成

### 1. 拉取模型 502 根因（核心 bug）
- **根因**: 模块内 cpa-server 用 `GOOS=linux` 编译，Go `crypto/x509` 在 linux 下 `IsAndroid=0`，不扫描 `/system/etc/security/cacerts` → `SystemCertPool()` 空池 → 所有出站 HTTPS 报 `x509: certificate signed by unknown authority` → api-call 全 502。
- **修复**: 用 `GOOS=android GOARCH=arm64 CGO_ENABLED=0` + `-ldflags="-s -w -checklinkname=0"` 重编（`-checklinkname=0` 解决 wlynxg/anet 的 go:linkname net.zoneCache 在新 Go 被禁）。见 `scripts/build-android.sh`。
- **实证**: 换二进制后 api-call 拉 justwoker/catiecli `/v1/models` 均 200，chat/responses/messages 转发全通。

### 2. 模型分组（cherrystudio 式，改 Go 暴露 type/groups）
- `ModelInfo` 加 `Groups`/`EndpointCapabilities`，`ResolveGroups()` 按模型名厂商正则(移植 cherrystudio `VENDOR_PATTERNS`)推断家族（deepseek/gemini/glm/qwen/kimi/minimax/hunyuan/doubao/grok/claude/openai/image），按名字关键词标 thinking/vision/tools/web-search。
- `OpenAIModels /v1/models` 放行 `type`/`groups`/`display_name`。
- thinking 仅显式配置或名字关键词才标（registry 默认 ThinkingSupport 不再误标普通 chat 模型）；nothinking/dall-e/embedding 边界已处理。

### 3. API 三模式按站点实测标注
- config `OpenAICompatibility` 新增 `endpoint-capabilities`（chat/responses/anthropic），PATCH/GET 支持并持久化。
- `ResolveGroups` 按站点探测结果标三模式；未探测按 handler Type 回退。
- 面板站点卡片「探测」按钮实测三端点（404/405/501/超时=不支持）写回。
- **实测三站点**: catiecli=仅 chat（responses/messages 405）；模块cn(127.0.0.1:7863)=chat+responses；justwoker=anthropic（claude 适配器，messages 200）。

### 4. 面板 OAuth 登录 UI
- CPA 原生已内置 OAuth management 端点：`GET /v0/management/{antigravity,anthropic,codex,kimi,devin,meta}-auth-url` 返回 `{status,url,state}`，授权后自动存 auth-dir 并注册模型；回调 `POST /v0/management/oauth-callback`。
- 面板新增「登录」页：凭证列表 + 6 厂家登录按钮，自动 `window.open` 授权页，回调地址提交，轮询 auth-files 确认落盘后自动刷新分组。
- **auth 登录→自动写模型为 CPA 原生链路**（auth-dir fsnotify watcher → snapshotCoreAuths → dispatchAuthUpdates → registerResolvedModelsForAuth），无需移植。

## 面板功能（原有，本轮保留）
站点管理/多 key 权重轮询/失败切换/拉取上游模型/批量测速/正则归类(axonhub 式)/批量删除/规则导入导出实时预览。

## 待办 / 后续
- [ ] 用户实测面板 OAuth 登录（antigravity = Google OAuth，回调 localhost:51121，跨设备授权需把回调 URL 粘回手机）。
- [ ] 可选：合并上游 v8（config/v8 比对结论：现有 config 与面板在 v8 零改动可跑，v8 修复 Android suspend 下 token 刷新停摆；升级需备份 config.yaml，首次 management 写入会迁移到分组布局）。
- [ ] 可选：codex-device 设备码登录入口（浏览器跳不回 localhost 时更友好）。
- [ ] gemini 无 OAuth，走 API key（config gemini-api-key），不在登录列表。

## Magisk 部署
- 模块路径 `/data/adb/modules/cpa_gateway/`，仅监听 127.0.0.1:8317，service.sh late_start 自启。
- 面板 `static/management.html`（dist 单文件），config 设 `disable-auto-update-panel: true` 防官方面板覆盖。
- 当前运行二进制 = GOOS=android 重编版（含分组+能力补丁），旧 linux 版备份 `cpa-server.bak-linux`。

## v8 合并版（已编译验证）
- 分支 `feat/model-groups-v8`（基于上游 v8.0.9 + cherry-pick 分组补丁，无冲突），已推 fork。
- 二进制 `cpa-server-v8` 已放模块目录备用。实测（8319 端口，用现有 config/auth-dir）：
  启动成功、管理 API 兼容、endpoint-capabilities 读回正确、/v1/models 分组保留
  （cn:deepseek=chat+responses、gcli=仅 chat）、chat 转发 200、OAuth 端点正常、无错误日志。
- 切换 v8：备份 config.yaml 后 `mv cpa-server-v8 cpa-server` 重启模块。首次 management
  写入会把 config 迁移到 v8 分组布局（server.*/oauth.*/upstream.*），凭证与配置可读但格式变化。
- v8 增益：auth 自动刷新改用 CLOCK_MONOTONIC，修复 Android suspend 下 token 刷新停摆；
  codex 新增 plan_type 透传；新增 devin/meta 供应商。

## 5. 第三方 Anthropic 中继被 CF 拦截根因 + 修复（分支 feat/cooldown-and-claude-utls）
- **现象**: justwoker(claude 适配器) 配成 openai-compatibility 后 claude-opus-4-8 走 anthropic/chat 全 403，模型被 CPA 冷却 5 分钟从出口消失。
- **根因（双重）**: (a) CPA `fallbackRoundTripper` 仅对硬编码 `api.anthropic.com` 用 claude uTLS 指纹(复刻 Claude Code Node/OpenSSL JA3)，第三方中继回落到 Go 原生 TLS，被 Cloudflare 按 JA3 指纹 403；(b) 非 claude-cli 的 User-Agent 也被 CF 拦。
- **修复**: 新增 `claude_upstream_hosts.go` 注册 claude-api-key 自定义 base-url 的 host，`IsClaudeCompatUpstreamURL` 让它们也走 uTLS；claude_executor 非 anthropic-base 强制 claude-cli UA。
- **正确接入方式**: 第三方 claude 适配器应配 `claude-api-key`（base-url+headers+models），不是 openai-compatibility。justwoker 已改配 claude-api-key（prefix jw），实测 `jw/claude-opus-4-8` anthropic/chat 均 200（连测非偶发），并已删掉 openai-compat 里的失效项。

## 6. 冷却可视可控（同分支）
- 新增 `GET /v0/management/cooldowns`（列出 quota-exceeded/suspended 冷却）与 `POST /v0/management/cooldowns/clear`（按 client/model/all 清除），registry 增加 CooldownSnapshot/ClearAllCooldowns/ClearClientCooldowns。冷却不再黑盒等 5 分钟。

## 备忘
- agy 站 `假流式/`、`抗截断/` 前缀是上游 gcli2api 的流式/抗截断变体命名，非乱码。
- anthropic 模式 `/v1/models` 对非 claude 模型做 Cloaking（id 反转+claude-fable-5-dd- 前缀），路由时还原，是上游故意设计。
- devin 站 `claude-fable-*` 系列多为占位/无额度（403 insufficient_quota）。
