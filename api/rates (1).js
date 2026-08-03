// api/rates.js
// Fuente 1: scraping directo bcv.org.ve (siempre fresco)
// Fuente 2: pydolarve.org (respaldo)
// Fuente 3: ve.dolarapi.com (respaldo)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = Date.now();
  let bcvUsd = null, bcvEur = null, binanceUsd = null;
  let bcvSource = 'error';

  // ── 1. SCRAPING DIRECTO bcv.org.ve ────────────────────────────────────────
  try {
    const bcvRes = await fetch('https://www.bcv.org.ve/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-VE,es;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    if (bcvRes.ok) {
      const html = await bcvRes.text();

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

      console.log(`BCV direct: USD=${bcvUsd} EUR=${bcvEur} (html: ${html.length} chars)`);

      if (bcvUsd) bcvSource = 'bcv_direct';
    }
  } catch (err) {
    console.error('BCV direct scrape failed:', err.message);
  }

  // ── 2. RESPALDO: pydolarve.org ─────────────────────────────────────────────
  if (!bcvUsd) {
    try {
      const r = await fetch(`https://pydolarve.org/api/v1/dollar?page=bcv&_nocache=${now}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (r.ok) {
        const d = await r.json();
        if (d?.monedas?.usd?.price) bcvUsd = parseFloat(d.monedas.usd.price);
        if (d?.monedas?.eur?.price) bcvEur = parseFloat(d.monedas.eur.price);
        if (bcvUsd) bcvSource = 'pydolarve';
        console.log(`pydolarve fallback: USD=${bcvUsd} EUR=${bcvEur}`);
      }
    } catch (err) {
      console.error('pydolarve fallback failed:', err.message);
    }
  }

  // ── 3. RESPALDO: ve.dolarapi.com ───────────────────────────────────────────
  if (!bcvUsd) {
    try {
      const [ru, re] = await Promise.all([
        fetch(`https://ve.dolarapi.com/v1/dolares/oficial?_nocache=${now}`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`https://ve.dolarapi.com/v1/euros/oficial?_nocache=${now}`, { cache: 'no-store' }).then(r => r.json()),
      ]);
      if (ru?.promedio) bcvUsd = parseFloat(ru.promedio);
      if (re?.promedio) bcvEur = parseFloat(re.promedio);
      if (bcvUsd) bcvSource = 'dolarapi';
      console.log(`dolarapi fallback: USD=${bcvUsd} EUR=${bcvEur}`);
    } catch (err) {
      console.error('dolarapi fallback failed:', err.message);
    }
  }

  // ── 4. BINANCE P2P ─────────────────────────────────────────────────────────
  try {
    const binRes = await fetch(`https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        asset: 'USDT', fiat: 'VES', merchantCheck: false,
        page: 1, payTypes: [], publisherType: null, rows: 10, tradeType: 'BUY',
      }),
      cache: 'no-store',
    });
    if (binRes.ok) {
      const p2p = await binRes.json();
      if (p2p?.data?.length > 0) {
        const prices = p2p.data.map(i => parseFloat(i.adv.price));
        binanceUsd = prices.reduce((a, b) => a + b, 0) / prices.length;
      }
    }
  } catch (err) {
    console.error('Binance failed:', err.message);
  }

  return res.status(200).json({
    bcv_usd:     bcvUsd     ? parseFloat(bcvUsd.toFixed(2))     : null,
    bcv_eur:     bcvEur     ? parseFloat(bcvEur.toFixed(2))     : null,
    binance_usd: binanceUsd ? parseFloat(binanceUsd.toFixed(2)) : null,
    sources: { bcv: bcvSource, binance: binanceUsd ? 'ok' : 'error' },
    timestamp: new Date().toISOString(),
  });
};
