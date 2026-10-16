# 晨风服务导航页账号入口

服务器上的 Homepage 使用官方镜像，配置目录为 `/opt/homepage/config`。把本目录的 `custom.js` 加载为该目录的 `custom.js`；把 `custom.css` 追加到现有的 `custom.css`，保留原有移动端规则。

在 `zhangzhh13.xyz` 的 Nginx HTTPS server 块中引用 `deploy/nginx/homepage-account.conf`。该位置通过现有 Authentik forward auth 校验请求，再向已登录的浏览器返回当前用户名；未登录请求必须重定向到 Authentik。不要让客户端提供的 `X-authentik-*` 请求头成为身份来源。

Homepage 的 Stock Blog 卡片使用 `https://blog.zhangzhh13.xyz/`。部署 `deploy/nginx/blog.zhangzhh13.conf` 作为该子域的独立站点，并复用现有域级 Authentik Forward Auth Provider；不要为博客再创建一套 OIDC Client，也不要保留 Basic Auth 造成双重登录。

Authentik 默认品牌的默认应用设为 `server-services`（启动地址 `https://zhangzhh13.xyz/`）。`server-services` 的代理提供者使用带有 `UserLogoutStage` 的 `default-invalidation-flow`。这样导航页的“退出登录”链接调用域级代理退出地址时，会结束 Authentik 用户会话。

由于现有账号属于 Authentik 内部用户，直接登录后仍会进入 `/if/user/`。在 Authentik 域名的 HTTPS server 块中引用 `deploy/nginx/authentik-post-login.conf`，将该入口送回服务导航页。管理后台 `/if/admin/` 保持可用。

Homepage 的 `/api/config/custom.js` 响应没有声明 UTF-8；`custom.js` 中的中文文案使用 Unicode 转义。账号姓名可能在响应头中被浏览器按单字节解码，脚本会还原其 UTF-8 字节。
