# Moli Cashier

<img src="./public/icon.svg" alt="Moli Cashier 图标" width="64" align="right">

> 把小票、发票和一句话，变成可核对的个人账本。

[![ci](https://github.com/MoliDuo/MoliCashier/actions/workflows/ci.yml/badge.svg)](https://github.com/MoliDuo/MoliCashier/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

![Moli Cashier 账目页面](./public/readme/stream-desktop.webp)

Moli Cashier 最初只是我给自己做的记账工具：拍下小票，或者随手写一句“午饭 35 元”，剩下的整理工作交给 AI。
它是为实际在用的两个人写的。以 AGPL 发布，是为了让想要它的人可以 fork 过去改成自己的样子，而不是要把它
改得适合所有人。欢迎报告 bug；功能请求多半会得到"fork 吧，那样更适合你"的回答。

Moli Cashier 会从图片或文字中提取日期、商家、金额、币种、分类和消费明细。AI 的结果不是不可触碰的黑盒：
你可以在入账前后检查、修改、重新处理，并在账目和统计中继续管理这些账单。

## 功能

- 上传小票、发票图片，或直接输入自然语言记账
- 提取账单标题、日期、金额、币种、分类和明细
- 复核和编辑 AI 结果，处理识别失败的账单
- 管理多币种消费，并按账本主币种查看汇总；用分账把账目分开看，总账看全部
- 在账目里按账单或按明细回看、筛选，在统计图表里看支出的去向和走势
- 创建绑定分账的 API 密钥，供脚本、快捷指令和外部集成使用（见 [API v1](./docs/api.md)）
- 中文界面；AI 可以按设置用其他语言填写账单内容

<picture>
  <source media="(max-width: 600px)" srcset="./public/readme/entry-mobile.webp">
  <img alt="Moli Cashier 智能记账界面" src="./public/readme/entry-mobile.webp" width="390">
</picture>

## 使用前请知道

> **项目状态：早期公开版本**

- 这个项目源于个人使用，还没有正式稳定版或兼容性承诺。
- AI 可能误读票据或错误分类，重要账目请在入账后人工复核。
- 自己托管的，升级前请备份 PostgreSQL 数据库和对象存储。
- AI 解析需要联网，并依赖可用的 OpenAI 或 OpenAI 兼容接口。
- Moli Cashier 是记账工具，不提供会计、税务或财务建议。

## 安装或访问

- 线上地址：见 `moli.yaml` 的 `deploy.domain`（需要先由管理员在认证服务里放行你的账号）。
- 想自己跑一份：见 [docs/self-hosting.md](./docs/self-hosting.md)，环境变量见 [docs/configuration.md](./docs/configuration.md)。

先在本地试一试，不碰任何真实服务（需要 Node.js 24 和 Docker）：

```bash
npm ci
npm run dev:demo
```

打开终端打印的本地地址，选择 `Continue as dev`。启动信息里列出了预置的示例 API 密钥，每个都标注了
它写入的分账。`docker-compose.demo.yml` 启动专用的 `cashier-demo` PostgreSQL 和对象存储，迁移
`cashier_demo` 数据库，并写入虚构的票据和历史；AI 由本地假服务代替，登录用 dev 旁路。每次启动都会先打印重建目标，
再把工作区恢复成初始数据，上一次的修改不会保留。

```bash
npm run demo:reset            # 只预览目标
npm run demo:reset -- --apply # 重建 dev@cashier.local 的专用数据
```

默认端口为应用 `3000`、PostgreSQL `55433`、对象存储 `59000`，可用 `CASHIER_DEMO_APP_PORT`、
`CASHIER_DEMO_POSTGRES_PORT`、`CASHIER_DEMO_S3_PORT` 覆盖。

## 登录方式

通过 Moli 的统一登录（OIDC，Authelia）登录，应用本身没有账号和密码；谁能登录由认证服务决定。
本地开发可以设置 `DEV_AUTH_BYPASS=true` 直接以开发身份进入。

## 部署

推送到 `main`，`ci` 通过后由 `deploy` 自动部署到 Moli 服务器。首次部署、回滚和故障处理见 [docs/deploy.md](./docs/deploy.md)。

## 开发

- 代码结构、依赖方向、数据与并发约定、前端交互约定：[docs/architecture.md](./docs/architecture.md)
- 测试的放置、隔离和运行方式：[docs/testing.md](./docs/testing.md)
- 提交、门禁和代理（agent）约定：[AGENTS.md](./AGENTS.md)

提交改动前运行完整门禁：

```bash
npm run check
```

它先并行做静态检查：格式、架构（dependency-cruiser）、死代码（knip）、lint、类型，任何一项失败就停下；
再同时跑带覆盖率的全部测试，和一次用隔离占位配置的生产构建（顺带报告受保护路由的包体积）。集成测试需要 Docker。

| 命令                    | 用途                           |
| ----------------------- | ------------------------------ |
| `npm run dev`           | 启动开发服务器                 |
| `npm run dev:demo`      | 启动独立的 demo 工作区         |
| `npm run docker:local`  | 启动本地 PostgreSQL 和对象存储 |
| `npm run docker:down`   | 停止本地基础服务，保留具名卷   |
| `npm run db:migrate`    | 对当前 `DATABASE_URL` 应用迁移 |
| `npm run ledger:create` | 创建账本、分账和默认分类       |
| `npm test`              | 单元测试                       |
| `npm run test:all`      | 单元测试和集成测试             |
| `npm run test:smoke`    | Playwright 浏览器 smoke 测试   |
| `npm run check`         | 提交前的完整门禁               |

## 许可

Moli Cashier 使用 [GNU Affero General Public License v3.0](./LICENSE)。
