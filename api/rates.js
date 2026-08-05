// api/rates.js
// Forzar región São Paulo (Brasil) — más cercano a Venezuela,
// evita el bloqueo geográfico del BCV a servidores de EEUU.

export const config = {
  regions: ['gru1'],
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = Date.now();
  let bcvUsd = null, bcvEur = null, bcvSource = 'error';

  // ── 1. Scraping directo bcv.org.ve ────────────────────────────────────────
  try {
    const r = await fetch('https://www.bcv.org.ve/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-VE,es;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (r.ok) {
      const html = await r.text();

      function extractById(id) {
        const idx = html.indexOf(`id="${id}"`);
        if (idx === -1) return null;
        const block = html.slice(idx, idx + 500);
        const m = block.match(/<strong>([\d.,]+)<\/strong>/);
        if (!m) return null;
        const val = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
        return isNaN(val) || val < 1 ? null : val;
      }

      bcvUsd = extractById('dolar');
      bcvEur = extractById('euro');
      console.log(`BCV direct: USD=${bcvUsd} EUR=${bcvEur} html=${html.length}`);
      if (bcvUsd) bcvSource = 'bcv_direct';
    }
  } catch (err) {
    console.log('BCV direct failed:', err.message);
  }

  // ── 2. Respaldo: pydolarve y dolarapi en paralelo, más reciente gana ───────
  if (!bcvUsd) {
    const [pyRes, daUsdRes, daEurRes] = await Promise.allSettled([
      fetch(`https://pydolarve.org/api/v1/dollar?page=bcv&_nocache=${now}`, {
        headers: { 'Cache-Control': 'no-cache' }
      }).then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
        headers: { 'Cache-Control': 'no-cache' }
      }).then(r => r.json()),
      fetch('https://ve.dolarapi.com/v1/euros/oficial', {
        headers: { 'Cache-Control': 'no-cache' }
      }).then(r => r.json()),
    ]);

    const candidates = [];

    if (pyRes.status === 'fulfilled') {
      const d = pyRes.value;
      const usd = d?.monedas?.usd?.price ? parseFloat(d.monedas.usd.price) : null;
      const eur = d?.monedas?.eur?.price ? parseFloat(d.monedas.eur.price) : null;
      const ts  = d?.monedas?.usd?.last_update ? new Date(d.monedas.usd.last_update).getTime() : 0;
      console.log(`pydolarve: USD=${usd} ts=${d?.monedas?.usd?.last_update}`);
      if (usd) candidates.push({ usd, eur, ts, source: 'pydolarve' });
    }

    if (daUsdRes.status === 'fulfilled') {
      const usd = daUsdRes.value?.promedio ? parseFloat(daUsdRes.value.promedio) : null;
      const eur = daEurRes.status === 'fulfilled' ? parseFloat(daEurRes.value?.promedio) : null;
      const ts  = daUsdRes.value?.fechaActualizacion
        ? new Date(daUsdRes.value.fechaActualizacion).getTime() : 0;
      console.log(`dolarapi: USD=${usd} ts=${daUsdRes.value?.fechaActualizacion}`);
      if (usd) candidates.push({ usd, eur, ts, source: 'dolarapi' });
    }

    candidates.sort((a, b) => b.ts - a.ts);
    const best = candidates[0];
    if (best) { bcvUsd = best.usd; bcvEur = best.eur; bcvSource = best.source; }
  }

  // ── 3. Binance P2P ─────────────────────────────────────────────────────────
  let binanceUsd = null;
  try {
    const binRes = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: 'USDT', fiat: 'VES', merchantCheck: false,
        page: 1, payTypes: [], publisherType: null, rows: 10, tradeType: 'BUY'
      })
    });
    if (binRes.ok) {
      const data = await binRes.json();
      if (data?.data?.length > 0) {
        const prices = data.data.map(i => parseFloat(i.adv.price)).filter(p => p > 0);
        if (prices.length) binanceUsd = parseFloat((prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2));
      }
    }
  } catch (err) {
    console.log('Binance failed:', err.message);
  }

  return res.status(200).json({
    bcv_usd:     bcvUsd     ? parseFloat(bcvUsd.toFixed(2))     : null,
    bcv_eur:     bcvEur     ? parseFloat(bcvEur.toFixed(2))     : null,
    binance_usd: binanceUsd,
    sources:     { bcv: bcvSource, binance: binanceUsd ? 'ok' : 'error' },
    timestamp:   new Date().toISOString(),
  });
};
