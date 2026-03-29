// Normal CDF approximation (Abramowitz & Stegun)
function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)
  const p = 1 - pdf * poly
  return z >= 0 ? p : 1 - p
}

function twoTailPValue(z) {
  return 2 * (1 - normalCDF(Math.abs(z)))
}

// One-sample proportion z-test vs p0 null hypothesis (default 0.5)
export function proportionPValue(wins, total, p0 = 0.5) {
  if (total === 0) return 1
  const p = wins / total
  const se = Math.sqrt(p0 * (1 - p0) / total)
  if (se === 0) return 1
  const z = (p - p0) / se
  return parseFloat(twoTailPValue(z).toFixed(4))
}

// Two-sample proportion z-test
export function twoProportionPValue(wins1, n1, wins2, n2) {
  if (n1 === 0 || n2 === 0) return 1
  const p1 = wins1 / n1
  const p2 = wins2 / n2
  const pPool = (wins1 + wins2) / (n1 + n2)
  if (pPool === 0 || pPool === 1) return 1
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2))
  if (se === 0) return p1 === p2 ? 1 : 0
  const z = (p1 - p2) / se
  return parseFloat(twoTailPValue(z).toFixed(4))
}
