# 部署

Moli Cashier 部署在 Moli 服务器上的 Docker 里，地址 <https://cashier.xiangyu.pro>。推送到 `main` 后，`ci` 工作流通过，`deploy` 工作流自动构建镜像并部署。想自己托管看 [self-hosting.md](./self-hosting.md)。

## 1. 名字与用途

只写名字，不写值。

**GitHub（组织级密钥，本仓库只读取）**

| 名字                             | 用途                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `DEPLOY_SSH_KEY`                 | 部署用的 SSH 私钥，服务器上只允许它执行 `deploy-app` |
| `DEPLOY_TAILSCALE_CLIENT_ID`     | 构建机临时加入内网用的 Tailscale OAuth 客户端        |
| `DEPLOY_TAILSCALE_CLIENT_SECRET` | 同上的密钥                                           |
| `DEPLOY_SERVER`                  | 服务器在内网里的地址                                 |
| `DEPLOY_SERVER_USER`             | 部署登录用的服务器账号                               |

**服务器上 `/data/apps/cashier/.env`（权限 600，不进仓库）**

模板是 [deploy/env.example](../deploy/env.example)，变量说明见 [configuration.md](./configuration.md)。其中 `OIDC_CLIENT_ID` 是 `moli-cashier`，`OIDC_CLIENT_SECRET` 来自登录客户端的注册；`AUTH_SECRET`、`POSTGRES_PASSWORD`、S3 密钥用 `openssl rand -hex 24` 生成。更换 `AUTH_SECRET` 会让所有会话和 API 密钥失效。

## 2. 首次部署

以下步骤由管理员在服务器上做；应用仓库本身不能替自己登记。

1. 建应用目录，放入 [deploy/](../deploy) 里的文件：

   ```bash
   mkdir -p /data/apps/cashier/data && cd /data/apps/cashier
   # 从仓库复制 docker-compose.yml、migrate.cmd、pre-deploy.sh，并 chmod +x pre-deploy.sh
   cp env.example .env && chmod 600 .env   # 然后把 .env 里的占位值换成真实值
   echo APP_TAG=init > .tag
   ```

2. 先把数据库和对象存储起来（应用镜像此时还不存在，不要启动 `cashier`）：

   ```bash
   docker compose --env-file .tag up -d --wait postgres s3
   docker compose --env-file .tag up storage-bootstrap
   ```

3. 在 `/data/apps/deploy/apps` 里加一行 `cashier`，登记这个应用。
4. 登记登录客户端：客户端标识 `moli-cashier`，回调地址 `https://cashier.xiangyu.pro/auth/callback`，授权范围 `openid profile email groups`，并显式指定授权策略。把得到的密钥写进 `.env` 的 `OIDC_CLIENT_SECRET`。
5. 如果已有一套旧部署，先停掉它，再把旧的数据目录整份复制到 `/data/apps/cashier/data`（数据库和对象存储都在里面），然后核对两边的容器名没有冲突。
6. 触发部署（见第 3 节）。第一次部署会先执行 `pre-deploy.sh` 备份数据库，再迁移，再启动。
7. 创建账本：

   ```bash
   docker compose --env-file .tag exec cashier npm run ledger:create
   ```

## 3. 日常部署

- **触发**：合并或推送到 `main`。`ci` 全部通过（`ci-gate`）后，`deploy` 自动运行；`ci` 失败就不会部署。
- **确认成功**：GitHub Actions 里 `deploy` 变绿。服务器的部署脚本最后会请求 `/healthz`，核对 `version` 等于刚部署的提交，不一致就回滚并让 `deploy` 失败。
- **看版本**：

  ```bash
  curl -s https://cashier.xiangyu.pro/healthz
  ```

  期望 `{"ok":true,"version":"<40 位提交哈希>"}`。

迁移只加不删：新增表和列，要删的东西先停用，下一个版本再迁移删除。这样回滚到上一个版本时，旧代码仍能使用新结构。

## 4. 回滚

部署失败时脚本自动回到上一个版本。要手动回到更早的提交，用部署脚本的回滚入口：它直接启动服务器上已有的旧镜像（服务器保留最近 5 个），不重新构建、不做迁移，启动后同样核对 `/healthz` 的提交。先看服务器上有哪些版本可回：

```bash
docker images --format '{{.Tag}}' moli-cashier
```

再在服务器上执行（`<提交哈希>` 是上面列出的 40 位标签）：

```bash
printf '%s %s rollback\n' cashier <提交哈希> | /data/apps/deploy/deploy-app
```

服务器上没有那个镜像时，在 GitHub 里对该提交重新运行 `ci`，让它重新构建并部署。或者用 `git revert` 撤销有问题的提交，走正常的 PR 和部署。

数据库不做反向迁移。迁移前的备份在 `/data/apps/cashier/backups/`（最近 5 份），只有迁移本身损坏了数据时才用它恢复：

```bash
docker compose --env-file .tag exec -T postgres pg_restore -U cashier -d moli-cashier-db --clean --if-exists < backups/<文件名>.dump
```

## 5. 上线后的验证

1. `https://cashier.xiangyu.pro/healthz` 返回 200，`version` 是刚部署的提交。
2. 打开 <https://cashier.xiangyu.pro>，自动跳到统一登录，登录后回到账目页。
3. 上传一张小票，确认图片能显示、AI 能提取。

## 6. 常见故障

| 现象                                 | 原因和处置                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `deploy` 报"没有登记"                | 应用还没登记到允许列表（第 2 节第 3 步）。                                                                  |
| `deploy` 报"缺少 docker-compose.yml" | 应用目录没建好（第 2 节第 1 步）。                                                                          |
| 迁移失败，部署回滚                   | 看部署日志里的迁移输出；数据库在失败时保持原样。修好迁移后重新推送。                                        |
| `/healthz` 返回 503                  | 数据库连不上：看 `docker logs cashier-postgres`，核对 `.env` 里的 `DATABASE_URL` 和密码是否一致。           |
| 登录后回到登录页                     | 回调地址与登录客户端里登记的不一致，或反向代理没有传 `X-Forwarded-Proto: https`（会话 cookie 要求 HTTPS）。 |
| 登录页提示还没有账本                 | 第 2 节第 7 步没做：执行 `npm run ledger:create`。                                                          |
| 图片上传失败                         | 看 `docker logs cashier-s3` 和 `storage-bootstrap` 是否成功创建了存储桶。                                   |

## 7. 数据导出

数据都在 `/data/apps/cashier/data/` 下（`postgres` 和 `s3` 两个目录）。导出时停掉应用，整份复制；或者只导出数据库：

```bash
docker compose --env-file .tag exec -T postgres pg_dump -U cashier -Fc moli-cashier-db > cashier.dump
```
