import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')

app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))

app.listen(process.env.PORT || 4173, () => {
  console.log(`Frontend serving on port ${process.env.PORT || 4173}`)
})
