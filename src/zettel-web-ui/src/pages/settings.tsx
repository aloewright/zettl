import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Upload, Download, RefreshCw, Activity, LogOut, Plug, Unplug, Check, Sun, Moon, ExternalLink, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useTheme } from '@/hooks/use-theme'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useReEmbed } from '@/hooks/use-notes'
import { useHealth } from '@/hooks/use-health'
import { useComposioConfig, useUpdateComposioConfig, useComposioConnections, useCreateAuthLink, useDisconnectService } from '@/hooks/use-composio'
import { useSubstackConfig, useUpdateSubstackConfig } from '@/hooks/use-substack'
import { COMPOSIO_SERVICES } from '@/api/composio'
import { importNotes, exportNotes } from '@/api/import-export'
import { logout } from '@/auth'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

// ── Service icons (inline SVGs for brand logos) ──────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

function ResendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6zm2.4.8L12 12l7.6-5.2a.8.8 0 1 0-.9-1.32L12 10.04 5.3 5.48a.8.8 0 1 0-.9 1.32z" />
    </svg>
  )
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

const SERVICE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  gmail: GoogleIcon,
  linkedin: LinkedInIcon,
  resend: ResendIcon,
  youtube: YouTubeIcon,
  github: GitHubIcon,
}

// ── Settings Page ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
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

  // Composio connections
  const { data: connectionsData, isLoading: connectionsLoading } = useComposioConnections()
  const createAuthLink = useCreateAuthLink()
  const disconnectService = useDisconnectService()
  const queryClient = useQueryClient()
  const [connectingService, setConnectingService] = useState<string | null>(null)

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

  const handleConnect = async (slug: string) => {
    setConnectingService(slug)
    try {
      const result = await createAuthLink.mutateAsync(slug)
      if (result.alreadyConnected) {
        toast.success(`${slug} is already connected`)
        queryClient.invalidateQueries({ queryKey: ['composio', 'connections'] })
        setConnectingService(null)
        return
      }
      if (result.redirectUrl) {
        // Open Composio's branded auth link in a new tab
        window.open(result.redirectUrl, '_blank', 'noopener')
        toast.info('Complete authentication in the new tab, then refresh this page.')
        setConnectingService(null)
      } else {
        toast.error(`No auth link returned for ${slug}`)
        setConnectingService(null)
      }
    } catch {
      toast.error(`Failed to connect ${slug}`)
      setConnectingService(null)
    }
  }

  const handleDisconnect = async (slug: string) => {
    try {
      await disconnectService.mutateAsync(slug)
      toast.success(`${slug} disconnected`)
    } catch {
      // MCP doesn't support disconnect — reconnect instead
      toast.info('To disconnect, manage connections at composio.dev')
    }
  }

  const connections = connectionsData?.connections ?? {}
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

      {/* Connected Services */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Plug className="h-3.5 w-3.5" />
          Connected Services
        </h2>
        <p className="text-sm text-muted-foreground">
          Authenticate with external services to use them during AI chat and tool execution.
        </p>

        <div className="space-y-2">
          {COMPOSIO_SERVICES.map((service) => {
            const Icon = SERVICE_ICONS[service.slug]
            const conn = connections[service.slug]
            const isConnected = conn?.connected
            const isConnecting = connectingService === service.slug
            const isDisconnecting = disconnectService.isPending && disconnectService.variables === service.slug

            return (
              <div
                key={service.slug}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">{service.name}</p>
                    <p className="text-xs text-muted-foreground">{service.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {connectionsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : isConnected ? (
                    <>
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <Check className="h-3 w-3" />
                        {conn?.userName ? conn.userName : 'Connected'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => handleDisconnect(service.slug)}
                        disabled={isDisconnecting}
                      >
                        {isDisconnecting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-3 text-xs"
                      onClick={() => handleConnect(service.slug)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3 w-3" />
                      )}
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
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

      {/* Theme */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Theme</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={theme === 'light' ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setTheme('light')}
          >
            <Sun className="h-3.5 w-3.5" />
            Light
          </Button>
          <Button
            variant={theme === 'dark' ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setTheme('dark')}
          >
            <Moon className="h-3.5 w-3.5" />
            Dark
          </Button>
          <Button
            variant={theme === 'system' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme('system')}
          >
            System
          </Button>
        </div>
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
