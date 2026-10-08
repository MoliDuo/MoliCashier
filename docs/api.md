# API v1

Cashier 的 `/api/v1` 是供脚本、快捷指令和外部集成使用的公开接口。当前提供创建单据和
查询处理状态两个端点。

## 创建服务凭证

登录 Cashier，在账本设置的“API 密钥”区域创建服务凭证，并选择这个密钥写入哪个分账。
之后可以在同一区域修改密钥的分账，改动立即生效。

密钥只写入它所属的分账；没有给出 `entryDate` 时，按账本设置里的时区取当天日期。
密钥只在创建时完整显示，请立即保存；不要放进仓库、日志或截图。

所有请求使用 Bearer Token：

```http
Authorization: Bearer <token>
```

## 创建单据

```http
POST /api/v1/source-documents
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <optional-retry-key>
```

请求体：

```json
{
  "images": [
    {
      "data": "<base64 data or data URL>",
      "mimeType": "image/jpeg"
    }
  ],
  "entryDate": "2026-08-13"
}
```

- `images` 必须包含 1–3 张 JPEG、PNG、GIF 或 WebP 图片。
- 每张解码后最多 20 MiB，整个请求中图片解码后合计最多 24 MiB。服务端会把图片统一缩放、转码并剥离 EXIF；
  一次提交处理后的图片合计仍不能超过 6 MiB。
- `entryDate` 可省略；接受 `YYYY-MM-DD`，带时区的 ISO 时间会转换为日期。
- 不接受纯文字输入；网页端的文字记账不是 API v1 契约的一部分。
- `Idempotency-Key` 可省略。提供时必须为 1–512 个字符且不能全为空白；重试必须使用
  完全相同的原始值。

示例：

```bash
IMAGE_BASE64="$(base64 < receipt.jpg | tr -d '\n')"

curl --request POST "https://cashier.example.com/api/v1/source-documents" \
  --header "Authorization: Bearer $CASHIER_TOKEN" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: upload-20260813-001" \
  --data "{\"images\":[{\"data\":\"$IMAGE_BASE64\",\"mimeType\":\"image/jpeg\"}],\"entryDate\":\"2026-08-13\"}"
```

成功时返回 `201 Created`：

```json
{
  "sourceDocumentId": "00000000-0000-4000-8000-000000000000",
  "revisionId": "00000000-0000-4000-8000-000000000001",
  "revisionState": "processing",
  "status": "processing"
}
```

响应同时包含：

- `Location: /api/v1/source-documents/{sourceDocumentId}`
- `X-Request-Id`

`201` 表示图片处理、对象上传和数据库写入已经完成，不代表 AI 解析已经完成。

## 查询处理状态

```bash
curl "https://cashier.example.com/api/v1/source-documents/$SOURCE_DOCUMENT_ID" \
  --header "Authorization: Bearer $CASHIER_TOKEN"
```

```http
GET /api/v1/source-documents/{sourceDocumentId}
Authorization: Bearer <token>
```

只能查询凭证所绑定分账里的单据；单据不存在或属于其他分账时都返回 `404`。

处理中响应会返回 `Retry-After: 5`。客户端应等待后再轮询，不要持续快速请求。完成状态
包含票据当前的账目结果；异常或失败状态包含经过清理的错误信息，不会暴露内部堆栈。`status`
反映最近一次解析；在应用内拆分或整理日期后产生的票据没有解析记录，此时 `status` 为
`"completed"`，`revisionId` 为 `null`。

完成状态中的 `result.total` 使用账本主币种汇总，`result.totalCurrency` 是三位 ISO
主币种代码。各条明细仍保留原始金额和币种，金额按该币种的小数位数给出（例如 `"1000"` 日元、
`"12.50"` 人民币）。明细按票据当天的汇率折算；某条明细当天的汇率
尚未取得时，`result.total` 为 `null`，汇率补齐后再次查询即可得到总额。

失败状态通过 `error` 对象描述，成功与处理中状态为 `null`：

```json
{
  "status": "invalid",
  "result": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "这是一张退款单据，本系统只处理支出。"
  }
}
```

`status` 的取值、语义与 `Retry-After` 行为在所有失败情形下保持一致。`error.code` 恒为
非空字符串：`status` 为 `"invalid"` 时固定为 `"VALIDATION_FAILED"`，`status` 为
`"failed"` 时是稳定的失败码。`error.message` 是可选的、面向用户的自然语言说明，可能缺失
或为 `null`，客户端应仅在它非空时展示。

## 重试与幂等

网络超时不代表创建失败。重试 `POST` 时复用同一个 `Idempotency-Key`：

- 第一次请求成功后，重复请求返回已创建的同一张单据，不会再处理一次图片。响应仍是 `201`，
  但 `status`、`revisionState` 和 `revisionId` 反映单据此刻的状态：解析可能已经完成、失败或被重新提交，
  所以 `status` 可能是 `"completed"`、`"failed"`、`"invalid"` 等，`revisionId` 是最近一次解析的 id。
- key 永久有效，只在同一个服务凭证内生效；用同一个 key 提交不同的图片或日期返回 `409`。
- 单据被删除后，key 随之失效，同一个 key 会重新创建单据。
- 改变或省略 key 可能创建重复单据。
- HTTP 请求取消不会撤销服务器已经完成的上传。

## 错误

- API v1 不限流。服务凭证是 256 位随机值（早期签发的 192 位凭证仍然有效），无法猜测；轮询请按 `Retry-After` 的间隔进行。
- `401` 返回 `WWW-Authenticate: Bearer`。
- 每个响应都包含 `X-Request-Id`，报告问题时可以提供它，但不要提供 Bearer Token。

常见状态码：

| 状态码 | 含义                                           |
| ------ | ---------------------------------------------- |
| `201`  | 单据已持久化，AI 解析已排入队列                |
| `200`  | 状态查询成功                                   |
| `400`  | JSON、幂等 key、日期或图片不符合格式约束       |
| `401`  | 缺少或无法识别服务凭证，或凭证所属的分账已归档 |
| `404`  | 单据不存在，或不属于凭证绑定的分账             |
| `409`  | 同一个 `Idempotency-Key` 提交了不同的内容      |
| `413`  | 请求体超过大小上限                             |
| `500`  | 服务器无法安全生成结果                         |

API v1 当前没有计划中的 sunset，也没有 `/api/v2` 路由。公开契约以
`src/app/api/v1/` 和 `src/modules/source-document/contract-schemas.ts` 为最终事实来源。
