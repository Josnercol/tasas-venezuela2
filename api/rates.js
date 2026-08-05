// api/rates.js — Vercel Serverless Function

export const config = {
  regions: ['gru1'],
};

async function fetchCotizave() {
  const apiKey = process.env.COTIZAVE_API_KEY;

  if (!apiKey) {
    return { ok: false, error: 'COTIZAVE_API_KEY no encontrada en Vercel' };
  }

  try {
    const res = await fetch('https://api.cotizave.com/v1/fx/rates/reference', {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ok: false, error: `Cotizave HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fetchBinance() {
  try {
    const res = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: 'USDT', fiat: 'VES', merchantCheck: false,
        page: 1, payTypes: [], publisherType: null, rows: 10, tradeType: 'BUY',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const prices = (data?.data || []).map(i => parseFloat(i.adv.price)).filter(p => p > 0);
    if (!prices.length) return null;
    return parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const [czResult, binance_usd] = await Promise.all([fetchCotizave(), fetchBinance()]);

  let bcv_usd = null, bcv_eur = null, source = 'error', raw_cotizave = null, cz_error = null;

  if (czResult.ok) {
    const d = czResult.data;
    raw_cotizave = d; // Guardamos la respuesta cruda para depurar

    // Mapeo flexible de claves
    bcv_usd = d?.USD?.mid ?? d?.usd?.mid ?? d?.bcv?.usd ?? d?.rates?.USD ?? d?.data?.USD?.mid ?? null;
    bcv_eur = d?.EUR?.mid ?? d?.eur?.mid ?? d?.bcv?.eur ?? d?.rates?.EUR ?? d?.data?.EUR?.mid ?? null;

    if (bcv_usd) {
      source = 'cotizave';
    } else {
      cz_error = 'Estructura JSON no reconocida (mira raw_cotizave)';
    }
  } else {
    cz_error = czResult.error;
  }

  return res.status(200).json({
    bcv_usd: bcv_usd ? parseFloat(Number(bcv_usd).toFixed(2)) : null,
    bcv_eur: bcv_eur ? parseFloat(Number(bcv_eur).toFixed(2)) : null,
    binance_usd: binance_usd ? parseFloat(binance_usd.toFixed(2)) : null,
    sources: { bcv: source, binance: binance_usd ? 'ok' : 'error' },
    debug: {
      cotizave_error: cz_error,
      cotizave_raw_response: raw_cotizave
    },
    timestamp: new Date().toISOString(),
  });
}
