-- Seed default MeritThreshold bands
INSERT INTO "merit_thresholds" ("id", "bandMin", "bandMax", "pos1", "pos2", "pos3", "pos4") VALUES
  ('mband_3',  3,  9,  2, 1, 0, 0),
  ('mband_10', 10, 19, 3, 2, 1, 0),
  ('mband_20', 20, 49, 4, 3, 2, 1),
  ('mband_50', 50, NULL, 5, 4, 3, 2);

-- Seed SystemConfig classification defaults
INSERT INTO "system_config" ("key", "value", "updatedAt") VALUES
  ('classification.tiers.RECRUIT.meritsRequired',    '4',    NOW()),
  ('classification.tiers.CONTENDER.meritsRequired',  '6',    NOW()),
  ('classification.tiers.VETERAN.meritsRequired',    '10',   NOW()),
  ('classification.tiers.ELITE.meritsRequired',      '18',   NOW()),
  ('classification.tiers.CHAMPION.meritsRequired',   '25',   NOW()),
  ('classification.demotion.finishRatioThreshold',   '0.70', NOW()),
  ('classification.demotion.minQualifyingMatches',   '5',    NOW()),
  ('classification.demotion.reviewCadenceDays',      '30',   NOW()),
  ('classification.bestOverallBonus.minParticipants','10',   NOW())
ON CONFLICT ("key") DO NOTHING;
