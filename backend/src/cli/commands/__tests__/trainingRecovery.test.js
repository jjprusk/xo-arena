// Pure state-machine tests for the crash-recovery verify command.
// The I/O half (DB polling, restart messaging) is excluded — these tests
// just lock down the decision rules.

import { describe, it, expect } from 'vitest'
import { evaluateVerifyState } from '../trainingRecovery.js'

const baseSession = {
  status:            'COMPLETED',
  iterations:        5000,
  checkpointEpisode: 5000,
  summary:           { wins: 100 },
  modelId:           'm1',
}

describe('evaluateVerifyState', () => {
  it('COMPLETED + final checkpoint near end + IDLE skill = PASS with no anomalies', () => {
    const result = evaluateVerifyState({
      session: baseSession,
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('pass')
    expect(result.anomalies).toEqual([])
  })

  it('PENDING (still waiting for resume): returns continue', () => {
    const result = evaluateVerifyState({
      session: { ...baseSession, status: 'PENDING' },
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('continue')
  })

  it('RUNNING (resume in flight): returns continue', () => {
    const result = evaluateVerifyState({
      session: { ...baseSession, status: 'RUNNING' },
      botSkill: { status: 'TRAINING' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('continue')
  })

  it('FAILED status: fail with summary in reason', () => {
    const result = evaluateVerifyState({
      session: { ...baseSession, status: 'FAILED', summary: { resumeError: 'no checkpoint' } },
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('fail')
    expect(result.reason).toMatch(/FAILED/)
    expect(result.reason).toMatch(/no checkpoint/)
  })

  it('CANCELLED status: fail (treated as externally aborted)', () => {
    const result = evaluateVerifyState({
      session: { ...baseSession, status: 'CANCELLED' },
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('fail')
    expect(result.reason).toMatch(/CANCELLED/)
  })

  it('COMPLETED but BotSkill still locked: PASS with anomaly', () => {
    const result = evaluateVerifyState({
      session: baseSession,
      botSkill: { status: 'TRAINING' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('pass')
    expect(result.anomalies).toContain('BotSkill.status=TRAINING (expected IDLE)')
  })

  it('COMPLETED but final checkpoint far below target AND no summary: anomaly', () => {
    const result = evaluateVerifyState({
      session: {
        ...baseSession,
        checkpointEpisode: 1500,   // resumed but didn't finish work
        summary: {},
      },
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('pass')
    expect(result.anomalies).toContain('completed without finishing iterations')
  })

  it('COMPLETED with low checkpoint but populated summary: no anomaly (early-stop counts as work done)', () => {
    const result = evaluateVerifyState({
      session: {
        ...baseSession,
        checkpointEpisode: 2000,
        summary: { earlyStop: true, stoppedAt: 2500 },
      },
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('pass')
    expect(result.anomalies).toEqual([])
  })

  it('session disappeared between polls: fail immediately', () => {
    const result = evaluateVerifyState({
      session: null,
      botSkill: null,
      startedFromCheckpoint: 1000,
    })
    expect(result.kind).toBe('fail')
    expect(result.reason).toMatch(/disappeared/)
  })

  it('PASS but startedFromCheckpoint was null: flags it as an anomaly (caller bug)', () => {
    const result = evaluateVerifyState({
      session: baseSession,
      botSkill: { status: 'IDLE' },
      startedFromCheckpoint: null,
    })
    expect(result.kind).toBe('pass')
    expect(result.anomalies).toContain('no checkpoint at start of verify')
  })
})
