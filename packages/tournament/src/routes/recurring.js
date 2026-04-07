/**
 * Recurring tournament registration routes.
 *
 * POST   /recurring/:templateId/register   — create standing registration (auth required)
 * DELETE /recurring/:templateId/register   — opt out (auth required)
 * GET    /recurring/:templateId/registrations — list (admin only)
 */

import { Router } from 'express'
import { requireAuth, requireTournamentAdmin } from '../middleware/auth.js'
import {
  createStandingRegistration,
  cancelStandingRegistration,
  listStandingRegistrations,
} from '../services/recurringService.js'
import logger from '../logger.js'

const router = Router()

router.post('/:templateId/register', requireAuth, async (req, res) => {
  try {
    const reg = await createStandingRegistration(req.params.templateId, req.auth.userId)
    res.status(201).json(reg)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    logger.error({ err }, 'POST recurring register failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:templateId/register', requireAuth, async (req, res) => {
  try {
    const reg = await cancelStandingRegistration(req.params.templateId, req.auth.userId)
    res.json(reg)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    logger.error({ err }, 'DELETE recurring register failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/:templateId/registrations', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const regs = await listStandingRegistrations(req.params.templateId)
    res.json(regs)
  } catch (err) {
    logger.error({ err }, 'GET recurring registrations failed')
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
