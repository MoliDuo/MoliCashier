import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentDetailStatusPanels } from "@/modules/source-document/ui/SourceDocumentDetailStatusPanels";

const baseDocument: SourceDocument = {
  id: "doc-1",
  version: 1,
  latestAttemptId: null,
  title: "Receipt",
  text: null,
  files: [],
  processingStatus: "failed",
  failureKind: "invalid_input",
  failureMessage: null,
  documentDate: "2026-07-28",
  createdAt: "2026-07-28T00:00:00.000Z",
  hasImages: false,
  ledgerEntries: [],
  updatedAt: "2026-07-28T00:00:00.000Z",
  supportedActions: [],
  canEdit: true,
  errorCode: null,
};

function renderPanels(sourceDocument: SourceDocument) {
  return render(
    <SourceDocumentDetailStatusPanels
      sourceDocument={sourceDocument}
      loadError={false}
      isLoading={false}
      isReloading={false}
      onClose={vi.fn()}
      onReload={vi.fn()}
    />
  );
}

describe("SourceDocumentDetailStatusPanels", () => {
  it("shows the AI-written reason under the unparsable title", () => {
    renderPanels({
      ...baseDocument,
      failureMessage: "这是一张退款单据，本系统只处理支出。",
    });

    expect(screen.getByText("无法解析")).toBeInTheDocument();
    expect(screen.getByText("这是一张退款单据，本系统只处理支出。")).toBeInTheDocument();
  });

  it("falls back to localized copy when the failure carries no reason", () => {
    renderPanels(baseDocument);

    expect(screen.getByText("无法解析")).toBeInTheDocument();
    expect(
      screen.getByText("没能识别出支出。换张更清晰的图片，或补充文字后重试。")
    ).toBeInTheDocument();
  });

  it("keeps the processing-failure codes for infrastructure failures", () => {
    renderPanels({
      ...baseDocument,
      failureKind: "processing_error",
      failureMessage: "The receipt image could not be loaded from object storage.",
      errorCode: "storage_failure",
    });

    expect(screen.getByText("存储错误")).toBeInTheDocument();
    expect(screen.getByText("保存数据时出错。")).toBeInTheDocument();
  });
});
