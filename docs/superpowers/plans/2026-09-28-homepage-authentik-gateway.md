# Homepage and Authentik Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Homepage at `zhangzhh13.xyz`, move TickFlow to `stonepanel.zhangzhh13.xyz`, and protect every public web service with one self-hosted Authentik login.

**Architecture:** Host Nginx remains the only public web gateway. Homepage and Authentik run in isolated Docker Compose stacks bound to loopback; Nginx uses Authentik domain-level Forward Auth before proxying Homepage, StonePanel, and the existing path-based applications. Existing business containers remain otherwise unchanged, then their public port bindings are narrowed after authenticated routes pass canary tests.

**Tech Stack:** Nginx, Docker Compose v2, Homepage, Authentik 2026.8 stable lifecycle compose, PostgreSQL, Certbot, PowerShell/SSH, Python `unittest`, YAML configuration.

**Spec:** `docs/superpowers/specs/2026-09-28-homepage-authentik-gateway-design.md`

## Global Constraints

- `https://zhangzhh13.xyz/` must serve Homepage.
- `https://stonepanel.zhangzhh13.xyz/` must serve TickFlow Stock Panel.
- `https://auth.zhangzhh13.xyz/` must serve Authentik.
- `www.zhangzhh13.xyz` must permanently redirect to `zhangzhh13.xyz` while preserving the request URI.
- All ordinary users have the same access to every protected service; only the Authentik administrator can enter the administration interface.
- Nginx is the only public Web entry point; application and database ports bind to loopback or an internal Docker network.
- Authentik uses a fixed stable version, never `latest`; Server, Worker, and Outpost versions must match.
- Authentik uses a dedicated PostgreSQL database and does not mount the Docker socket.
- Existing business applications must not be upgraded as part of this change.
- Nginx changes must pass `nginx -t` before reload and must have a timestamped rollback copy.
- Authentik failure must fail closed; it must never silently bypass authentication.
- Secrets stay in permission-restricted server files and never enter Git.

## Review Focus

- A request without a session, including a deep link and query string, must return to the exact original URL after login; Task 3 pins the redirect construction and Task 6 tests it externally.
- WebSocket, SSE, uploads, and long requests must retain their existing proxy semantics after Forward Auth is added; Tasks 3 and 7 test representative headers and routes.
- A client must not bypass authentication through ports `3018`, `8000`, `8899`, or RPC `111`; Task 8 tests all four from outside the server.
- Authentik restart or database persistence must not lose users, providers, or outpost configuration; Tasks 2 and 5 test volume persistence and restart behavior.
- A certificate or DNS mismatch for `auth` or `stonepanel` must stop cutover rather than expose a broken login loop; Tasks 4 and 6 define hard preflight gates.

---

## File Structure

The implementation adds a deployment overlay without modifying Homepage application source:

- `deploy/homepage/compose.yaml` — loopback-only Homepage container and health check.
- `deploy/homepage/config/settings.yaml` — site title, layout, language, and theme.
- `deploy/homepage/config/services.yaml` — service groups and canonical URLs.
- `deploy/homepage/config/widgets.yaml` — greeting, date/time, and search widgets.
- `deploy/homepage/config/bookmarks.yaml` — intentionally empty valid bookmarks configuration.
- `deploy/homepage/config/docker.yaml` — intentionally empty; no Docker socket discovery.
- `deploy/homepage/config/custom.css` — minimal local visual adjustments.
- `deploy/homepage/config/custom.js` — intentionally empty.
- `deploy/authentik/README.md` — exact pinned-compose retrieval, secret creation, startup, backup, and restore commands.
- `deploy/nginx/authentik-forward-auth.conf` — reusable Forward Auth snippets and upgrade maps.
- `deploy/nginx/zhangzhh13.conf` — canonical domain, Authentik, StonePanel, Homepage, and existing path routes.
- `deploy/tests/test_deployment_config.py` — static assertions for URLs, loopback bindings, protected locations, redirects, and forbidden public ports.
- `deploy/scripts/verify-public.ps1` — external HTTP and TCP acceptance checks.

### Task 1: Homepage deployment overlay

**Files:**
- Create: `deploy/homepage/compose.yaml`
- Create: `deploy/homepage/config/settings.yaml`
- Create: `deploy/homepage/config/services.yaml`
- Create: `deploy/homepage/config/widgets.yaml`
- Create: `deploy/homepage/config/bookmarks.yaml`
- Create: `deploy/homepage/config/docker.yaml`
- Create: `deploy/homepage/config/custom.css`
- Create: `deploy/homepage/config/custom.js`
- Create: `deploy/tests/test_deployment_config.py`

**Interfaces:**
- Consumes: canonical URLs from the approved spec.
- Produces: Homepage HTTP endpoint `http://127.0.0.1:3000`, Docker health status, and a checked-in configuration tree copied unchanged to `/opt/homepage`.

- [ ] **Step 1: Write failing configuration tests**

Create Python `unittest` cases that load the deployment files as text and assert:

```python
self.assertIn('127.0.0.1:3000:3000', compose)
self.assertNotIn('/var/run/docker.sock', compose)
self.assertIn('https://stonepanel.zhangzhh13.xyz/', services)
self.assertIn('https://zhangzhh13.xyz/czsc/', services)
self.assertIn('https://zhangzhh13.xyz/quant/', services)
self.assertIn('https://zhangzhh13.xyz/blog/', services)
self.assertIn('https://zhangzhh13.xyz/daily-stock-analysis/', services)
self.assertIn('https://zhangzhh13.xyz/vibe-trading/', services)
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m unittest deploy.tests.test_deployment_config -v`

Expected: FAIL because the deployment files do not exist.

- [ ] **Step 3: Add the minimal Homepage stack**

Use `ghcr.io/gethomepage/homepage:latest` only for Homepage, whose upstream publishes rolling application images; bind `127.0.0.1:3000:3000`, mount `./config:/app/config`, set `HOMEPAGE_ALLOWED_HOSTS=zhangzhh13.xyz`, and add a health check against `http://127.0.0.1:3000/api/healthcheck`. Do not mount the Docker socket.

Configure six navigation cards with canonical URLs. Use the groups `核心面板`, `分析工具`, and `内容`; include Authentik user portal under `系统`. Set Chinese locale, a dark slate theme, four-column desktop layout, and a compact mobile layout. Do not store API keys.

- [ ] **Step 4: Run static tests and Compose validation**

Run:

```powershell
python -m unittest deploy.tests.test_deployment_config -v
docker compose -f deploy/homepage/compose.yaml config --quiet
```

Expected: all tests PASS and Compose exits 0.

- [ ] **Step 5: Commit**

```powershell
git add deploy/homepage deploy/tests/test_deployment_config.py
git commit -m "feat: add Homepage deployment configuration"
```

### Task 2: Authentik pinned deployment procedure

**Files:**
- Create: `deploy/authentik/README.md`
- Modify: `deploy/tests/test_deployment_config.py`

**Interfaces:**
- Consumes: `/opt/authentik`, loopback ports `9000` and `9443`, and the Authentik 2026.8 lifecycle Compose URL.
- Produces: repeatable commands for an Authentik Server, Worker, and PostgreSQL stack with persistent volumes, generated secrets, no Docker socket, and database backup/restore.

- [ ] **Step 1: Add failing Authentik procedure tests**

Assert the README contains the pinned lifecycle URL, `AUTHENTIK_SECRET_KEY`, `PG_PASS`, loopback Compose port overrides, Docker-socket removal, `pg_dump`, and a restore command. Assert it does not instruct the operator to use `:latest`.

- [ ] **Step 2: Run the focused tests**

Run: `python -m unittest deploy.tests.test_deployment_config.DeploymentConfigTests.test_authentik_procedure -v`

Expected: FAIL because the procedure does not exist.

- [ ] **Step 3: Write exact installation and recovery commands**

The procedure must specify:

```bash
install -d -m 700 /opt/authentik
cd /opt/authentik
curl -fsSLo compose.yml https://goauthentik.io/version/2026.8/lifecycle/container/compose.yml
grep -n ':latest' compose.yml && exit 1 || true
printf 'PG_PASS=%s\n' "$(openssl rand -base64 36 | tr -d '\n')" > .env
printf 'AUTHENTIK_SECRET_KEY=%s\n' "$(openssl rand -base64 60 | tr -d '\n')" >> .env
printf 'COMPOSE_PORT_HTTP=127.0.0.1:9000\nCOMPOSE_PORT_HTTPS=127.0.0.1:9443\n' >> .env
chmod 600 .env
```

Remove the Worker Docker socket mount from the downloaded Compose file, then require `docker compose config --quiet`, `docker compose pull`, and `docker compose up -d`. Document `docker compose exec -T postgresql pg_dump -U authentik -d authentik -cC` for backup and the matching `psql` restore command. Do not include generated secret values in the repository.

- [ ] **Step 4: Run tests**

Run: `python -m unittest deploy.tests.test_deployment_config -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add deploy/authentik/README.md deploy/tests/test_deployment_config.py
git commit -m "docs: add pinned Authentik deployment procedure"
```

### Task 3: Nginx target configuration

**Files:**
- Create: `deploy/nginx/authentik-forward-auth.conf`
- Create: `deploy/nginx/zhangzhh13.conf`
- Modify: `deploy/tests/test_deployment_config.py`

**Interfaces:**
- Consumes: Authentik at `127.0.0.1:9000`, Homepage at `127.0.0.1:3000`, and existing application ports `3018`, `3020`, `3091`, `32002`, `8000`, and `8899`.
- Produces: Nginx virtual hosts for `auth`, `stonepanel`, apex, and `www`; a named include that applies Forward Auth consistently while preserving existing proxy behavior.

- [ ] **Step 1: Add failing Nginx assertions**

Test that the target configuration contains all three server names, canonical `www` redirect, `auth_request /outpost.goauthentik.io/auth/nginx`, public `/outpost.goauthentik.io` handling, the domain-level sign-in URL, WebSocket upgrade handling, identity header removal/replacement, and no `auth_basic` directive. Test that each protected upstream is paired with the auth include.

- [ ] **Step 2: Run the focused test**

Run: `python -m unittest deploy.tests.test_deployment_config.DeploymentConfigTests.test_nginx_routes_are_protected -v`

Expected: FAIL because the Nginx files do not exist.

- [ ] **Step 3: Create the Forward Auth include**

Follow Authentik's standalone Nginx domain-level template. The include must:

```nginx
auth_request /outpost.goauthentik.io/auth/nginx;
error_page 401 = @goauthentik_proxy_signin;
auth_request_set $auth_cookie $upstream_http_set_cookie;
add_header Set-Cookie $auth_cookie always;
auth_request_set $authentik_username $upstream_http_x_authentik_username;
auth_request_set $authentik_groups $upstream_http_x_authentik_groups;
proxy_set_header X-authentik-username $authentik_username;
proxy_set_header X-authentik-groups $authentik_groups;
```

At the server level, expose `/outpost.goauthentik.io` to `http://127.0.0.1:9000/outpost.goauthentik.io` without authenticating that location. The named sign-in location must redirect to:

```nginx
return 302 https://auth.zhangzhh13.xyz/outpost.goauthentik.io/start?rd=$scheme://$ak_http_host$request_uri;
```

Discard client-supplied `X-authentik-*` identity headers before setting trusted values returned by the outpost.

- [ ] **Step 4: Create complete virtual hosts**

Preserve the current per-application proxy rules and timeouts. Route the apex `/` to Homepage, StonePanel `/` to `3018`, and Authentik to `9000`. Add authenticated apex locations for `/czsc/`, `/quant/`, `/blog/`, `/daily-stock-analysis/`, and `/vibe-trading/`. Remove Basic Auth from Blog only in the target file. Redirect `www` to the apex with status 308 and `$request_uri`.

- [ ] **Step 5: Validate static behavior**

Run:

```powershell
python -m unittest deploy.tests.test_deployment_config -v
docker run --rm -v "${PWD}/deploy/nginx/zhangzhh13.conf:/etc/nginx/conf.d/zhangzhh13.conf:ro" -v "${PWD}/deploy/nginx/authentik-forward-auth.conf:/etc/nginx/snippets/authentik-forward-auth.conf:ro" nginx:stable nginx -t
```

Expected: tests PASS. If the container-only `nginx -t` reports only missing production certificate paths, repeat validation on the server staging path in Task 6; syntax errors are not acceptable.

- [ ] **Step 6: Commit**

```powershell
git add deploy/nginx deploy/tests/test_deployment_config.py
git commit -m "feat: add authenticated Nginx gateway configuration"
```

### Task 4: DNS, TLS, capacity, and rollback preflight

**Files:**
- Create: `deploy/scripts/verify-public.ps1`
- Modify: `deploy/tests/test_deployment_config.py`

**Interfaces:**
- Consumes: SSH alias `mobilecloud-deploy`, public IP `36.212.8.4`, and DNS names `auth.zhangzhh13.xyz` and `stonepanel.zhangzhh13.xyz`.
- Produces: a no-change preflight report, a timestamped Nginx backup path, and a hard pass/fail gate before deployment.

- [ ] **Step 1: Add a failing script-content test**

Assert the PowerShell verifier checks DNS A records, TLS hostnames, unauthenticated redirect behavior, authenticated requests when `-SessionCookie` is supplied, and TCP ports `111`, `3018`, `8000`, and `8899`.

- [ ] **Step 2: Implement the external verifier**

Parameters must be `-ServerIp`, `-SessionCookie`, and `-Phase` where Phase is `Preflight` or `Final`. Preflight requires both new names to resolve to the server's public address and reports current port exposure. Final requires the four unsafe ports to reject connections, verifies `www` redirects to the apex, and verifies protected routes redirect to Authentik without a cookie.

- [ ] **Step 3: Run preflight without changing the server**

Run:

```powershell
python -m unittest deploy.tests.test_deployment_config -v
Resolve-DnsName auth.zhangzhh13.xyz -Type A
Resolve-DnsName stonepanel.zhangzhh13.xyz -Type A
ssh mobilecloud-deploy "free -h; df -h /; docker system df; nginx -t"
```

Expected: both DNS names resolve to the production server, at least 4 GiB memory remains available, at least 8 GiB disk remains free, and current Nginx syntax passes. If DNS does not point to the production server, stop and have the DNS owner create the two A records before continuing.

- [ ] **Step 4: Create the rollback backup**

Run on the server:

```bash
backup_dir=/root/gateway-backups/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$backup_dir"
cp -a /etc/nginx "$backup_dir/nginx"
docker inspect TickFlow_Stock_Panel stock-server vibe-trading-vibe-trading-1 > "$backup_dir/docker-inspect.json"
printf '%s\n' "$backup_dir"
```

Expected: command prints one exact backup directory containing Nginx and container metadata.

- [ ] **Step 5: Expand the existing certificate**

After DNS passes, run:

```bash
certbot certonly --nginx --cert-name zhangzhh13.xyz --expand \
  -d zhangzhh13.xyz -d www.zhangzhh13.xyz \
  -d auth.zhangzhh13.xyz -d stonepanel.zhangzhh13.xyz
certbot certificates
```

Expected: the `zhangzhh13.xyz` certificate lists all four names and remains renewable.

- [ ] **Step 6: Commit the verifier**

```powershell
git add deploy/scripts/verify-public.ps1 deploy/tests/test_deployment_config.py
git commit -m "test: add gateway preflight and public verification"
```

### Task 5: Deploy internal Homepage and Authentik services

**Files:**
- Deploy local `deploy/homepage/*` to server `/opt/homepage/`.
- Deploy the procedure in `deploy/authentik/README.md` to server `/opt/authentik/`.

**Interfaces:**
- Consumes: Task 1 and Task 2 artifacts.
- Produces: healthy loopback services on ports `3000`, `9000`, and `9443`, plus initialized Authentik administrator and test user accounts.

- [ ] **Step 1: Copy and validate Homepage**

Use `scp` to place the checked-in Homepage directory at `/opt/homepage`, then run `docker compose config --quiet`, `docker compose pull`, and `docker compose up -d`. Verify `curl -fsS http://127.0.0.1:3000/api/healthcheck` and `docker compose ps` report healthy.

- [ ] **Step 2: Install Authentik from the pinned lifecycle compose**

Execute the commands in `deploy/authentik/README.md`, confirm there is no Docker socket mount, and start the stack. Verify ports `9000` and `9443` listen only on `127.0.0.1` and all three services are healthy.

- [ ] **Step 3: Complete Authentik initial setup**

Temporarily reach `http://127.0.0.1:9000/if/flow/initial-setup/` through an SSH tunnel. Have the user set the `akadmin` password interactively so it is never printed or stored in shell history. Create one non-superuser test account and the group `服务用户`; add the test account to that group.

- [ ] **Step 4: Configure domain-level Forward Auth**

In Authentik, create application `服务器服务`, create a Proxy Provider in `Forward auth (domain level)` mode, set Authentication URL to `https://auth.zhangzhh13.xyz`, and set Cookie domain to `zhangzhh13.xyz`. Attach it to the embedded outpost. Leave application policy bindings empty so all authenticated users can access the protected domain, while keeping the test account non-superuser.

- [ ] **Step 5: Verify persistence and fail-closed prerequisites**

Restart the Authentik Compose stack. Confirm the test user, group, application, provider, and embedded-outpost assignment remain present. Run `curl -i http://127.0.0.1:9000/outpost.goauthentik.io/ping` and expect 204. Stop only `authentik-server`, confirm the outpost endpoint becomes unavailable, then start it and confirm recovery; do not change Nginx yet.

### Task 6: Publish Authentik and a protected Homepage canary

**Files:**
- Stage: `/etc/nginx/snippets/authentik-forward-auth.conf`
- Stage: `/etc/nginx/conf.d/zhangzhh13.next.conf.disabled`

**Interfaces:**
- Consumes: healthy internal services, valid four-name certificate, Task 3 Nginx files.
- Produces: public Authentik plus a temporary authenticated canary hostname or path that does not replace the production root.

- [ ] **Step 1: Stage and syntax-check Nginx files**

Copy the Forward Auth include and target virtual-host file to disabled staging names. Replace production certificate paths only if Certbot returned a different path. Run `nginx -t` against an explicit temporary config that includes the staged files; do not reload on failure.

- [ ] **Step 2: Publish only the Authentik virtual host**

Extract the `auth.zhangzhh13.xyz` server block into an enabled temporary config, run `nginx -t`, and reload. Verify HTTPS certificate hostname, login page, and `/outpost.goauthentik.io/ping` status 204.

- [ ] **Step 3: Add a protected canary route**

Add `/__homepage-canary/` on the apex that proxies to `127.0.0.1:3000`, applies Forward Auth, and is not linked publicly. Run `nginx -t`, reload, and verify an anonymous request redirects through Authentik while preserving the full canary URL and query string.

- [ ] **Step 4: Test with the ordinary account**

Log in as the non-superuser test account. Verify Homepage renders, Authentik admin returns forbidden or hides administration, a deep link returns correctly after login, and logout invalidates subsequent canary access.

- [ ] **Step 5: Test Authentik failure behavior**

While keeping an authenticated browser session, stop Authentik Server and request the canary. Expected: Nginx returns an authentication/upstream error and does not serve Homepage. Restart Authentik and verify the canary recovers.

### Task 7: Gateway cutover and application compatibility

**Files:**
- Replace: `/etc/nginx/conf.d/zhangzhh13.conf`
- Install: `/etc/nginx/snippets/authentik-forward-auth.conf`

**Interfaces:**
- Consumes: passed canary, target configuration, timestamped backup.
- Produces: Homepage on the apex, StonePanel on its subdomain, all existing apps protected, and `www` canonicalized.

- [ ] **Step 1: Install the target config atomically**

Copy both files to temporary names on the same filesystem, set owner `root:root` and mode `0644`, then rename them into place. Run `nginx -t`; reload only after success. Remove the canary-only config after the target root is live.

- [ ] **Step 2: Verify anonymous behavior**

For the apex, StonePanel, CZSC, Quant, Blog, Daily Stock Analysis, and Vibe Trading, use a fresh cookie jar and verify each redirects to `auth.zhangzhh13.xyz`. Verify `www` returns a permanent redirect to the same path on the apex. Verify Blog no longer presents Basic Auth.

- [ ] **Step 3: Verify authenticated application behavior**

With the ordinary test account, open every service and inspect browser network failures. Exercise one representative API request for each app, Quant and Vibe Trading streaming/SSE behavior, any existing WebSocket route, one upload or POST where supported, and a direct refresh on a nested route.

- [ ] **Step 4: Verify unified logout**

Navigate to `https://auth.zhangzhh13.xyz/outpost.goauthentik.io/sign_out`, then request the apex and StonePanel again. Expected: both require login.

- [ ] **Step 5: Roll back on any blocking incompatibility**

If any required application flow fails, restore `/etc/nginx` from the Task 4 backup, run `nginx -t`, reload, and verify the original root and paths. Keep the new containers stopped but preserve their volumes for diagnosis.

### Task 8: Close bypass ports and complete acceptance checks

**Files:**
- Modify on server: `/opt/tickflow-stock-panel/docker-compose.yml`
- Modify on server: `/opt/vibe-trading/docker-compose.public.yml`
- Modify on server: the active Daily Stock Analysis Compose override that publishes `8000`
- Create on server: timestamped copies beside each modified Compose file.

**Interfaces:**
- Consumes: fully passed Task 7 gateway.
- Produces: loopback-only business ports, no public RPC service, external acceptance evidence, and a tested Authentik database backup.

- [ ] **Step 1: Add loopback port bindings with per-file backups**

Back up each Compose file before editing. Set TickFlow to `HOST=127.0.0.1`, replace Vibe Trading `8899:8899` with `127.0.0.1:8899:8899`, and replace Daily Stock Analysis `8000:8000` with `127.0.0.1:8000:8000` in its active publishing definition. Run `docker compose config` for each stack before recreation.

- [ ] **Step 2: Recreate only affected application containers**

Run each stack's existing Compose command with its current override list and `up -d --no-deps` for the application service. Do not rebuild or pull new images. Verify all containers return healthy and Nginx routes continue working.

- [ ] **Step 3: Remove public RPC exposure safely**

Run `findmnt -t nfs,nfs4` and `rpcinfo -p`. If no NFS mount or required RPC consumer exists, run `systemctl disable --now rpcbind.socket rpcbind.service` and verify port `111` is absent from `ss -lntup`. If RPC is required, do not stop it; bind it to loopback using the operating system's existing rpcbind options file, restart it, and verify only `127.0.0.1:111` and `[::1]:111` remain.

- [ ] **Step 4: Run final external verification**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/scripts/verify-public.ps1 \
  -ServerIp 36.212.8.4 -Phase Final
```

Expected: `22`, `80`, and `443` remain reachable; `111`, `3018`, `8000`, and `8899` reject connections; anonymous Web requests redirect to Authentik; `www` redirects to the apex.

- [ ] **Step 5: Create and inspect the first Authentik backup**

Run the documented `pg_dump` command to a root-readable file under `/opt/authentik/backups/`, verify it is non-empty, and use `pg_restore --list` or `psql` text inspection as appropriate to confirm it contains schema and data. Set backup files to mode `0600`.

- [ ] **Step 6: Reboot-resilience check**

Restart the four new containers and the three affected business containers without changing images. Verify health, Nginx routes, login, and persisted accounts. Do not reboot the entire server during initial rollout unless the user explicitly schedules a maintenance window.

- [ ] **Step 7: Commit any final repository corrections**

If verification required repository changes, rerun all local tests and commit only those deployment files:

```powershell
python -m unittest deploy.tests.test_deployment_config -v
git add deploy
git commit -m "fix: align gateway deployment with production verification"
```

Expected: clean working tree for deployment artifacts; unrelated user changes remain untouched.
