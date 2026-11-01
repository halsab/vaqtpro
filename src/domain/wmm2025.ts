import { wrap360 } from './qibla'

export interface WmmInput { year: number; latitude: number; longitude: number; altitudeKm: number }
export type WmmResult =
  | { kind: 'calculated'; declinationEastDegrees: number; horizontalIntensityNt: number; x: number; y: number; z: number; f: number; inclinationDegrees: number }
  | { kind: 'invalid-input' | 'unsupported-date' | 'unstable-horizontal-field' }

const ORDER = 12
const WIDTH = ORDER + 1
const EPOCH = 2025
const REFERENCE_RADIUS_KM = 6371.2
const WGS84_A_KM = 6378.137
const WGS84_B_KM = 6356.7523142
const WGS84_E2 = WGS84_A_KM ** 2 - WGS84_B_KM ** 2
const DEG = Math.PI / 180
// NOAA NCEI WMM2025 COF coefficients, epoch 2025.0, public-domain U.S. Government data.
const COEFFICIENTS: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 0, -29351.8, 0.0, 12.0, 0.0],
  [1, 1, -1410.8, 4545.4, 9.7, -21.5],
  [2, 0, -2556.6, 0.0, -11.6, 0.0],
  [2, 1, 2951.1, -3133.6, -5.2, -27.7],
  [2, 2, 1649.3, -815.1, -8.0, -12.1],
  [3, 0, 1361.0, 0.0, -1.3, 0.0],
  [3, 1, -2404.1, -56.6, -4.2, 4.0],
  [3, 2, 1243.8, 237.5, 0.4, -0.3],
  [3, 3, 453.6, -549.5, -15.6, -4.1],
  [4, 0, 895.0, 0.0, -1.6, 0.0],
  [4, 1, 799.5, 278.6, -2.4, -1.1],
  [4, 2, 55.7, -133.9, -6.0, 4.1],
  [4, 3, -281.1, 212.0, 5.6, 1.6],
  [4, 4, 12.1, -375.6, -7.0, -4.4],
  [5, 0, -233.2, 0.0, 0.6, 0.0],
  [5, 1, 368.9, 45.4, 1.4, -0.5],
  [5, 2, 187.2, 220.2, 0.0, 2.2],
  [5, 3, -138.7, -122.9, 0.6, 0.4],
  [5, 4, -142.0, 43.0, 2.2, 1.7],
  [5, 5, 20.9, 106.1, 0.9, 1.9],
  [6, 0, 64.4, 0.0, -0.2, 0.0],
  [6, 1, 63.8, -18.4, -0.4, 0.3],
  [6, 2, 76.9, 16.8, 0.9, -1.6],
  [6, 3, -115.7, 48.8, 1.2, -0.4],
  [6, 4, -40.9, -59.8, -0.9, 0.9],
  [6, 5, 14.9, 10.9, 0.3, 0.7],
  [6, 6, -60.7, 72.7, 0.9, 0.9],
  [7, 0, 79.5, 0.0, -0.0, 0.0],
  [7, 1, -77.0, -48.9, -0.1, 0.6],
  [7, 2, -8.8, -14.4, -0.1, 0.5],
  [7, 3, 59.3, -1.0, 0.5, -0.8],
  [7, 4, 15.8, 23.4, -0.1, 0.0],
  [7, 5, 2.5, -7.4, -0.8, -1.0],
  [7, 6, -11.1, -25.1, -0.8, 0.6],
  [7, 7, 14.2, -2.3, 0.8, -0.2],
  [8, 0, 23.2, 0.0, -0.1, 0.0],
  [8, 1, 10.8, 7.1, 0.2, -0.2],
  [8, 2, -17.5, -12.6, 0.0, 0.5],
  [8, 3, 2.0, 11.4, 0.5, -0.4],
  [8, 4, -21.7, -9.7, -0.1, 0.4],
  [8, 5, 16.9, 12.7, 0.3, -0.5],
  [8, 6, 15.0, 0.7, 0.2, -0.6],
  [8, 7, -16.8, -5.2, -0.0, 0.3],
  [8, 8, 0.9, 3.9, 0.2, 0.2],
  [9, 0, 4.6, 0.0, -0.0, 0.0],
  [9, 1, 7.8, -24.8, -0.1, -0.3],
  [9, 2, 3.0, 12.2, 0.1, 0.3],
  [9, 3, -0.2, 8.3, 0.3, -0.3],
  [9, 4, -2.5, -3.3, -0.3, 0.3],
  [9, 5, -13.1, -5.2, 0.0, 0.2],
  [9, 6, 2.4, 7.2, 0.3, -0.1],
  [9, 7, 8.6, -0.6, -0.1, -0.2],
  [9, 8, -8.7, 0.8, 0.1, 0.4],
  [9, 9, -12.9, 10.0, -0.1, 0.1],
  [10, 0, -1.3, 0.0, 0.1, 0.0],
  [10, 1, -6.4, 3.3, 0.0, 0.0],
  [10, 2, 0.2, 0.0, 0.1, -0.0],
  [10, 3, 2.0, 2.4, 0.1, -0.2],
  [10, 4, -1.0, 5.3, -0.0, 0.1],
  [10, 5, -0.6, -9.1, -0.3, -0.1],
  [10, 6, -0.9, 0.4, 0.0, 0.1],
  [10, 7, 1.5, -4.2, -0.1, 0.0],
  [10, 8, 0.9, -3.8, -0.1, -0.1],
  [10, 9, -2.7, 0.9, -0.0, 0.2],
  [10, 10, -3.9, -9.1, -0.0, -0.0],
  [11, 0, 2.9, 0.0, 0.0, 0.0],
  [11, 1, -1.5, 0.0, -0.0, -0.0],
  [11, 2, -2.5, 2.9, 0.0, 0.1],
  [11, 3, 2.4, -0.6, 0.0, -0.0],
  [11, 4, -0.6, 0.2, 0.0, 0.1],
  [11, 5, -0.1, 0.5, -0.1, -0.0],
  [11, 6, -0.6, -0.3, 0.0, -0.0],
  [11, 7, -0.1, -1.2, -0.0, 0.1],
  [11, 8, 1.1, -1.7, -0.1, -0.0],
  [11, 9, -1.0, -2.9, -0.1, 0.0],
  [11, 10, -0.2, -1.8, -0.1, 0.0],
  [11, 11, 2.6, -2.3, -0.1, 0.0],
  [12, 0, -2.0, 0.0, 0.0, 0.0],
  [12, 1, -0.2, -1.3, 0.0, -0.0],
  [12, 2, 0.3, 0.7, -0.0, 0.0],
  [12, 3, 1.2, 1.0, -0.0, -0.1],
  [12, 4, -1.3, -1.4, -0.0, 0.1],
  [12, 5, 0.6, -0.0, -0.0, -0.0],
  [12, 6, 0.6, 0.6, 0.1, -0.0],
  [12, 7, 0.5, -0.1, -0.0, -0.0],
  [12, 8, -0.1, 0.8, 0.0, 0.0],
  [12, 9, -0.4, 0.1, 0.0, -0.0],
  [12, 10, -0.2, -1.0, -0.1, -0.0],
  [12, 11, -1.3, 0.1, -0.0, 0.0],
  [12, 12, -0.7, 0.2, -0.1, -0.1],
]

export function calculateWmm2025(input: WmmInput): WmmResult {
  const { year, latitude, longitude, altitudeKm } = input
  if (![year, latitude, longitude, altitudeKm].every(Number.isFinite)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return { kind: 'invalid-input' }
  if (year < EPOCH || year >= 2030 || altitudeKm < -1 || altitudeKm > 1900) return { kind: 'unsupported-date' }

  const g = new Float64Array(WIDTH * WIDTH)
  const h = new Float64Array(WIDTH * WIDTH)
  const dg = new Float64Array(WIDTH * WIDTH)
  const dh = new Float64Array(WIDTH * WIDTH)
  for (const [n, m, gn, hn, dgn, dhn] of COEFFICIENTS) {
    const index = n * WIDTH + m
    g[index] = gn; h[index] = hn; dg[index] = dgn; dh[index] = dhn
  }

  const p = new Float64Array(WIDTH * WIDTH)
  const dp = new Float64Array(WIDTH * WIDTH)
  const norm = new Float64Array(WIDTH * WIDTH)
  const k = new Float64Array(WIDTH * WIDTH)
  const index = (n: number, m: number) => n * WIDTH + m
  const read = (values: Float64Array, at: number) => values[at] ?? 0
  norm[index(0, 0)] = p[index(0, 0)] = 1
  for (let n = 1; n <= ORDER; n += 1) {
    let j = 2
    norm[index(n, 0)] = read(norm, index(n - 1, 0)) * (2 * n - 1) / n
    for (let m = 0; m <= n; m += 1) {
      k[index(n, m)] = ((n - 1) ** 2 - m ** 2) / ((2 * n - 1) * (2 * n - 3))
      if (m > 0) {
        norm[index(n, m)] = read(norm, index(n, m - 1)) * Math.sqrt(((n - m + 1) * j) / (n + m))
        j = 1
        h[index(n, m)] = read(h, index(n, m)) * read(norm, index(n, m))
        dh[index(n, m)] = read(dh, index(n, m)) * read(norm, index(n, m))
      }
      g[index(n, m)] = read(g, index(n, m)) * read(norm, index(n, m))
      dg[index(n, m)] = read(dg, index(n, m)) * read(norm, index(n, m))
    }
  }
  k[index(1, 1)] = 0

  const lat = latitude * DEG
  const lon = longitude * DEG
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat)
  const sinLat2 = sinLat * sinLat, cosLat2 = cosLat * cosLat
  const q = Math.sqrt(WGS84_A_KM ** 2 - WGS84_E2 * sinLat2)
  const q1 = altitudeKm * q
  const q2 = ((q1 + WGS84_A_KM ** 2) / (q1 + WGS84_B_KM ** 2)) ** 2
  const ct = sinLat / Math.sqrt(q2 * cosLat2 + sinLat2)
  const st = Math.sqrt(Math.max(0, 1 - ct * ct))
  const r = Math.sqrt(altitudeKm ** 2 + 2 * q1 + (WGS84_A_KM ** 4 - (WGS84_A_KM ** 4 - WGS84_B_KM ** 4) * sinLat2) / q ** 2)
  const d = Math.sqrt(WGS84_A_KM ** 2 * cosLat2 + WGS84_B_KM ** 2 * sinLat2)
  const ca = (altitudeKm + d) / r
  const sa = WGS84_E2 * cosLat * sinLat / (r * d)

  const sinM = new Float64Array(WIDTH), cosM = new Float64Array(WIDTH)
  sinM[0] = 0; cosM[0] = 1; sinM[1] = Math.sin(lon); cosM[1] = Math.cos(lon)
  for (let m = 2; m <= ORDER; m += 1) {
    sinM[m] = read(sinM, 1) * read(cosM, m - 1) + read(cosM, 1) * read(sinM, m - 1)
    cosM[m] = read(cosM, 1) * read(cosM, m - 1) - read(sinM, 1) * read(sinM, m - 1)
  }

  let ar = (REFERENCE_RADIUS_KM / r) ** 2
  let br = 0, bt = 0, bp = 0, bpp = 0
  const pp = new Float64Array(WIDTH)
  pp[0] = 1
  for (let n = 1; n <= ORDER; n += 1) {
    ar *= REFERENCE_RADIUS_KM / r
    for (let m = 0; m <= n; m += 1) {
      if (n === m) {
        p[index(n, m)] = st * read(p, index(n - 1, m - 1))
        dp[index(n, m)] = st * read(dp, index(n - 1, m - 1)) + ct * read(p, index(n - 1, m - 1))
      } else if (n === 1 && m === 0) {
        p[index(n, m)] = ct * read(p, index(n - 1, m))
        dp[index(n, m)] = ct * read(dp, index(n - 1, m)) - st * read(p, index(n - 1, m))
      } else {
        if (m > n - 2) { p[index(n - 2, m)] = 0; dp[index(n - 2, m)] = 0 }
        p[index(n, m)] = ct * read(p, index(n - 1, m)) - read(k, index(n, m)) * read(p, index(n - 2, m))
        dp[index(n, m)] = ct * read(dp, index(n - 1, m)) - st * read(p, index(n - 1, m))
          - read(k, index(n, m)) * read(dp, index(n - 2, m))
      }
      const dt = year - EPOCH
      const coefficient = index(n, m)
      const gn = read(g, coefficient) + dt * read(dg, coefficient)
      const hn = read(h, coefficient) + dt * read(dh, coefficient)
      const t1 = gn * read(cosM, m) + hn * read(sinM, m)
      const t2 = gn * read(sinM, m) - hn * read(cosM, m)
      const par = ar * read(p, index(n, m))
      bt -= ar * t1 * read(dp, index(n, m))
      bp += m * t2 * par
      br += (n + 1) * t1 * par
      if (st === 0 && m === 1) {
        pp[n] = n === 1 ? read(pp, 0) : ct * read(pp, n - 1) - read(k, index(n, 1)) * read(pp, n - 2)
        bpp += m * t2 * ar * read(pp, n)
      }
    }
  }
  if (st === 0) bp = bpp
  else bp /= st
  const x = -bt * ca - br * sa
  const y = bp
  const z = bt * sa - br * ca
  const horizontalIntensityNt = Math.hypot(x, y)
  if (!Number.isFinite(horizontalIntensityNt) || horizontalIntensityNt < 1) return { kind: 'unstable-horizontal-field' }
  const declination = Math.atan2(y, x) / DEG
  return {
    kind: 'calculated',
    declinationEastDegrees: wrap360(declination + 180) - 180,
    horizontalIntensityNt,
    x, y, z,
    f: Math.hypot(horizontalIntensityNt, z),
    inclinationDegrees: Math.atan2(z, horizontalIntensityNt) / DEG,
  }
}
