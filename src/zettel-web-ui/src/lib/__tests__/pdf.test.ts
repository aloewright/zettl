import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Vite ?url import used by pdf.ts
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'mocked-worker-url',
}))

// Mock pdfjs-dist
function makeMockPage(texts: string[]) {
  return {
    getTextContent: vi.fn().mockResolvedValue({
      items: texts.map(str => ({ str })),
    }),
  }
}

const mockGetDocument = vi.fn()

vi.mock('pdfjs-dist', () => ({
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
  GlobalWorkerOptions: { workerSrc: '' },
}))

beforeEach(() => {
  mockGetDocument.mockReset()
})

// Valid base64 — actual bytes don't matter since pdfjs-dist is mocked
const DATA_URL = 'data:application/pdf;base64,JVBERi0xLjQ='

describe('extractPdfText', () => {
  it('extracts text from a single-page PDF', async () => {
    const page = makeMockPage(['Hello ', 'world'])
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(page),
      }),
    })

    const { extractPdfText } = await import('@/lib/pdf')
    const result = await extractPdfText(DATA_URL)

    expect(result).toBe('Hello  world')
    expect(mockGetDocument).toHaveBeenCalledOnce()
  })

  it('joins multiple pages with double newlines', async () => {
    const page1 = makeMockPage(['Page one content'])
    const page2 = makeMockPage(['Page two content'])
    const getPage = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)

    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    })

    const { extractPdfText } = await import('@/lib/pdf')
    const result = await extractPdfText(DATA_URL)

    expect(result).toBe('Page one content\n\nPage two content')
    expect(getPage).toHaveBeenCalledWith(1)
    expect(getPage).toHaveBeenCalledWith(2)
  })

  it('skips pages with only whitespace', async () => {
    const page1 = makeMockPage(['Real content'])
    const page2 = makeMockPage(['   ', '\n'])
    const getPage = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)

    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    })

    const { extractPdfText } = await import('@/lib/pdf')
    const result = await extractPdfText(DATA_URL)

    expect(result).toBe('Real content')
  })

  it('returns empty string when PDF has no extractable text', async () => {
    const page = makeMockPage([])
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(page),
      }),
    })

    const { extractPdfText } = await import('@/lib/pdf')
    const result = await extractPdfText(DATA_URL)

    expect(result).toBe('')
  })

  it('filters out non-text items (items without str property)', async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: 'visible' },
          { width: 100 },          // not a text item
          { str: ' text' },
        ],
      }),
    }

    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(page),
      }),
    })

    const { extractPdfText } = await import('@/lib/pdf')
    const result = await extractPdfText(DATA_URL)

    expect(result).toBe('visible  text')
  })

  it('decodes base64 from data URL correctly', async () => {
    const page = makeMockPage(['ok'])
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(page),
      }),
    })

    const { extractPdfText } = await import('@/lib/pdf')
    await extractPdfText('data:application/pdf;base64,SGVsbG8=')

    // Verify getDocument received a Uint8Array
    const callArg = mockGetDocument.mock.calls[0][0]
    expect(callArg).toHaveProperty('data')
    expect(callArg.data).toBeInstanceOf(Uint8Array)
  })
})
