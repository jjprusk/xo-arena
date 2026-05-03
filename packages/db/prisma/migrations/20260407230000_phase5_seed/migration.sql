-- Seed SystemConfig: default replay retention days for completed tournaments
INSERT INTO "system_config" ("key", "value", "updatedAt")
VALUES ('tournament.replay.defaultRetentionDays', '30', NOW())
ON CONFLICT ("key") DO NOTHING;
