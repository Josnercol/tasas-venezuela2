// api/rates.js
// Estrategia: consultar TODAS las fuentes en paralelo y elegir
// la que tenga el timestamp MÁS RECIENTE — no la primera que responda.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = Date.now();

  // ── Lanzar TODAS las fuentes en paralelo ───────────────────────────────────
  const [pyRes, daUsdRes, daEurRes, binRes] = await Promise.allSettled([

    // Fuente A: pydolarve.org — scrapea el BCV directamente
    fetch(`https://pydolarve.org/api/v1/dollar?page=bcv&_nocache=${now}`, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    }).then(r => r.json()),

    // Fuente B: ve.dolarapi.com USD
    fetch(`https://ve.dolarapi.com/v1/dolares/oficial`, {
      headers: { 'Cache-Control': 'no-cache' }
    }).then(r => r.json()),

    // Fuente C: ve.dolarapi.com EUR
    fetch(`https://ve.dolarapi.com/v1/euros/oficial`, {
      headers: { 'Cache-Control': 'no-cache' }
    }).then(r => r.json()),

    // Binance P2P
    fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: 'USDT', fiat: 'VES', merchantCheck: false,
        page: 1, payTypes: [], publisherType: null, rows: 10, tradeType: 'BUY'
      })
    }).then(r => r.json()),
  ]);

  // ── Extraer valores y timestamps de cada fuente ────────────────────────────
  const candidates = [];

  // pydolarve: { monedas: { usd: { price, last_update }, eur: { price, last_update } } }
  if (pyRes.status === 'fulfilled') {
    const d = pyRes.value;
    const usdPrice = d?.monedas?.usd?.price ? parseFloat(d.monedas.usd.price) : null;
    const eurPrice = d?.monedas?.eur?.price ? parseFloat(d.monedas.eur.price) : null;
    const ts = d?.monedas?.usd?.last_update
      ? new Date(d.monedas.usd.last_update).getTime()
      : 0;
    console.log(`pydolarve: USD=${usdPrice} EUR=${eurPrice} ts=${d?.monedas?.usd?.last_update}`);
    if (usdPrice) candidates.push({ usd: usdPrice, eur: eurPrice, ts, source: 'pydolarve' });
  }

  // dolarapi: { promedio, fechaActualizacion }
  if (daUsdRes.status === 'fulfilled' && daEurRes.status === 'fulfilled') {
    const usdPrice = daUsdRes.value?.promedio ? parseFloat(daUsdRes.value.promedio) : null;
    const eurPrice = daEurRes.value?.promedio ? parseFloat(daEurRes.value.promedio) : null;
    const ts = daUsdRes.value?.fechaActualizacion
      ? new Date(daUsdRes.value.fechaActualizacion).getTime()
      : 0;
    console.log(`dolarapi: USD=${usdPrice} EUR=${eurPrice} ts=${daUsdRes.value?.fechaActualizacion}`);
    if (usdPrice) candidates.push({ usd: usdPrice, eur: eurPrice, ts, source: 'dolarapi' });
  }

  // Elegir el candidato con timestamp más reciente
  candidates.sort((a, b) => b.ts - a.ts);
  const best = candidates[0] || null;

  console.log(`Best source: ${best?.source} USD=${best?.usd} EUR=${best?.eur} ts=${best?.ts}`);

  // ── Binance ────────────────────────────────────────────────────────────────
  let binanceUsd = null;
  if (binRes.status === 'fulfilled') {
    const data = binRes.value;
    if (data?.data?.length > 0) {
      const prices = data.data.map(i => parseFloat(i.adv.price)).filter(p => p > 0);
      if (prices.length) binanceUsd = parseFloat((prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2));
    }
  }

  return res.status(200).json({
    bcv_usd:     best ? parseFloat(best.usd.toFixed(2)) : null,
    bcv_eur:     best?.eur ? parseFloat(best.eur.toFixed(2)) : null,
    binance_usd: binanceUsd,
    sources: {
      bcv: best?.source || 'error',
      bcv_timestamp: best ? new Date(best.ts).toISOString() : null,
      binance: binanceUsd ? 'ok' : 'error'
    },
    timestamp: new Date().toISOString(),
  });
};
