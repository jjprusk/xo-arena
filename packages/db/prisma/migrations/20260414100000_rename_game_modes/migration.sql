-- Rename GameMode enum values: PVP→HVH, PVAI→HVA, PVBOT→HVB, BOTVBOT→BVB
-- Rename TournamentMode enum value: PVP→HVH
-- Note: ALTER TYPE ... RENAME VALUE requires PostgreSQL 10+

ALTER TYPE "GameMode" RENAME VALUE 'PVP'     TO 'HVH';
ALTER TYPE "GameMode" RENAME VALUE 'PVAI'    TO 'HVA';
ALTER TYPE "GameMode" RENAME VALUE 'PVBOT'   TO 'HVB';
ALTER TYPE "GameMode" RENAME VALUE 'BOTVBOT' TO 'BVB';

ALTER TYPE "TournamentMode" RENAME VALUE 'PVP' TO 'HVH';
