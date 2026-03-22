import type { FC, PropsWithChildren } from "hono/jsx";

export const AdminLayout: FC<PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title ? `${title} — Cliphy Admin` : "Cliphy Admin"}</title>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; }
        .container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
        nav { background: #1a1a1a; color: white; padding: 0.75rem 1rem; display: flex; gap: 1.5rem; align-items: center; }
        nav a { color: #ccc; text-decoration: none; font-size: 0.9rem; }
        nav a:hover, nav a.active { color: white; }
        nav .brand { font-weight: bold; font-size: 1.1rem; color: white; margin-right: 1rem; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #fafafa; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; color: #666; }
        tr:hover { background: #f9f9f9; }
        tr:last-child td { border-bottom: none; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
        .stat-card { background: white; border-radius: 8px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .stat-card .value { font-size: 2rem; font-weight: bold; }
        .stat-card .label { font-size: 0.85rem; color: #666; margin-top: 0.25rem; }
        .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
        .badge-free { background: #e0f2fe; color: #0369a1; }
        .badge-pro { background: #fce7f3; color: #be185d; }
        .badge-active { background: #dcfce7; color: #15803d; }
        .badge-canceled, .badge-none { background: #f3f4f6; color: #6b7280; }
        .badge-past_due { background: #fef3c7; color: #92400e; }
        .badge-pending { background: #fef3c7; color: #92400e; }
        .badge-processing { background: #dbeafe; color: #1d4ed8; }
        .badge-completed { background: #dcfce7; color: #15803d; }
        .badge-failed { background: #fee2e2; color: #b91c1c; }
        .filters { display: flex; gap: 0.75rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
        .filters select, .filters input { padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.9rem; }
        .filters input[type="search"] { min-width: 250px; }
        .btn { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; }
        .btn-primary { background: #2563eb; color: white; }
        .btn-danger { background: #dc2626; color: white; }
        .btn-secondary { background: #e5e7eb; color: #374151; }
        .btn:hover { opacity: 0.9; }
        .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
        .pagination { display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: center; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; }
        .detail-row .label { color: #666; font-size: 0.9rem; }
        .section { margin-bottom: 2rem; }
        .section h2 { font-size: 1.25rem; margin-bottom: 1rem; }
        h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
        a.row-link { color: inherit; text-decoration: none; }
        .login-form { max-width: 400px; margin: 4rem auto; }
        .login-form input[type="password"] { width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem; margin-bottom: 1rem; }
        .login-form .btn { width: 100%; }
        .error { color: #dc2626; margin-bottom: 1rem; font-size: 0.9rem; }
        .success { color: #15803d; margin-bottom: 1rem; font-size: 0.9rem; }
        pre { background: #1e293b; color: #f1f5f9; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; }
      `}</style>
    </head>
    <body>
      <nav>
        <span class="brand">Cliphy Admin</span>
        <a href="/api/admin/users">Users</a>
        <a href="/api/admin/summaries">Summaries</a>
        <a href="/api/admin/queue">Queue</a>
      </nav>
      <div class="container">{children}</div>
      <script src="/api/admin/htmx.js"></script>
    </body>
  </html>
);
