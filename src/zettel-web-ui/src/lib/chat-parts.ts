export interface AttachedFile {
  name: string
  dataUrl: string
  mimeType: string
}

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: string; mimeType: string }

/**
 * Build message parts from user text and an optional attachment.
 * For PDFs, the caller must extract text first and pass it as `pdfText`.
 * Returns null if there's nothing to send.
 */
export function buildChatParts(
  text: string,
  attachment?: { file: AttachedFile; pdfText?: string } | null,
): ChatPart[] | null {
  const parts: ChatPart[] = []

  if (attachment) {
    if (attachment.file.mimeType === 'application/pdf' && attachment.pdfText?.trim()) {
      parts.push({
        type: 'text',
        text: `[Content from "${attachment.file.name}"]:\n\n${attachment.pdfText}`,
      })
    } else if (attachment.file.mimeType.startsWith('image/')) {
      parts.push({ type: 'file', data: attachment.file.dataUrl, mimeType: attachment.file.mimeType })
    }
  }

  if (text) {
    parts.push({ type: 'text', text })
  }

  if (parts.length === 0) return null

  // If only file parts (image) with no text, add default prompt
  const hasOnlyFiles = !text && parts.every(p => p.type === 'file')
  if (hasOnlyFiles) {
    ;(parts as ChatPart[]).push({ type: 'text', text: 'What can you see in this?' })
  }

  return parts
}
