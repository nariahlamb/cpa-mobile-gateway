# cpa-mobile-gateway

CLIProxyAPI 轻量移动端聚合网关：Android CGO 构建 + 移动管理面板 + Magisk 模块。

- `panel/`：移动优先管理面板（纯前端，走 CPA Management API）
- `magisk/`：Magisk 模块骨架（二进制由 CI 注入）
- `.github/workflows/build.yml`：GitHub Actions 用 NDK r26d 交叉编译 `android/arm64`，
  `CGO_ENABLED=1 -tags netcgo` 让 net 走 bionic resolver，DNS 行为与系统一致，
  组装 Magisk zip 并发布 Release。

## 功能
站点多 key 自动轮询、失败自动切换、拉取上游模型、正则归类（axonhub 式链式 + 内联标志）、
批量测速、批量增删、自定义模型。全部映射到 CPA 原生 openai-compatibility 配置。

## 触发构建
Actions → build-android-arm64 → Run workflow，可传 `cpa_ref` 指定 CLIProxyAPI 源码版本。
