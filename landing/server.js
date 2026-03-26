import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.static(join(__dirname, 'public')))
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Landing page listening on port ${PORT}`))
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); process.exit(1) })
