import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Upload, Download, RefreshCw, Activity, LogOut, Plug, Unplug, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useReEmbed } from '@/hooks/use-notes'
import { useHealth } from '@/hooks/use-health'
import { useComposioConfig, useUpdateComposioConfig } from '@/hooks/use-composio'
import { useSubstackConfig, useUpdateSubstackConfig } from '@/hooks/use-substack'
import { importNotes, exportNotes } from '@/api/import-export'
import { logout } from '@/auth'
import { toast } from 'sonner'

/**
 * Render the Settings page UI for configuring models, importing/exporting notes, re-embedding, viewing health, and account actions.
 *
 * The page provides controls to select and save an LLM provider and model, import markdown files as notes (with optional embedding progress), download a notes export, queue notes for re-embedding, and view service/database health metrics. It also exposes a sign-out action.
 *
 * @returns The JSX element for the Settings page
 */
export function SettingsPage() {
  const reEmbed = useReEmbed()
  const [showEmbedProgress, setShowEmbedProgress] = useState(false)
  const { data: health } = useHealth(showEmbedProgress ? 5_000 : 30_000)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Substack state
  const { data: substackConfig } = useSubstackConfig()
  const updateSubstack = useUpdateSubstackConfig()
  const [substackSubdomain, setSubstackSubdomain] = useState('')
  const [substackEmail, setSubstackEmail] = useState('')
  const [substackPassword, setSubstackPassword] = useState('')

  useEffect(() => {
    if (substackConfig?.subdomain) setSubstackSubdomain(substackConfig.subdomain)
    if (substackConfig?.email) setSubstackEmail(substackConfig.email)
  }, [substackConfig?.subdomain, substackConfig?.email])

  // Composio MCP state
  const { data: composioConfig } = useComposioConfig()
  const updateConfig = useUpdateComposioConfig()

  const dbData = health?.entries?.database?.data
  const totalNotes = Number(dbData?.total_notes ?? 0)
  const embeddedNotes = Number(dbData?.embedded ?? 0)
  const pendingNotes = Number(dbData?.pending ?? 0)

  // Auto-hide progress when embedding is complete
  useEffect(() => {
    if (showEmbedProgress && totalNotes > 0 && pendingNotes === 0) {
      setShowEmbedProgress(false)
    }
  }, [showEmbedProgress, totalNotes, pendingNotes])

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    setImporting(true)
    try {
      const files = await Promise.all(
        Array.from(fileList).map(async (file) => ({
          fileName: file.name,
          content: await file.text(),
        })),
      )
      const result = await importNotes(files)
      toast.success(`Imported ${result.imported} notes (${result.skipped} skipped)`)
      if (result.imported > 0) {
        setShowEmbedProgress(true)
      }
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportNotes()
      toast.success('Export downloaded')
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleReEmbed = () => {
    reEmbed.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(`Queued ${result.queued} notes for re-embedding`)
        if (result.queued > 0) {
          setShowEmbedProgress(true)
        }
      },
      onError: () => toast.error('Re-embed failed'),
    })
  }

  const embedEntry = health?.entries?.embedding

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/" className="gap-1.5 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <h1 className="font-serif text-2xl font-semibold tracking-tight">Settings</h1>

      <Separator className="my-6" />

      {/* Embedding Progress */}
      {showEmbedProgress && totalNotes > 0 && (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Embedding Progress</h2>
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${Math.round((embeddedNotes / totalNotes) * 100)}%` }}
                />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {embeddedNotes} of {totalNotes} notes embedded
                {pendingNotes > 0 && ` (${pendingNotes} pending)`}
              </p>
            </div>
          </section>
          <Separator className="my-6" />
        </>
      )}

      {/* Import */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Import</h2>
        <p className="text-sm text-muted-foreground">
          Import markdown files (.md) as notes.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          multiple
          onChange={handleImport}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          {importing ? 'Importing...' : 'Choose files'}
        </Button>
      </section>

      <Separator className="my-6" />

      {/* Export */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Export</h2>
        <p className="text-sm text-muted-foreground">
          Download all notes as a zip of markdown files with front matter.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting...' : 'Download export'}
        </Button>
      </section>

      <Separator className="my-6" />

      {/* Re-embed */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Re-embed</h2>
        <p className="text-sm text-muted-foreground">
          Queue all notes for re-embedding. Useful after changing the embedding model.
        </p>
        <ConfirmDialog
          trigger={
            <Button
              variant="outline"
              size="sm"
              disabled={reEmbed.isPending}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reEmbed.isPending ? 'animate-spin' : ''}`} />
              {reEmbed.isPending ? 'Re-embedding...' : 'Re-embed all'}
            </Button>
          }
          title="Re-embed all notes"
          description="This will queue all notes for re-embedding. This may take a while and use API credits."
          confirmLabel="Re-embed"
          onConfirm={handleReEmbed}
        />
      </section>

      <Separator className="my-6" />

      {/* Substack */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Substack</h2>
        <p className="text-sm text-muted-foreground">
          Configure your Substack account to publish blog posts directly.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Substack subdomain</label>
            <input
              type="text"
              value={substackSubdomain}
              onChange={(e) => setSubstackSubdomain(e.target.value)}
              placeholder="mysite"
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {substackSubdomain && (
              <p className="text-xs text-muted-foreground">{substackSubdomain}.substack.com</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="text"
              value={substackEmail}
              onChange={(e) => setSubstackEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Password
              {substackConfig?.passwordSet && (
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <Check className="h-3 w-3" />
                  Password saved
                </span>
              )}
            </label>
            <input
              type="password"
              value={substackPassword}
              onChange={(e) => setSubstackPassword(e.target.value)}
              placeholder={substackConfig?.passwordSet ? 'Update password...' : 'Enter password...'}
              className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={updateSubstack.isPending}
            onClick={() => {
              const data: { email?: string; password?: string; subdomain?: string } = {}
              if (substackSubdomain) data.subdomain = substackSubdomain
              if (substackEmail) data.email = substackEmail
              if (substackPassword) data.password = substackPassword
              updateSubstack.mutate(data, {
                onSuccess: () => {
                  toast.success('Substack settings saved')
                  setSubstackPassword('')
                },
                onError: () => toast.error('Failed to save Substack settings'),
              })
            }}
          >
            {updateSubstack.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </section>

      <Separator className="my-6" />

      {/* Composio MCP */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Plug className="h-3.5 w-3.5" />
          Composio MCP Tools
        </h2>
        <p className="text-sm text-muted-foreground">
          Enable external tool execution during AI chat via Composio MCP server.
          When enabled, the AI can search, connect, and use 500+ app integrations.
        </p>
        <Button
          variant={composioConfig?.enabled ? 'default' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={() => {
            updateConfig.mutate(
              { enabled: !composioConfig?.enabled },
              {
                onSuccess: () => toast.success(`MCP tools ${composioConfig?.enabled ? 'disabled' : 'enabled'}`),
                onError: () => toast.error('Failed to update config'),
              },
            )
          }}
          disabled={updateConfig.isPending}
        >
          {composioConfig?.enabled ? <Plug className="h-3.5 w-3.5" /> : <Unplug className="h-3.5 w-3.5" />}
          {composioConfig?.enabled ? 'Enabled' : 'Disabled'}
        </Button>
      </section>

      <Separator className="my-6" />

      {/* Health */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Activity className="h-3.5 w-3.5" />
          Health
        </h2>
        {health ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${health.status === 'Healthy' ? 'bg-green-500' : 'bg-amber-500'}`} />
              <span className="text-muted-foreground">Status: {health.status}</span>
            </div>
            {dbData && (
              <div className="space-y-1 pl-4 text-muted-foreground">
                {Object.entries(dbData).map(([key, value]) => (
                  <p key={key}>
                    {key}: <span className="font-mono text-foreground">{String(value)}</span>
                  </p>
                ))}
              </div>
            )}
            {embedEntry?.data && (
              <div className="space-y-1 pl-4 text-muted-foreground">
                {Object.entries(embedEntry.data).map(([key, value]) => (
                  <p key={key}>
                    {key}: <span className="font-mono text-foreground">{String(value)}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading health data...</p>
        )}
      </section>

      <Separator className="my-6" />

      {/* Account */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Account</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={logout}
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </section>
    </div>
  )
}
