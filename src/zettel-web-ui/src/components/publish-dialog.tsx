import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Globe,
  Linkedin,
  Youtube,
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { usePublish, useBlogDomains, usePublishHistory } from '@/hooks/use-publish'
import type { PublishChannel, PublishResult } from '@/api/publish'
import type { ContentPiece } from '@/api/types'

interface PublishDialogProps {
  piece: ContentPiece
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CHANNELS: { id: PublishChannel; name: string; icon: React.ReactNode; description: string }[] = [
  { id: 'blog', name: 'Blog', icon: <Globe className="size-4" />, description: 'Publish to your Cloudflare blog' },
  { id: 'linkedin', name: 'LinkedIn', icon: <Linkedin className="size-4" />, description: 'Create a LinkedIn post' },
  { id: 'youtube', name: 'YouTube', icon: <Youtube className="size-4" />, description: 'Publish video to YouTube' },
  { id: 'resend', name: 'Email (Resend)', icon: <Mail className="size-4" />, description: 'Send as email newsletter' },
]

export function PublishDialog({ piece, open, onOpenChange }: PublishDialogProps) {
  const [selected, setSelected] = useState<Set<PublishChannel>>(new Set())
  const [slug, setSlug] = useState('')
  const [emailTo, setEmailTo] = useState('')
  const [results, setResults] = useState<PublishResult[] | null>(null)

  const publish = usePublish()
  const { data: domainsData } = useBlogDomains()
  const { data: historyData } = usePublishHistory(piece.id)
  const domains = domainsData?.domains ?? []
  const [selectedDomain, setSelectedDomain] = useState('')

  const publishedChannels = new Set(
    (historyData?.history ?? [])
      .filter(h => h.status === 'success')
      .map(h => h.channel)
  )

  const toggle = (ch: PublishChannel) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      return next
    })
  }

  const handlePublish = async () => {
    if (!selected.size) return

    const channels = Array.from(selected)
    const domain = selectedDomain || domains[0]

    try {
      const response = await publish.mutateAsync({
        pieceId: piece.id,
        channels,
        domain: channels.includes('blog') ? domain : undefined,
        slug: slug || undefined,
        emailTo: channels.includes('resend') ? emailTo : undefined,
      })

      setResults(response.results)

      const succeeded = response.results.filter(r => r.success)
      const failed = response.results.filter(r => !r.success)

      if (succeeded.length) {
        toast.success(`Published to ${succeeded.map(r => r.channel).join(', ')}`, {
          description: succeeded.find(r => r.externalUrl)?.externalUrl,
        })
      }
      if (failed.length) {
        toast.error(`Failed: ${failed.map(r => `${r.channel}: ${r.error}`).join('; ')}`)
      }
    } catch (err) {
      toast.error('Publish failed', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const reset = () => {
    setResults(null)
    setSelected(new Set())
    setSlug('')
    setEmailTo('')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Publish</DialogTitle>
          <DialogDescription>
            Choose where to publish this {piece.medium} piece.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-3 py-2">
            {results.map(r => (
              <div key={r.channel} className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
                {r.success ? (
                  <CheckCircle2 className="size-5 text-green-500" />
                ) : (
                  <XCircle className="size-5 text-red-500" />
                )}
                <div className="flex-1">
                  <span className="text-sm font-medium capitalize">{r.channel}</span>
                  {r.error && <p className="text-xs text-red-500">{r.error}</p>}
                </div>
                {r.externalUrl && (
                  <a href={r.externalUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
            ))}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false) }}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {CHANNELS.map(ch => {
              const alreadyPublished = publishedChannels.has(ch.id)
              return (
                <button
                  key={ch.id}
                  onClick={() => toggle(ch.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selected.has(ch.id)
                      ? 'border-foreground/30 bg-foreground/5'
                      : 'border-border/50 hover:border-border'
                  }`}
                >
                  <span className={selected.has(ch.id) ? 'text-foreground' : 'text-muted-foreground'}>
                    {ch.icon}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-medium">{ch.name}</span>
                    <p className="text-xs text-muted-foreground">{ch.description}</p>
                  </div>
                  {alreadyPublished && (
                    <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
                      Published
                    </Badge>
                  )}
                </button>
              )
            })}

            {/* Blog options */}
            {selected.has('blog') && (
              <div className="space-y-2 rounded-lg border border-border/50 p-3">
                <label className="text-xs font-medium text-muted-foreground">Blog domain</label>
                {domains.length > 0 ? (
                  <select
                    value={selectedDomain || domains[0]}
                    onChange={e => setSelectedDomain(e.target.value)}
                    className="w-full rounded-md border border-border/50 bg-transparent px-2 py-1.5 text-xs"
                  >
                    {domains.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No blog domains configured. Add one in Settings.
                  </p>
                )}
                <label className="text-xs font-medium text-muted-foreground">URL slug (optional)</label>
                <input
                  type="text"
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  placeholder="auto-generated-from-title"
                  className="w-full rounded-md border border-border/50 bg-transparent px-2 py-1.5 text-xs placeholder:text-muted-foreground/50"
                />
              </div>
            )}

            {/* Resend options */}
            {selected.has('resend') && (
              <div className="space-y-2 rounded-lg border border-border/50 p-3">
                <label className="text-xs font-medium text-muted-foreground">Send to (email)</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  placeholder="subscribers@example.com"
                  className="w-full rounded-md border border-border/50 bg-transparent px-2 py-1.5 text-xs placeholder:text-muted-foreground/50"
                />
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={!selected.size || publish.isPending}
              >
                {publish.isPending ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : null}
                Publish to {selected.size} channel{selected.size !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
