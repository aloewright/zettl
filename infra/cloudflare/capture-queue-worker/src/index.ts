/**
 * Cloudflare Queue consumer — receives capture events and forwards them
 * to the backend's /api/capture webhook endpoints.
 *
 * Message format:
 *   { source: "email" | "telegram", payload: <original webhook body> }
 *
 * Required secrets (wrangler secret put):
 *   BACKEND_URL    — e.g. https://api.yourdomain.com
 *   WEBHOOK_SECRET — matches Capture:WebhookSecret in appsettings.json
 */

interface Env {
  BACKEND_URL: string
  WEBHOOK_SECRET: string
}

interface CaptureMessage {
  source: 'email' | 'telegram'
  payload: unknown
}

export default {
  async queue(batch: MessageBatch<CaptureMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { source, payload } = msg.body

      const endpoint = source === 'telegram'
        ? `${env.BACKEND_URL}/api/capture/telegram`
        : `${env.BACKEND_URL}/api/capture/email`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (source === 'telegram') {
        headers['X-Telegram-Bot-Api-Secret-Token'] = env.WEBHOOK_SECRET
      } else {
        headers['X-Webhook-Secret'] = env.WEBHOOK_SECRET
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`Failed to forward ${source} message to backend: ${response.status}`)
        msg.retry()
      } else {
        msg.ack()
      }
    }
  },
}
