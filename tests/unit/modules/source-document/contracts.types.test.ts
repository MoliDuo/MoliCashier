import { describe, it, expectTypeOf } from "vitest";
import type {
  SourceDocumentDetailDto,
  SourceDocumentListItemDto,
  SourceDocumentActiveResultSummary,
} from "@/modules/source-document/contracts";
import type { SourceDocumentReferenceDto } from "@/modules/ledger/contracts";

describe("source-document contract types", () => {
  it("keeps the compact stream and complete detail fields typed", () => {
    expectTypeOf<SourceDocumentDetailDto>().toEqualTypeOf<SourceDocumentDetailDto>();
    expectTypeOf<SourceDocumentDetailDto>().toHaveProperty("files");
    expectTypeOf<SourceDocumentDetailDto>().not.toHaveProperty("metadata");
    expectTypeOf<SourceDocumentDetailDto>().not.toHaveProperty("deletedAt");
    expectTypeOf<SourceDocumentListItemDto["text"]>().toEqualTypeOf<null>();
  });

  it("keeps ledger source-document references source-agnostic", () => {
    expectTypeOf<SourceDocumentReferenceDto["documentDate"]>().toEqualTypeOf<string>();
    expectTypeOf<SourceDocumentReferenceDto>().not.toHaveProperty("type");
  });

  it("exposes the optional active result summary on detail projections", () => {
    expectTypeOf<SourceDocumentDetailDto["activeResultSummary"]>().toEqualTypeOf<
      SourceDocumentActiveResultSummary | undefined
    >();
    expectTypeOf<SourceDocumentDetailDto["activeResultSummary"]>().toEqualTypeOf<
      SourceDocumentActiveResultSummary | undefined
    >();
  });
});
