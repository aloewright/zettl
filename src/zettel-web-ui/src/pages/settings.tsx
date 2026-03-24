import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Upload, Download, RefreshCw, Activity, Bot, Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useReEmbed } from '@/hooks/use-notes'
import { useHealth } from '@/hooks/use-health'
import { useModelSettings, useAvailableModels, useUpdateModel } from '@/hooks/use-settings'
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

  // LLM model selection
  const { data: modelSettings } = useModelSettings()
  const { data: availableModels, isLoading: isLoadingModels } = useAvailableModels()
  const updateModel = useUpdateModel()
  const [selectedProvider, setSelectedProvider] = useState<'openrouter' | 'google'>('openrouter')
  const [selectedModel, setSelectedModel] = useState('')
  const hasInitialized = useRef(false)

  // Sync local state from server on initial load only — avoid overwriting in-flight edits
  useEffect(() => {
    if (modelSettings && !hasInitialized.current) {
      hasInitialized.current = true
      setSelectedProvider(modelSettings.provider)
      setSelectedModel(modelSettings.model)
    }
  }, [modelSettings])

  const providerModels =
    selectedProvider === 'google'
      ? (availableModels?.google ?? [])
      : (availableModels?.openRouter ?? [])

  const handleSaveModel = () => {
    if (!selectedModel) return
    updateModel.mutate(
      { provider: selectedProvider, model: selectedModel },
      {
        onSuccess: () => toast.success('Model updated'),
        onError: () => toast.error('Failed to update model'),
      },
    )
  }
  const { data: health } = useHealth(showEmbedProgress ? 5_000 : 30_000)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

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

      {/* LLM Model */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Bot className="h-3.5 w-3.5" />
          Generation Model
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose which AI model is used for content and research generation.
        </p>

        {/* Provider tabs */}
        <div className="flex gap-1 rounded-md border border-border bg-muted p-0.5 w-fit">
          {(['openrouter', 'google'] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setSelectedProvider(p)
                setSelectedModel('')
              }}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                selectedProvider === p
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p === 'openrouter' ? 'OpenRouter' : 'Google'}
            </button>
          ))}
        </div>

        {/* Model dropdown */}
        <div className="flex items-center gap-2">
          {isLoadingModels ? (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading models…
            </div>
          ) : (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={providerModels.length === 0}
              className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                {providerModels.length === 0
                  ? `No ${selectedProvider === 'google' ? 'Google' : 'OpenRouter'} models — check API key`
                  : 'Select a model…'}
              </option>
              {providerModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.contextLength ? ` (${(m.contextLength / 1000).toFixed(0)}k ctx)` : ''}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveModel}
            disabled={!selectedModel || updateModel.isPending}
            className="gap-1.5"
          >
            {updateModel.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {modelSettings?.model && (
          <p className="text-xs text-muted-foreground">
            Active: <span className="font-mono text-foreground">{modelSettings.provider}/{modelSettings.model}</span>
          </p>
        )}
      </section>

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
