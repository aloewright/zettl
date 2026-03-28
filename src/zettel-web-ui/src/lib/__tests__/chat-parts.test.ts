import { describe, it, expect } from 'vitest'
import { buildChatParts } from '@/lib/chat-parts'
import type { AttachedFile } from '@/lib/chat-parts'

const IMAGE_FILE: AttachedFile = {
  name: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBOR...',
  mimeType: 'image/png',
}

const JPEG_FILE: AttachedFile = {
  name: 'scan.jpg',
  dataUrl: 'data:image/jpeg;base64,/9j/4A...',
  mimeType: 'image/jpeg',
}

const PDF_FILE: AttachedFile = {
  name: 'report.pdf',
  dataUrl: 'data:application/pdf;base64,JVBER...',
  mimeType: 'application/pdf',
}

describe('buildChatParts', () => {
  // --- text only ---

  it('returns a single text part for plain text input', () => {
    const parts = buildChatParts('Hello world')
    expect(parts).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('returns null for empty text and no attachment', () => {
    // Component trims input before calling buildChatParts, so empty string is the expected input
    expect(buildChatParts('')).toBeNull()
  })

  // --- image attachments ---

  it('sends image as a file part with mimeType', () => {
    const parts = buildChatParts('Describe this', { file: IMAGE_FILE })
    expect(parts).toEqual([
      { type: 'file', data: IMAGE_FILE.dataUrl, mimeType: 'image/png' },
      { type: 'text', text: 'Describe this' },
    ])
  })

  it('adds default prompt when image attached without text', () => {
    const parts = buildChatParts('', { file: IMAGE_FILE })
    expect(parts).toHaveLength(2)
    expect(parts![0]).toEqual({ type: 'file', data: IMAGE_FILE.dataUrl, mimeType: 'image/png' })
    expect(parts![1]).toEqual({ type: 'text', text: 'What can you see in this?' })
  })

  it('works with different image mimeTypes', () => {
    const parts = buildChatParts('', { file: JPEG_FILE })
    expect(parts![0]).toHaveProperty('mimeType', 'image/jpeg')
  })

  // --- PDF attachments ---

  it('includes extracted PDF text as a text part', () => {
    const parts = buildChatParts('Summarize this', {
      file: PDF_FILE,
      pdfText: 'Page 1 content here.',
    })
    expect(parts).toHaveLength(2)
    expect(parts![0]).toEqual({
      type: 'text',
      text: '[Content from "report.pdf"]:\n\nPage 1 content here.',
    })
    expect(parts![1]).toEqual({ type: 'text', text: 'Summarize this' })
  })

  it('sends PDF content without user text', () => {
    const parts = buildChatParts('', {
      file: PDF_FILE,
      pdfText: 'Extracted text.',
    })
    expect(parts).toHaveLength(1)
    expect(parts![0].type).toBe('text')
    expect((parts![0] as { text: string }).text).toContain('Extracted text.')
  })

  it('does not add default image prompt for PDF-only messages', () => {
    const parts = buildChatParts('', {
      file: PDF_FILE,
      pdfText: 'Some content',
    })
    // PDF becomes a text part, so the "What can you see" prompt should NOT be added
    expect(parts).toHaveLength(1)
    expect(parts!.some(p => 'text' in p && p.text === 'What can you see in this?')).toBe(false)
  })

  it('returns null for PDF with empty extracted text and no user text', () => {
    const parts = buildChatParts('', {
      file: PDF_FILE,
      pdfText: '',
    })
    expect(parts).toBeNull()
  })

  it('returns null for PDF with whitespace-only extracted text and no user text', () => {
    const parts = buildChatParts('', {
      file: PDF_FILE,
      pdfText: '   \n  ',
    })
    expect(parts).toBeNull()
  })

  it('returns null for PDF with no pdfText provided and no user text', () => {
    const parts = buildChatParts('', {
      file: PDF_FILE,
      pdfText: undefined,
    })
    expect(parts).toBeNull()
  })

  // --- edge cases ---

  it('ignores unsupported mimeTypes', () => {
    const videoFile: AttachedFile = {
      name: 'clip.mp4',
      dataUrl: 'data:video/mp4;base64,...',
      mimeType: 'video/mp4',
    }
    const parts = buildChatParts('', { file: videoFile })
    expect(parts).toBeNull()
  })

  it('handles unsupported file with user text', () => {
    const videoFile: AttachedFile = {
      name: 'clip.mp4',
      dataUrl: 'data:video/mp4;base64,...',
      mimeType: 'video/mp4',
    }
    const parts = buildChatParts('Hello', { file: videoFile })
    expect(parts).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('handles null attachment', () => {
    const parts = buildChatParts('Hello', null)
    expect(parts).toEqual([{ type: 'text', text: 'Hello' }])
  })
})
