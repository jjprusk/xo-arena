-- Phase 7a (Realtime_Migration_Plan.md Risk R7): per-table realtime transport.
-- Pinned at create time from the `realtime.gameflow.via` SystemConfig flag so
-- a mid-rollout PvP doesn't split the table across transports.
ALTER TABLE "tables" ADD COLUMN "gameflowVia" TEXT NOT NULL DEFAULT 'socketio';
