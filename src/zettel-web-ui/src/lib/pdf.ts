import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let workerConfigured = false

/**
 * Extract text content from a PDF data URL.
 * Lazy-loads pdfjs-dist so it only adds to the bundle when actually used.
 */
export async function extractPdfText(dataUrl: string): Promise<string> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')

  if (!workerConfigured) {
    GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
    workerConfigured = true
  }

  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  const pdf = await getDocument({ data: bytes }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
      .map(item => item.str)
      .join(' ')
    if (text.trim()) {
      pages.push(text.trim())
    }
  }

  return pages.join('\n\n')
}
