// A3a.2 schema audit — sanity-check that the new TrainingSession columns
// and the new TrainingCheckpoint / TrainingMetric tables read/write through
// Prisma without surprises. These tests exercise real Postgres (matches the
// rest of the backend vitest suite) and clean up after themselves.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import db from '../../lib/db.js'

let userId, modelId

beforeEach(async () => {
  const user = await db.user.create({
    data: {
      betterAuthId: `ba_t_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      email: `t_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`,
      username: `t_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      displayName: 'A3a audit user',
    },
  })
  userId = user.id

  const skill = await db.botSkill.create({
    data: {
      createdBy:  user.id,
      gameId:     'tic-tac-toe',
      algorithm:  'qlearning',
      name:       'A3a audit skill',
      weights:    {},
      config:     {},
      status:     'IDLE',
    },
  })
  modelId = skill.id
})

afterEach(async () => {
  // Cascade deletes via FK ON DELETE CASCADE handle checkpoints/metrics.
  await db.trainingSession.deleteMany({ where: { modelId } })
  await db.botSkill.deleteMany({ where: { id: modelId } })
  await db.user.deleteMany({ where: { id: userId } })
})

describe('A3a.2 — TrainingSession schema audit', () => {
  it('writes and reads the new TrainingSession fields', async () => {
    const session = await db.trainingSession.create({
      data: {
        modelId,
        mode:                'SELF_PLAY',
        iterations:          1000,
        status:              'PENDING',
        config:              {},
        preset:              'standard',
        expectedDurationMs:  4 * 60 * 60 * 1000,
        approvalStatus:      'NEEDED',
        approvalRequestedAt: new Date(),
      },
    })

    const read = await db.trainingSession.findUnique({ where: { id: session.id } })
    expect(read.preset).toBe('standard')
    expect(read.expectedDurationMs).toBe(4 * 60 * 60 * 1000)
    expect(read.approvalStatus).toBe('NEEDED')
    expect(read.approvalRequestedAt).toBeInstanceOf(Date)
    expect(read.pausedAt).toBeNull()
    expect(read.checkpointEpisode).toBeNull()
    expect(read.approvedById).toBeNull()
  })

  it('records and reads a TrainingCheckpoint', async () => {
    const session = await db.trainingSession.create({
      data: { modelId, mode: 'SELF_PLAY', iterations: 100, status: 'RUNNING', config: {} },
    })

    const checkpoint = await db.trainingCheckpoint.create({
      data: {
        sessionId:    session.id,
        episodeNum:   50,
        weights:      { layer1: [0.1, 0.2] },
        runtimeState: { epsilon: 0.4 },
      },
    })

    await db.trainingSession.update({
      where: { id: session.id },
      data:  { checkpointEpisode: 50 },
    })

    const read = await db.trainingCheckpoint.findUnique({ where: { id: checkpoint.id } })
    expect(read.episodeNum).toBe(50)
    expect(read.weights).toEqual({ layer1: [0.1, 0.2] })
    expect(read.runtimeState).toEqual({ epsilon: 0.4 })

    const updatedSession = await db.trainingSession.findUnique({ where: { id: session.id } })
    expect(updatedSession.checkpointEpisode).toBe(50)
  })

  it('rejects duplicate (sessionId, episodeNum) checkpoint pairs', async () => {
    const session = await db.trainingSession.create({
      data: { modelId, mode: 'SELF_PLAY', iterations: 100, status: 'RUNNING', config: {} },
    })

    await db.trainingCheckpoint.create({
      data: { sessionId: session.id, episodeNum: 25, weights: {} },
    })

    await expect(
      db.trainingCheckpoint.create({
        data: { sessionId: session.id, episodeNum: 25, weights: {} },
      })
    ).rejects.toThrow()
  })

  it('records TrainingMetric rows for stacked W/D/L curves', async () => {
    const session = await db.trainingSession.create({
      data: { modelId, mode: 'SELF_PLAY', iterations: 100, status: 'RUNNING', config: {} },
    })

    await db.trainingMetric.createMany({
      data: [
        { sessionId: session.id, episodeNum: 20, opponentLabel: 'primary', wins: 5, draws: 3, losses: 4 },
        { sessionId: session.id, episodeNum: 20, opponentLabel: 'easy',    wins: 4, draws: 0, losses: 0 },
        { sessionId: session.id, episodeNum: 20, opponentLabel: 'medium',  wins: 2, draws: 1, losses: 1 },
        { sessionId: session.id, episodeNum: 40, opponentLabel: 'primary', wins: 8, draws: 2, losses: 2 },
      ],
    })

    const points = await db.trainingMetric.findMany({
      where:   { sessionId: session.id, opponentLabel: 'primary' },
      orderBy: { episodeNum: 'asc' },
    })
    expect(points).toHaveLength(2)
    expect(points[0]).toMatchObject({ episodeNum: 20, wins: 5, draws: 3, losses: 4 })
    expect(points[1]).toMatchObject({ episodeNum: 40, wins: 8, draws: 2, losses: 2 })

    const labels = await db.trainingMetric.findMany({
      where:   { sessionId: session.id, episodeNum: 20 },
      select:  { opponentLabel: true },
    })
    expect(new Set(labels.map(r => r.opponentLabel))).toEqual(new Set(['primary', 'easy', 'medium']))
  })

  it('records an asFirstMover-split TrainingMetric row (Master curve)', async () => {
    const session = await db.trainingSession.create({
      data: { modelId, mode: 'SELF_PLAY', iterations: 100, status: 'RUNNING', config: {} },
    })

    await db.trainingMetric.create({
      data: {
        sessionId:     session.id,
        episodeNum:    100,
        opponentLabel: 'master',
        wins:          0,
        draws:         3,
        losses:        2,
        asFirstMover:  true,
      },
    })

    const row = await db.trainingMetric.findFirst({
      where: { sessionId: session.id, opponentLabel: 'master' },
    })
    expect(row.asFirstMover).toBe(true)
  })

  it('cascades checkpoints + metrics on session delete', async () => {
    const session = await db.trainingSession.create({
      data: { modelId, mode: 'SELF_PLAY', iterations: 100, status: 'RUNNING', config: {} },
    })
    await db.trainingCheckpoint.create({
      data: { sessionId: session.id, episodeNum: 10, weights: {} },
    })
    await db.trainingMetric.create({
      data: { sessionId: session.id, episodeNum: 10, opponentLabel: 'primary', wins: 1 },
    })

    await db.trainingSession.delete({ where: { id: session.id } })

    const checkpoints = await db.trainingCheckpoint.findMany({ where: { sessionId: session.id } })
    const metrics     = await db.trainingMetric.findMany({ where: { sessionId: session.id } })
    expect(checkpoints).toEqual([])
    expect(metrics).toEqual([])
  })
})
