# 测试

原则只有一条：**直接测行为**。服务端代码跑在真实 PostgreSQL 上测，纯函数写单测，UI 测试保持少量，
外加浏览器 smoke 流程。不 mock 被测代码本身。

## 命令

| 命令                       | 内容                                          | 需要             |
| -------------------------- | --------------------------------------------- | ---------------- |
| `npm test`                 | 单元测试（unit-node、unit-dom）               | Node.js 24       |
| `npm run test:watch`       | 监视模式的单元测试                            | Node.js 24       |
| `npm run test:integration` | 集成测试（integration-node、integration-dom） | Docker           |
| `npm run test:all`         | 全部 Vitest 项目                              | Docker           |
| `npm run test:coverage`    | 全部项目加覆盖率阈值（`vitest.config.mts`）   | Docker           |
| `npm run test:prepare`     | 只检查一次测试容器能否启动并释放              | Docker           |
| `npm run test:smoke`       | Playwright smoke，桌面与移动 Chromium         | Docker、Chromium |
| `npm run test:demo`        | 在 demo 工作区上跑 `@demo` 用例               | Docker、Chromium |
| `npm run check`            | 提交前的完整门禁，包含 `test:coverage`        | Docker           |

`npm run check` 分两个阶段（`scripts/run-check.ts`）：先并行跑 `format:check`、`check:architecture`、
`check:dead-code`、`lint` 和 `tsc`（`next typegen && tsc --noEmit`），任何一项失败就停，不再进入测试；全部通过后并行跑
`test:coverage` 和 `build:check`。门禁构建设置 `CASHIER_CHECK_BUILD=1`，跳过 Next 自带的第二遍类型检查，
因为 `tsc` 已经带着生成的路由类型检查过；Docker 镜像的构建不设置它，保留 Next 自带的类型检查。每个脚本的输出在它结束时整段打印，最后一张耗时表
指出慢在哪一步。ESLint 和 Prettier 的缓存放在 `node_modules/.cache/`。

跑单个文件：`npx vitest run tests/unit/path/to/file.test.ts`。Playwright 首次使用前运行
`npx playwright install chromium`。

数据库相关的命令只需要一个运行中的 Docker daemon，不需要 `.env`、真实凭证、固定端口或手动迁移。
测试容器用 `postgres:18-alpine`，与生产的大版本一致，随机主机端口，Vitest 跑完即释放。首次运行会拉取镜像，比较慢。

## 分层

- **单元测试**不访问 PostgreSQL、网络或真实时间。纯 `.test.ts` 逻辑跑在 Node；组件测试和真正用到浏览器
  API 的测试跑在 happy-dom。外部边界（AI、网络、对象存储）mock 掉或换成内存假实现。
  AI 只有一种替身：`tests/helpers/fake-ai.ts` 的 `fakeAiTransport(responder)`，用 `setAiTransportForTests`
  装上，或用 `generateVia(transport)` 交给接收生成函数的代码；真实的 `generateStructured` 照常运行，
  所以 JSON 解析、修复和错误码都在测试覆盖之内。
- **集成测试**验证 PostgreSQL 行为、路由和 server action 的组合、事务、并发，以及落库的服务端函数。
- **每个服务端函数只有一份实现，直接测它。** 用真实数据库调用它；只 mock 它调用的外部边界，
  不 mock 数据库、仓储或同仓库的其他模块，也不写只断言调用参数的测试。
- 同一个行为只在最低的合适层级完整验证一次。上层测试只测它新增的东西：授权、校验、错误映射、组合。
- 兼容性或遗留测试要写明它保护的输入格式、迁移或兼容契约；对应的兼容代码删除时，测试一起删除。

`npm run check:dead-code` 用 knip 扫描包括测试在内的完整依赖图：没有任何引用的导出会被报出来；
只被测试用到的导出不算死代码，也不需要标注。

## 放置

`tests/unit/` 和 `tests/integration/` 镜像 `src/`：测试放在它所测源文件的对应路径。例如
`src/modules/ledger/server/books.ts` 的测试是 `tests/unit/modules/ledger/server/books.test.ts` 或
`tests/integration/modules/ledger/server/books.test.ts`；`src/app/api/...` 下的路由由同一路径下的测试覆盖。

- 一个文件覆盖多个源文件时，放在它测得最多的那个旁边；说不清时就拆开。
- `scripts/` 的测试放在 `tests/unit/scripts/` 和 `tests/integration/scripts/`。
- 少数针对整个仓库的检查（安全头、已退役的文件、共享 mock）放在 `tests/unit/repo/`，这个目录保持很小。
- `tests/helpers`、`tests/fixtures`、`tests/stubs`、`tests/setup*.ts` 和 Playwright 的 `tests/smoke/` 保持原位。

## 数据

- **迁移只有一个函数。** `src/persistence/migrate.ts` 的 `migrateDatabase()` 由 `db:migrate`、smoke 和
  测试的全局 setup 共用，基线检查 `assertBaselineReached()` 也在这里。
- **种子只有一份。** `scripts/lib/seed.ts` 用 drizzle 和 `@/persistence` 写入用户、账本、分账、分类、凭证、
  文件、票据和汇率，存储 key 用 `durableKey()` 生成；既可以传 db，也可以传事务。smoke、demo 数据和测试
  helper（`tests/helpers/schema-setup.ts`）都用它。

## 隔离

### 集成测试

- 全局 setup 只迁移一次模板库 `test_<run-id>_template`，提供给各 worker。
- 每个测试文件用 `CREATE DATABASE … TEMPLATE` 建一份自己的库 `test_<run-id>_p<pool>_w<worker>`，布局与生产一致
  （表在 `public`，迁移记录在 `drizzle`），文件结束时等它的连接关闭后删除。没有文件会重放迁移。
- unit-node、unit-dom 和 integration-node 在同一个 `sequence.groupOrder` 里并行，共用一个 worker 上限（Vitest
  要求同组一致），单元测试在容器启动时就开始跑；integration-dom 在它们之后单独跑。
- 测试容器是一次性的：数据目录在 tmpfs 上，并关闭 `fsync`、`synchronous_commit` 和 `full_page_writes`。
- 每个用例之前，setup 在 `session_replication_role = replica` 下逐表 `DELETE`，一次往返清空这份库里的所有表（包括
  用例自己建的表），外键和变更日志触发器都不触发，效果等同 `TRUNCATE … CASCADE`，但不用重写表文件。无权设置这个
  参数的角色（可能出现在 `TEST_DATABASE_URL` 下）改用 `TRUNCATE`。
- 不同的运行从不共享数据库。无论正常结束、失败还是被中断，runner 只删除带自己运行前缀的库。
- 同一文件内的测试串行执行，因为 setup 会在测试之间清空这份库。数据库测试里不要用 `test.concurrent` 或
  `describe.concurrent`，除非先做到用例级隔离。
- `TEST_DATABASE_URL` 是显式的高级覆盖，永远不会回退到 `DATABASE_URL`。它必须是库名以 `_test` 结尾的
  PostgreSQL 地址，用户必须能建库；模板库和各文件的副本建在它旁边，结束后删除。连接或校验失败直接中止，
  不会改去启动本地容器。清理时先列出带运行前缀的库，从不删除指定的库或别的运行的库。

### 网络

每个测试 worker 安装 MSW 网络守卫。共享的确定性 handler 覆盖后台 OpenAI 的失败路径和 Frankfurter 汇率
fixture；测试可以另加针对用例的 handler。其他任何未处理的 HTTP 请求都会让测试失败，即使应用代码捕获了
这个错误。诊断信息只含 `TEST_UNEXPECTED_HTTP`、方法和 origin，不含路径、查询参数、凭证和请求体。

### 后台工作

测试环境不启动 worker 和调度器（`NODE_ENV === "test"`），所以没有任何东西在测试之外悄悄运行。需要后台工作
跑完的测试显式调用 `tests/helpers/background.ts` 的 `drainBackground()`：它对数据库里到期的提取和分类工作
反复执行 `worker.runOnce()`，直到没有工作为止，返回时所有写入都已经完成。提交事务后调用的
`requestBackgroundWork()` 在没有订阅者时什么也不做，所以服务端函数的测试不必关心它。worker、调度器、
advisory lock 和停机交还各有自己的测试；调度器测试用 fake timer 和可注入的"立即运行"函数，不碰真实时间。
不要在清空数据库时加死锁重试来掩盖未完成的工作：测试结束前要么 `drainBackground()`，要么没有后台工作。

## 浏览器 smoke

`tests/smoke/` 用 Playwright 跑在生产构建上，经过真实的浏览器、认证、server action 和 PostgreSQL 边界。

- 每次运行启动临时 PostgreSQL 容器，建一个唯一命名的 `smoke_<uuid>` 库，执行真实迁移，再用
  `scripts/lib/seed.ts` 写入一个账本、两个分账和几个分类。用例需要的账单和会话一样，直接写进这个库。不会迁移、写入或清空任何已有的库。
- 桌面和移动场景串行运行，每个场景用新的浏览器上下文。
- 没有 dev 旁路，也不连真实的认证服务、AI 或对象存储。认证服务是 `scripts/smoke-oidc-server.ts` 的本地假 OIDC 提供方
  （`OIDC_ISSUER_URL` 指向它）：有 discovery、JWKS、授权、令牌（校验客户端密钥和 PKCE）和 userinfo 端点，
  没有登录表单，由 `POST /__sign-in-as` 指定"当前已登录的用户"。
- `oidc-sign-in.spec.ts` 走完整的跳转：未登录打开页面自动登录、退出后停在 `/login` 不被登回、
  提供方任意放行的邮箱都能进、提供方拒绝停在错误页而不循环；其余用例直接在数据库里开一个会话。
- 集成测试用同一个假提供方（`tests/helpers/oidc-provider.ts` 在回环端口上启动它）测 `oidc.ts` 和两个路由：
  state、PKCE、nonce、过期、重放和只有 userinfo 带邮箱的情况。
- 覆盖账本访问、新建记录、编辑、刷新后仍在、删除、退出登录、受保护页面的跳转，以及新建记录的草稿恢复、
  账单字段和设置的即时保存、拆分后新账单替换当前详情、浏览器后退不再弹确认。
- 失败时截图和 trace 留在 `test-results/`，报告在 `playwright-report/`。

`npm run test:demo` 在 demo 工作区（`npm run dev:demo` 的同一套数据）上跑带 `@demo` 标签的用例。

## 提示词基准

`scripts/bench/` 用真实票据评测 AI 提示词。它直接调用线上的函数（解析任务调用 `runParsePipeline`），所以测的就是
应用发出的那份提示词。它**不属于 `npm run check`**：每次运行都要花钱，温度默认为 1 所以结果会变，也需要真实的
AI 凭证。

| 命令                                       | 内容                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `npm run bench:prompt -- --task parse`     | 跑一个任务；`--repeat`、`--concurrency`、`--model`、`--rule`、`--baseline` |
| `npm run bench:prompt -- --dry-run`        | 只加载并校验用例，不调用模型                                               |
| `npm run bench:data -- verify`             | 用 `scripts/bench/manifest.json` 校验数据目录                              |
| `npm run bench:data -- manifest`           | 数据增删或修正后重写清单                                                   |
| `npm run bench:migrate -- --from <旧项目>` | 一次性：把旧 promptfoo 项目的金标迁移过来                                  |

### 数据

数据是真实票据，含姓名、卡号尾号和地址，**任何 git 仓库都不能提交它**。它放在仓库之外，目录由环境变量
`CASHIER_BENCH_DATA_DIR`（绝对路径）指定；目录落在任何 git 仓库之内时脚本直接拒绝运行。数据目录要自己备份，仓库里没有它的副本。

文档和标注分开，多个任务共用同一份文档（图片只存一份）：

```
$CASHIER_BENCH_DATA_DIR/
  documents/<id>/document.json     输入：文字、图片（文件名和 sha256）、账本的分类和设置
  documents/<id>/evidence/<文件>
  annotations/<任务>/<id>.json     某个任务对该文档的期望答案和标签
  results/                         每次运行的完整结果（含期望和实际金额）
```

标注文件的 `labels` 有三个互相独立的维度：`status`（`gold` 默认参与运行，`candidate`、`needs-fix` 不参与）、
`rules`（覆盖哪条提示词规则，如 `refund-stacked`，报告按它分组）、`provenance` 加 `humanCorrected`。

仓库提交的只有 `scripts/bench/manifest.json`：每份 `document.json` 和标注文件的 sha256。`document.json` 又固定了每张图片的 sha256，
所以一条记录就锁定整个输入。运行前会按清单校验要跑的用例，数据被改动或损坏时拒绝运行；新增的用例清单里没有时只给警告。

### 解析任务的评分

一个用例通过，要求 outcome 正确，且成功文档的每个（币种，分类）合计与期望一致。按合计而不是逐条比，因为同一张票据
拆成怎样的条目（商品和费用是否合并）并不影响账本是否正确。条目的 precision 和 recall 一并报告，
能看出靠运气过关的用例。每个用例默认跑 3 次，报告通过率并区分"总是过"、"总是不过"和"不稳定"。

终端报告只打印用例 id 和比例；期望和实际金额只写进 `results/` 下的结果文件。
