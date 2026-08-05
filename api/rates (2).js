// api/rates.js — Vercel Serverless Function
// Replica exactamente el scraper Python de StudiosDanilIs/BCV-Tasa-Oficial
// Clave: el BCV tiene problemas SSL, así que usamos NODE_TLS_REJECT_UNAUTHORIZED=0

export const config = {
  regions: ['gru1'], // São Paulo — más cercano a Venezuela
};

// Deshabilitar verificación SSL igual que Python: session.verify = False
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function fetchBCV() {
  const res = await fetch('https://www.bcv.org.ve/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-VE,es;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`BCV HTTP ${res.status}`);
  const html = await res.text();
  console.log(`BCV HTML length: ${html.length}`);

  // Mismo método que BeautifulSoup: soup.find('div', id='dolar')
  // luego .find('strong').text.strip()
  function extractById(id) {
    const marker = `id="${id}"`;
    const idx = html.indexOf(marker);
    if (idx === -1) {
      console.log(`id="${id}" NOT FOUND`);
      return null;
    }
    const block = html.slice(idx, idx + 600);
    const m = block.match(/<strong>([\d.,]+)<\/strong>/);
    if (!m) {
      console.log(`<strong> not found near id="${id}". Block snippet: ${block.slice(0, 150)}`);
      return null;
    }
    const val = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    console.log(`id="${id}" → raw="${m[1]}" val=${val}`);
    return isNaN(val) || val < 1 ? null : val;
  }

  return {
    usd: extractById('dolar'),
    eur: extractById('euro'),
  };
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

async function fetchFallback() {
  const [u, e] = await Promise.all([
    fetch('https://ve.dolarapi.com/v1/dolares/oficial').then(r => r.json()),
    fetch('https://ve.dolarapi.com/v1/euros/oficial').then(r => r.json()),
  ]);
  return {
    usd: u?.promedio ? parseFloat(u.promedio) : null,
    eur: e?.promedio ? parseFloat(e.promedio) : null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const [bcvRes, binRes] = await Promise.allSettled([fetchBCV(), fetchBinance()]);

  let bcv_usd = null, bcv_eur = null, source = 'error';

  if (bcvRes.status === 'fulfilled' && bcvRes.value?.usd) {
    bcv_usd = bcvRes.value.usd;
    bcv_eur = bcvRes.value.eur;
    source = 'bcv_direct';
    console.log(`✅ BCV direct OK: USD=${bcv_usd} EUR=${bcv_eur}`);
  } else {
    console.log(`❌ BCV direct failed: ${bcvRes.reason?.message ?? 'no data'} — using fallback`);
    try {
      const fb = await fetchFallback();
      bcv_usd = fb.usd;
      bcv_eur = fb.eur;
      source = 'dolarapi_fallback';
    } catch (e) {
      console.log('Fallback also failed:', e.message);
    }
  }

  const binance_usd = binRes.status === 'fulfilled' ? binRes.value : null;

  return res.status(200).json({
    bcv_usd:     bcv_usd     ? parseFloat(bcv_usd.toFixed(2))     : null,
    bcv_eur:     bcv_eur     ? parseFloat(bcv_eur.toFixed(2))     : null,
    binance_usd: binance_usd ? parseFloat(binance_usd.toFixed(2)) : null,
    sources: { bcv: source, binance: binance_usd ? 'ok' : 'error' },
    timestamp: new Date().toISOString(),
  });
}
