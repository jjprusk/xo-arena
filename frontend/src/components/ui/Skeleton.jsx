// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'

/** Animated shimmer placeholder. Use width/height/rounded/className to shape it. */
export function Skeleton({ className = '', style = {} }) {
  return (
    <div
      className={`animate-pulse rounded ${className}`}
      style={{ backgroundColor: 'var(--color-gray-200)', ...style }}
    />
  )
}

/** 3 podium blocks + 10 table rows — matches LeaderboardPage layout */
export function LeaderboardSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Filters row */}
      <div className="flex gap-3">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>

      {/* Podium */}
      <div className="flex items-end justify-center gap-4 py-2">
        {[80, 96, 72].map((h, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Skeleton className="w-10 h-10 rounded-full" />
            <Skeleton style={{ height: h, width: 88 }} className="rounded-xl" />
          </div>
        ))}
      </div>

      {/* Table rows */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border-default)' }}>
            <Skeleton className="w-6 h-4 rounded" />
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <Skeleton className="h-4 rounded flex-1" style={{ maxWidth: 140 + (i % 3) * 40 }} />
            <Skeleton className="h-4 w-12 rounded ml-auto" />
            <Skeleton className="h-4 w-10 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Stat strip + win rate bars + recent games dots — matches StatsPage layout */
export function StatsSkeleton() {
  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Stat strip: 4 cells */}
      <div
        className="rounded-xl border px-4 py-3 grid grid-cols-4 divide-x"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 px-3 py-1">
            <Skeleton className="h-3 w-10 rounded" />
            <Skeleton className="h-6 w-12 rounded" />
          </div>
        ))}
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Win rate bars */}
        <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between">
                <Skeleton className="h-3 rounded" style={{ width: 80 + (i % 3) * 20 }} />
                <Skeleton className="h-3 w-8 rounded" />
              </div>
              <Skeleton className="h-2 rounded-full w-full" />
            </div>
          ))}
        </div>

        {/* Recent games dots */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
          <div className="flex gap-1 flex-wrap">
            {Array.from({ length: 20 }).map((_, i) => (
              <Skeleton key={i} className="w-5 h-5 rounded-sm" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
