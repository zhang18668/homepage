# Homepage 与 Authentik 统一网关设计

## 目标

在现有服务器上部署 Homepage 作为统一服务导航页，并使用完全自托管的 Authentik 为所有对外 Web 服务提供统一登录。系统支持多个独立账号；第一阶段所有普通账号拥有相同的服务访问权限。

成功标准：

- `https://zhangzhh13.xyz/` 展示 Homepage，并包含全部服务入口。
- 用户登录一次后，可访问全部受保护服务，无需重复登录。
- 普通账号不能访问 Authentik 管理后台。
- 所有业务服务只能通过 Nginx 网关访问，不能通过公网 IP 和容器映射端口绕过认证。
- 现有服务在迁移后保持页面、API、静态资源、WebSocket 和长连接功能正常。
- 服务重启后用户、配置与会话数据不会丢失。

## 当前状态

服务器 SSH 别名为 `mobilecloud-deploy`，主机名为 `ser307880498767`。当前公网入口和业务映射如下：

| 公开入口 | 后端 | 当前情况 |
| --- | --- | --- |
| `zhangzhh13.xyz/` | `127.0.0.1:3018` | TickFlow Stock Panel |
| `zhangzhh13.xyz/czsc/` | `127.0.0.1:3020` | CZSC |
| `zhangzhh13.xyz/quant/` | `127.0.0.1:3091` | TSP Quant |
| `zhangzhh13.xyz/blog/` | `127.0.0.1:32002` | Stock Blog，当前有 Basic Auth |
| `zhangzhh13.xyz/daily-stock-analysis/` | `127.0.0.1:8000` | Daily Stock Analysis，当前仅在 `www` 入口配置 |
| `zhangzhh13.xyz/vibe-trading/` | `127.0.0.1:8899` | Vibe Trading，当前仅在 `www` 入口配置 |

端口 `3018`、`8000`、`8899` 当前绑定所有网络接口，可绕过 Nginx 直接访问。RPC 端口 `111` 也暴露在公网。PostgreSQL、CZSC、Quant 与 Blog 的后端端口已经只监听本机。

服务器拥有 16 核 CPU、15 GiB 内存，检查时约有 7.7 GiB 可用。系统盘容量 79 GiB，剩余约 13 GiB，使用率 84%。资源足够运行 Authentik，但实施前需要审查并安全清理不再使用的 Docker 镜像与构建缓存。

## 方案选择

采用 **Authentik + Nginx Forward Auth**。

选择理由：

- Authentik 完全自托管，用户、会话与策略数据均保留在服务器。
- 提供可视化用户管理，适合多个账号。
- Forward Auth 能保护没有 OIDC 或 SAML 能力的现有应用，无需修改每个应用。
- 后续可以增加用户组、应用级授权、TOTP 和 OIDC，而第一阶段无需引入这些复杂度。

未选择 Authelia，是因为多用户日常管理更依赖配置文件。未选择 Keycloak 与 oauth2-proxy，是因为组件和维护复杂度超过当前需求。

## 目标架构

```text
Internet
   |
   v
Nginx :80/:443
   |-- auth.zhangzhh13.xyz ----------> Authentik Server
   |-- zhangzhh13.xyz ---------------> Homepage
   |-- stonepanel.zhangzhh13.xyz ----> TickFlow Stock Panel
   |-- /czsc/ ------------------------> CZSC
   |-- /quant/ -----------------------> TSP Quant
   |-- /blog/ ------------------------> Stock Blog
   |-- /daily-stock-analysis/ --------> Daily Stock Analysis
   `-- /vibe-trading/ ----------------> Vibe Trading

除 Authentik 登录所需端点外，Nginx 在转发前统一调用 Authentik Forward Auth。
```

新增容器：

- `authentik-server`：登录页、管理后台、认证 API 和内置 Proxy Outpost。
- `authentik-worker`：后台任务。
- `authentik-postgresql`：用户、策略、会话与配置数据。
- `homepage`：统一导航页。

Authentik 使用官方 Docker Compose 结构和固定稳定版本标签。第一阶段使用内置 Proxy Outpost，不向 Authentik Worker 挂载 Docker Socket。数据库使用独立持久卷，不复用现有业务 PostgreSQL。

## 域名与路由

| 地址 | 用途 |
| --- | --- |
| `https://zhangzhh13.xyz/` | Homepage 导航页 |
| `https://stonepanel.zhangzhh13.xyz/` | TickFlow Stock Panel |
| `https://auth.zhangzhh13.xyz/` | Authentik 登录与账号管理 |
| `https://zhangzhh13.xyz/czsc/` | CZSC |
| `https://zhangzhh13.xyz/quant/` | TSP Quant |
| `https://zhangzhh13.xyz/blog/` | Stock Blog |
| `https://zhangzhh13.xyz/daily-stock-analysis/` | Daily Stock Analysis |
| `https://zhangzhh13.xyz/vibe-trading/` | Vibe Trading |

`www.zhangzhh13.xyz` 永久重定向到 `zhangzhh13.xyz`。独立子域名用于 StonePanel，避免 TickFlow 在子路径运行时出现静态资源、接口地址和客户端路由问题。

## 身份与访问规则

- Authentik 配置域级 Forward Auth，使根域名与子域名共享登录状态。
- 普通账号加入单一的“服务用户”组，该组可以访问全部业务服务。
- 管理员账号独立保留，仅用于 Authentik 管理，不作为日常账号。
- 普通账号不能访问 Authentik 管理后台。
- 第一阶段使用用户名和密码登录；保留以后强制 TOTP 的扩展能力。
- Homepage 不启用第二套认证。
- Stock Blog 在 Authentik 验证稳定后移除旧 Basic Auth，避免双重登录。

访问流程：

1. 用户访问 Homepage 或任一业务服务。
2. Nginx 通过 Authentik Forward Auth 检查会话。
3. 未登录用户跳转到 `auth.zhangzhh13.xyz`。
4. 登录完成后回到原始地址。
5. 用户访问其他服务时复用已有会话。
6. 用户从 Authentik 退出后，所有受保护入口失效。

## 网络与安全规则

- Nginx 是 Web 服务唯一公网入口。
- Homepage、Authentik 和所有业务后端只绑定 `127.0.0.1` 或仅加入内部 Docker 网络。
- 将 TickFlow、Daily Stock Analysis、Vibe Trading 的宿主机端口分别从公网绑定改为本机绑定。
- 关闭公网 RPC `111`。
- 公网仅保留 `22`、`80`、`443`；其中 `80` 只执行 HTTPS 跳转。
- PostgreSQL 不暴露到公网。
- Nginx 为 API、静态资源、WebSocket、Server-Sent Events 和长连接保留必要的转发头及超时配置。
- Authentik 密钥和数据库密码保存在权限受限的环境文件中，不进入仓库。
- 不在 Homepage 配置或日志中写入业务服务密钥。

## Homepage 信息结构

Homepage 第一版按用途分组：

- **核心面板**：StonePanel、Quant。
- **分析工具**：CZSC、Daily Stock Analysis、Vibe Trading。
- **内容**：Stock Blog。
- **系统管理**：Authentik 用户门户；管理后台入口仅对管理员显示或仅由管理员直接访问。

每张卡片至少包含服务名称、简短说明、图标和目标地址。能稳定提供健康接口的服务再启用状态信息；不通过抓取业务页面来伪造健康检查。

## 部署顺序

### 1. 准备阶段

- 检查磁盘占用，识别可安全回收的无用镜像和构建缓存。
- 创建 `/opt/authentik` 与 `/opt/homepage`。
- 为新增配置和数据目录设置最小必要权限。
- 创建 Nginx 配置和证书操作前的带时间戳备份。

### 2. 部署内部服务

- 使用官方 Compose 文件部署固定版本的 Authentik Server、Worker 与 PostgreSQL。
- 部署 Homepage，并生成包含全部服务的配置。
- 新服务先只监听本机，不加入正式公网路由。
- 完成 Authentik 管理员初始化，创建测试普通账号。

### 3. 验证认证

- 使用临时测试入口保护 Homepage。
- 验证登录、退出、重定向、Cookie、页面刷新和未授权访问。
- 重启 Authentik 容器，确认用户与配置仍然存在。

### 4. 逐项接管

- 建立 `auth.zhangzhh13.xyz`。
- 建立 `stonepanel.zhangzhh13.xyz`，同时暂时保留 TickFlow 旧入口。
- 依次接入 CZSC、Quant、Blog、Daily Stock Analysis 与 Vibe Trading。
- 每接入一个服务，验证页面、API、静态资源、WebSocket、SSE 和长连接。

### 5. 切换首页

- 将根路径从 TickFlow 切换为 Homepage。
- 验证所有导航卡片。
- 将 `www` 永久重定向至根域名。
- StonePanel 新子域稳定后移除旧根路径入口。

### 6. 收紧公网入口

- 将 `3018`、`8000`、`8899` 改为仅监听本机。
- 关闭公网 RPC `111`。
- 从服务器外部重新检查端口与 HTTP 入口，确认不能绕过认证。

## 故障处理与回滚

- 每次 Nginx 变更前保存完整配置副本。
- 每次加载配置前运行 `nginx -t`；验证失败时不加载。
- 业务容器在认证切换期间保持原版本运行，不同时升级应用。
- 切换失败时恢复上一份 Nginx 配置并重新加载，使服务回到迁移前入口。
- Authentik PostgreSQL 数据持久化，并建立定期逻辑备份。
- Authentik 升级前备份数据库，Server、Worker 与 Outpost 版本保持一致。
- 固定镜像版本，升级由显式维护操作触发。
- Authentik 暂时不可用时默认拒绝受保护请求，不静默绕过认证；紧急回滚必须由管理员显式恢复旧配置。

## 验收测试

### 认证

- 未登录访问每个入口时均跳转统一登录页。
- 普通账号登录一次后能访问全部服务。
- 普通账号不能进入 Authentik 管理后台。
- 退出后重新访问任一服务时要求再次登录。
- 错误密码不会创建有效会话。

### 应用兼容性

- 每个应用首页正常呈现。
- 静态资源无 404 或跨域错误。
- API 请求、表单提交和文件操作正常。
- WebSocket、SSE 和长时间运行请求正常。
- 浏览器刷新深层路径不会落到错误后端。

### 网络安全

- 从公网访问 `3018`、`8000`、`8899` 和 `111` 失败。
- PostgreSQL 端口无法从公网连接。
- `80` 仅跳转到 HTTPS。
- 未经 Authentik 会话无法直接访问任何业务 URL。

### 持久性与运维

- 重启新增容器后用户、策略与 Homepage 配置保留。
- 服务器重启后新增服务自动恢复且健康检查通过。
- Nginx、Authentik 与 Homepage 日志可用于定位认证和代理故障。
- Authentik 数据库备份文件可生成，并记录恢复步骤。

## 非目标

第一阶段不包含：

- 不为不同普通用户配置不同服务权限。
- 不改造现有应用以原生接入 OIDC。
- 不强制启用 TOTP、邮件验证或密码自助找回。
- 不同时升级现有业务应用。
- 不开放新的公网业务端口。
