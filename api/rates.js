// api/rates.js — Vercel Serverless Function

export const config = {
  regions: ['gru1'],
};

async function fetchCotizave(endpoint = 'reference') {
  const apiKey = process.env.COTIZAVE_API_KEY;

  if (!apiKey) {
    throw new Error('COTIZAVE_API_KEY no encontrada');
  }

  const res = await fetch(`https://api.cotizave.com/v1/fx/rates/${endpoint}`, {
    headers: {
      'X-API-Key': apiKey,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Cotizave HTTP ${res.status}`);
  return res.json();
}

async function fetchBinance() {
  const res = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset: 'USDT', fiat: 'VES', merchantCheck: false,
      page: 1, payTypes: [], publisherType: null, rows: 10, tradeType: 'BUY',
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const data = await res.json();
  const prices = (data?.data || []).map(i => parseFloat(i.adv.price)).filter(p => p > 0);
  if (!prices.length) return null;
  return parseFloat((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const [czUsdRes, czEurRes, binRes] = await Promise.allSettled([
    fetchCotizave('reference'),
    fetchCotizave('eur'),
    fetchBinance()
  ]);

  let bcv_usd = null, bcv_eur = null, source = 'error';

  // Procesar USD (Reference)
  if (czUsdRes.status === 'fulfilled') {
    const d = czUsdRes.value;
    const rate = d?.mid ?? d?.USD?.mid ?? d?.usd?.mid ?? null;
    if (rate) {
      bcv_usd = parseFloat(Number(rate).toFixed(2));
      source = 'cotizave';
    }
  }

  // Procesar EUR
  if (czEurRes.status === 'fulfilled') {
    const d = czEurRes.value;
    const rate = d?.mid ?? d?.EUR?.mid ?? d?.eur?.mid ?? d?.rates?.EUR ?? null;
    if (rate) {
      bcv_eur = parseFloat(Number(rate).toFixed(2));
    }
  }

  // Fallback para Euro si el endpoint /eur no devolvió tasa directamente
  if (!bcv_eur && czUsdRes.status === 'fulfilled') {
    const d = czUsdRes.value;
    const eurRate = d?.EUR?.mid ?? d?.eur?.mid ?? d?.rates?.EUR ?? null;
    if (eurRate) {
      bcv_eur = parseFloat(Number(eurRate).toFixed(2));
    }
  }

  const binance_usd = binRes.status === 'fulfilled' ? binRes.value : null;

  return res.status(200).json({
    bcv_usd,
    bcv_eur,
    binance_usd: binance_usd ? parseFloat(binance_usd.toFixed(2)) : null,
    sources: { bcv: source, binance: binance_usd ? 'ok' : 'error' },
    timestamp: new Date().toISOString(),
  });
}
