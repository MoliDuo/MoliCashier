import { type NextRequest, NextResponse } from "next/server";
import { createSourceDocumentFromCredentialRequest } from "@/modules/source-document/server/create-from-credential-request";
import { ValidationError } from "@/lib/errors";
import { readBoundedBody, RequestBodyTooLargeError } from "@/lib/http/bounded-body";
import { ApiV1HandlerFailure, handleApiV1Route } from "@/server/api-v1/request-pipeline";
import { takeSourceDocumentCreation } from "@/server/api-v1/rate-limit";
import { toApiV1SourceDocumentCreateResponse } from "@/app/api/v1/_shared/compatibility";
import {
  apiV1IdempotencyKeySchema,
  createSourceDocumentInputSchemaV1,
} from "@/modules/source-document/contract-schemas";
import { API_V1_MAX_REQUEST_BYTES } from "@/modules/source-document/api-v1-policy";

async function readBoundedJson(request: NextRequest): Promise<{ data: unknown; bytes: number }> {
  const body = await readBoundedBody(request, API_V1_MAX_REQUEST_BYTES);
  if (body == null) throw new ValidationError("Invalid JSON body");
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)) as unknown;
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
  return { data, bytes: body.length };
}

export async function POST(request: NextRequest) {
  return handleApiV1Route(request, {
    logContext: "api/v1/source-documents",
    handler: async ({ credential, request: authorizedRequest, requestId }) => {
      const bodyReadStart = performance.now();
      let bodyBytes = 0;
      let bodyReadMs = 0;
      let parseMs = 0;
      let createMs = 0;
      let imageCount = 0;
      let decodedBytes = 0;
      try {
        // Counted before anything is read, so a credential over its allowance
        // costs no body read or image decoding.
        takeSourceDocumentCreation(credential.id);

        // Validate Idempotency-Key before reading or decoding the request
        // body, so an invalid key can never trigger image decoding or uploads.
        const idempotencyHeader = authorizedRequest.headers.get("Idempotency-Key");
        let idempotencyKey: string | undefined;
        if (idempotencyHeader != null) {
          const parsedKey = apiV1IdempotencyKeySchema.safeParse(idempotencyHeader);
          if (!parsedKey.success) {
            throw new ValidationError("Validation failed", {
              issues: parsedKey.error.issues,
            });
          }
          idempotencyKey = parsedKey.data;
        }

        const body = await readBoundedJson(authorizedRequest);
        bodyBytes = body.bytes;
        bodyReadMs = performance.now() - bodyReadStart;

        const parseStart = performance.now();
        const parsed = createSourceDocumentInputSchemaV1.safeParse(body.data);
        parseMs = performance.now() - parseStart;
        if (!parsed.success) {
          throw new ValidationError("Validation failed", {
            issues: parsed.error.issues,
          });
        }
        imageCount = parsed.data.images.length;
        decodedBytes = parsed.data.images.reduce((total, image) => total + image.bytes.length, 0);

        const createStart = performance.now();
        let createResult: Awaited<ReturnType<typeof createSourceDocumentFromCredentialRequest>>;
        try {
          createResult = await createSourceDocumentFromCredentialRequest({
            credential,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            requestId,
            payload: {
              images: parsed.data.images,
              ...(parsed.data.entryDate === undefined ? {} : { entryDate: parsed.data.entryDate }),
            },
          });
        } finally {
          createMs = performance.now() - createStart;
        }

        const response = NextResponse.json(toApiV1SourceDocumentCreateResponse(createResult), {
          status: 201,
        });
        response.headers.set(
          "Location",
          `/api/v1/source-documents/${createResult.sourceDocumentId}`
        );
        return {
          response,
          metrics: {
            requestBytes: bodyBytes,
            imageCount,
            decodedBytes,
            stages: {
              bodyReadMs: Math.round(bodyReadMs),
              parseMs: Math.round(parseMs),
              createMs: Math.round(createMs),
            },
          },
        };
      } catch (error) {
        const bodyLimitHit = error instanceof RequestBodyTooLargeError;
        throw new ApiV1HandlerFailure(error, {
          requestBytes: bodyLimitHit ? error.bytesRead : bodyBytes,
          imageCount,
          decodedBytes,
          stages: {
            bodyReadMs: Math.round(
              bodyReadMs === 0 ? performance.now() - bodyReadStart : bodyReadMs
            ),
            parseMs: Math.round(parseMs),
            createMs: Math.round(createMs),
          },
        });
      }
    },
  });
}
