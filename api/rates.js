// api/rates.js — Vercel Serverless Function

export const config = {
  regions: ['gru1'],
};

async function fetchCotizave() {
  // Se lee DENTRO de la función para asegurar que tome la variable de Vercel
  const apiKey = process.env.COTIZAVE_API_KEY;

  if (!apiKey) {
    throw new Error('COTIZAVE_API_KEY no encontrada en Vercel');
  }

  const res = await fetch('https://api.cotizave.com/v1/fx/rates/reference', {
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

  const [czRes, binRes] = await Promise.allSettled([fetchCotizave(), fetchBinance()]);

  let bcv_usd = null, bcv_eur = null, source = 'error';

  if (czRes.status === 'fulfilled') {
    const d = czRes.value;
    bcv_usd = d?.USD?.mid ?? d?.usd?.mid ?? d?.bcv?.usd ?? d?.rates?.USD ?? null;
    bcv_eur = d?.EUR?.mid ?? d?.eur?.mid ?? d?.bcv?.eur ?? d?.rates?.EUR ?? null;
    if (bcv_usd) source = 'cotizave';
  } else {
    console.error('Cotizave failed:', czRes.reason?.message);
  }

  const binance_usd = binRes.status === 'fulfilled' ? binRes.value : null;

  return res.status(200).json({
    bcv_usd: bcv_usd ? parseFloat(Number(bcv_usd).toFixed(2)) : null,
    bcv_eur: bcv_eur ? parseFloat(Number(bcv_eur).toFixed(2)) : null,
    binance_usd: binance_usd ? parseFloat(binance_usd.toFixed(2)) : null,
    sources: { bcv: source, binance: binance_usd ? 'ok' : 'error' },
    timestamp: new Date().toISOString(),
  });
}
