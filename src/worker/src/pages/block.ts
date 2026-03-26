/** Custom Cloudflare Access block/forbidden page — matches app dark-stone theme. */
export function blockPage(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Access Denied — Alex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: oklch(0.147 0.004 49.25);
      --fg: oklch(0.985 0.002 75);
      --card: oklch(0.216 0.006 56.043);
      --muted: oklch(0.709 0.01 56);
      --border: oklch(1 0 0 / 10%);
      --destructive: oklch(0.704 0.191 22.216);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 400px;
      padding: 2rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.5rem 2rem;
      text-align: center;
    }
    .logo {
      font-family: "Lora", serif;
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-bottom: 1.5rem;
    }
    .icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 1rem;
      color: var(--destructive);
    }
    h1 {
      font-family: "Lora", serif;
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .message {
      color: var(--muted);
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.625rem 1.25rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--fg);
      transition: all 0.15s ease;
    }
    .btn:hover {
      background: oklch(0.2 0.005 50);
      border-color: oklch(1 0 0 / 20%);
    }
    .btn + .btn { margin-left: 0.5rem; }
    .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
    .footer {
      text-align: center;
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">Alex</div>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
      <h1>Access Denied</h1>
      <p class="message">
        You don't have permission to access this application.
        If you believe this is an error, try signing in with a different account.
      </p>
      <div class="actions">
        <a class="btn" href="${origin}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(origin)}">
          Sign out
        </a>
        <a class="btn" href="/">
          Try again
        </a>
      </div>
    </div>
    <p class="footer">Protected by Cloudflare Access</p>
  </div>
</body>
</html>`
}
