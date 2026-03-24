import express from 'express'
import https from 'https'
import http from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { URL } from 'url'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')

const BACKEND = process.env.BACKEND_URL

// Proxy /api/* to backend so auth cookies are same-origin
if (BACKEND) {
  app.use('/api', (req, res) => {
    const target = new URL(req.originalUrl, BACKEND)
    const isHttps = target.protocol === 'https:'
    const transport = isHttps ? https : http

    const options = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    }

    const proxy = transport.request(options, (upstream) => {
      // Strip CORS headers — browser sees this as same-origin
      const headers = {}
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (/^access-control-/i.test(k)) continue
        if (k.toLowerCase() === 'set-cookie') {
          // Strip Domain so cookie is scoped to frontend domain
          headers[k] = (Array.isArray(v) ? v : [v]).map(c =>
            c.replace(/;\s*domain=[^;]*/gi, '').replace(/;\s*samesite=[^;]*/gi, '; SameSite=Lax')
          )
        } else {
          headers[k] = v
        }
      }
      res.writeHead(upstream.statusCode, headers)
      upstream.pipe(res)
    })

    proxy.on('error', () => res.status(502).json({ error: 'Proxy error' }))
    req.pipe(proxy)
  })
}

app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))

app.listen(process.env.PORT || 4173, () => {
  console.log(`Frontend serving on port ${process.env.PORT || 4173}`)
})
