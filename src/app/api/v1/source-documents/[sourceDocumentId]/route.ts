import { type NextRequest, NextResponse } from "next/server";
import { handleApiV1Route } from "@/server/api-v1/request-pipeline";
import { getCredentialSourceDocumentStatus } from "@/modules/source-document/server/credential-status";
import { sourceDocumentIdSchema } from "@/modules/source-document/contract-schemas";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sourceDocumentId: string }> }
) {
  return handleApiV1Route(request, {
    logContext: "api/v1/source-documents/[sourceDocumentId]",
    handler: async ({ credential }) => {
      const { sourceDocumentId: rawId } = await context.params;
      const parsed = sourceDocumentIdSchema.safeParse(rawId);
      if (!parsed.success) throw new NotFoundError("Source document");
      // A credential only sees the records of the book it is bound to.
      const status = await getCredentialSourceDocumentStatus(parsed.data, credential.bookId);
      if (status == null) throw new NotFoundError("Source document");
      const response = NextResponse.json(status);
      if (status.status === "processing") response.headers.set("Retry-After", "5");
      return { response };
    },
  });
}
