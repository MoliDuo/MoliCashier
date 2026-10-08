export function storedFileReadUrl(storedFileId: string): string {
  return `/api/stored-files/${encodeURIComponent(storedFileId)}`;
}
