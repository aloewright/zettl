import type { BlockNoteEditor } from '@blocknote/core'

/**
 * Parse stored HTML content into BlockNote blocks.
 * Falls back to a single paragraph block if parsing fails.
 */
export async function parseStoredContent(
  editor: BlockNoteEditor,
  html: string,
) {
  if (!html || html.trim() === '') return

  try {
    const blocks = await editor.tryParseHTMLToBlocks(html)
    if (blocks.length > 0) {
      editor.replaceBlocks(editor.document, blocks)
    }
  } catch (e) {
    console.warn('Failed to parse stored HTML into BlockNote blocks:', e)
  }
}

/**
 * Serialize BlockNote editor content to HTML for storage.
 */
export async function serializeEditorContent(
  editor: BlockNoteEditor,
): Promise<string> {
  return editor.blocksToHTMLLossy(editor.document)
}
