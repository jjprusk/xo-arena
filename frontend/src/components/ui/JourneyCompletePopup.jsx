import React, { useEffect, useRef } from 'react'

// Real fireworks rendered on a canvas
function FireworksCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId

    function resize() {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const COLORS = [
      '#f97316','#facc15','#4ade80','#60a5fa','#c084fc',
      '#fb7185','#ffffff','#34d399','#f472b6','#38bdf8',
    ]

    class Particle {
      constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color
        const angle = Math.random() * Math.PI * 2
        const speed = 3 + Math.random() * 7
        this.vx = Math.cos(angle) * speed
        this.vy = Math.sin(angle) * speed - 1
        this.alpha = 1
        this.decay = 0.008 + Math.random() * 0.01
        this.radius = 2.5 + Math.random() * 3
        this.trail = []
      }
      update() {
        this.trail.push({ x: this.x, y: this.y })
        if (this.trail.length > 6) this.trail.shift()
        this.vy += 0.06  // gravity
        this.vx *= 0.98
        this.x += this.vx; this.y += this.vy
        this.alpha -= this.decay
      }
      draw(ctx) {
        // Trail
        for (let i = 0; i < this.trail.length; i++) {
          const a = (i / this.trail.length) * this.alpha * 0.4
          ctx.beginPath()
          ctx.arc(this.trail[i].x, this.trail[i].y, this.radius * 0.5, 0, Math.PI * 2)
          ctx.fillStyle = this.color
          ctx.globalAlpha = a
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2)
        ctx.fillStyle = this.color
        ctx.globalAlpha = this.alpha
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    class Rocket {
      constructor() { this.reset() }
      reset() {
        this.x  = 0.05 * canvas.width + Math.random() * 0.9 * canvas.width
        this.y  = canvas.height
        this.vy = -(10 + Math.random() * 8)
        this.targetY = 0.05 * canvas.height + Math.random() * 0.55 * canvas.height
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)]
        this.trail = []
        this.done = false
      }
      update(particles) {
        this.trail.push({ x: this.x, y: this.y })
        if (this.trail.length > 10) this.trail.shift()
        this.y += this.vy
        this.vy *= 0.98
        if (this.y <= this.targetY) {
          const count = 100 + Math.floor(Math.random() * 80)
          const c2 = COLORS[Math.floor(Math.random() * COLORS.length)]
          for (let i = 0; i < count; i++)
            particles.push(new Particle(this.x, this.y, i % 3 === 0 ? c2 : this.color))
          this.done = true
        }
      }
      draw(ctx) {
        for (let i = 0; i < this.trail.length; i++) {
          ctx.beginPath()
          ctx.arc(this.trail[i].x, this.trail[i].y, 2, 0, Math.PI * 2)
          ctx.fillStyle = this.color
          ctx.globalAlpha = (i / this.trail.length) * 0.8
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    }

    let rockets = [], particles = []
    let lastLaunch = 0
    const INTERVAL = 400 // ms between launches

    function loop(ts) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (ts - lastLaunch > INTERVAL && rockets.length < 8) {
        rockets.push(new Rocket())
        lastLaunch = ts
      }

      rockets = rockets.filter(r => { r.update(particles); r.draw(ctx); return !r.done })
      particles = particles.filter(p => { p.update(); p.draw(ctx); return p.alpha > 0 })

      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}

export default function JourneyCompletePopup({ onDismiss }) {
  return (
    <>
      <style>{`
        @keyframes jc-fade-in {
          from { opacity: 0; transform: scale(0.9) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 70,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
          overflow: 'hidden',
        }}
        onClick={onDismiss}
      >
        {/* Fireworks */}
        <FireworksCanvas />

        {/* Card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Journey complete"
          style={{
            background: 'var(--bg-surface)',
            border: '2px solid var(--color-amber-400)',
            borderRadius: '1.25rem',
            padding: '2rem 2rem 1.75rem',
            maxWidth: '24rem',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 48px rgba(0,0,0,0.55)',
            position: 'relative',
            zIndex: 1,
            animation: 'jc-fade-in 0.35s ease-out both',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: '0.75rem' }}>🏅</div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            margin: '0 0 0.75rem',
          }}>
            Congrats! You made it.
          </h2>
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
            margin: '0 0 0.75rem',
          }}>
            Your journey is complete and you're on your way to bot AI mastery. Your guide is now set up for a real journeyman.
          </p>
          <p style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 0.5rem',
          }}>
            Now you can:
          </p>
          <ul style={{
            listStyleType: 'disc',
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.75,
            margin: '0 0 1.5rem',
            textAlign: 'left',
            paddingLeft: '1.25rem',
          }}>
            <li style={{ marginBottom: '1.25rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', verticalAlign: 'middle' }}>
                <span style={{ display: 'inline-flex', position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #5B82B8, #3A5E8E)',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 17, lineHeight: 1, position: 'relative', zIndex: 1 }}>🤖</span>
                  </span>
                  <svg width={34} height={34} viewBox="0 0 34 34" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden="true">
                    <circle cx={17} cy={17} r={15} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
                    <circle cx={17} cy={17} r={15} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={2} strokeDasharray={94.2} strokeDashoffset={0} strokeLinecap="round" />
                  </svg>
                </span>
                Use the Guide liberally
              </span>
            </li>
            <li style={{ marginBottom: '1.25rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', verticalAlign: 'middle' }}>
                <span style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  width: 34, height: 34, borderRadius: 6, flexShrink: 0,
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-default)',
                  gap: 2, padding: 2,
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>⊞</span>
                  <span style={{ fontSize: 7, lineHeight: 1, color: 'var(--text-primary)', fontWeight: 500 }}>Play</span>
                </span>
                Play other humans or bots
              </span>
            </li>
            <li style={{ marginBottom: '1.25rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', verticalAlign: 'middle' }}>
                <span style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  width: 34, height: 34, borderRadius: 6, flexShrink: 0,
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-default)',
                  gap: 2, padding: 2,
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>⊕</span>
                  <span style={{ fontSize: 7, lineHeight: 1, color: 'var(--text-primary)', fontWeight: 500 }}>Tournaments</span>
                </span>
                Enter a tournament
              </span>
            </li>
          </ul>
          <button
            onClick={onDismiss}
            className="btn btn-primary"
            style={{ minWidth: '9rem', fontSize: '0.9375rem' }}
          >
            Let's go! 🚀
          </button>
        </div>
      </div>
    </>
  )
}
