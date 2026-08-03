// api/rates.js

module.exports = async function handler(req, res) {
  // Encabezados para evitar cualquier tipo de caché
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let bcvUsd = null;
  let bcvEur = null;
  let binanceUsd = null;

  let sourcesStatus = { bcv: 'error', binance: 'error' };
  const now = Date.now();

  // 1. Obtener BCV USD y EUR (Fuente Principal: PyDolarVE - Actualización inmediata con el BCV)
  try {
    const pydolarRes = await fetch(`https://pydolarve.org/api/v1/dollar?page=bcv&_nocache=${now}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (pydolarRes.ok) {
      const data = await pydolarRes.json();
      if (data?.monedas?.usd?.price) {
        bcvUsd = parseFloat(data.monedas.usd.price);
      }
      if (data?.monedas?.eur?.price) {
        bcvEur = parseFloat(data.monedas.eur.price);
      }
      if (bcvUsd) sourcesStatus.bcv = 'ok';
    }
  } catch (err) {
    console.error('Error con PyDolarVE:', err);
  }

  // Respaldo 1 BCV: DolarApi VE (Si PyDolarVE falla)
  if (!bcvUsd) {
    try {
      const resUsd = await fetch(`https://ve.dolarapi.com/v1/dolares/oficial?_nocache=${now}`, { cache: 'no-store' });
      if (resUsd.ok) {
        const dataUsd = await resUsd.json();
        if (dataUsd?.promedio) bcvUsd = parseFloat(dataUsd.promedio);
      }

      const resEur = await fetch(`https://ve.dolarapi.com/v1/euros/oficial?_nocache=${now}`, { cache: 'no-store' });
      if (resEur.ok) {
        const dataEur = await resEur.json();
        if (dataEur?.promedio) bcvEur = parseFloat(dataEur.promedio);
      }

      if (bcvUsd) sourcesStatus.bcv = 'ok';
    } catch (err) {
      console.error('Error en Respaldo DolarApi:', err);
    }
  }

  // Respaldo 2 BCV: Open ER API (Internacional)
  if (!bcvUsd) {
    try {
      const erRes = await fetch(`https://open.er-api.com/v6/latest/USD?_nocache=${now}`, { cache: 'no-store' });
      if (erRes.ok) {
        const erData = await erRes.json();
        if (erData?.rates?.VES) {
          bcvUsd = parseFloat(erData.rates.VES);
          sourcesStatus.bcv = 'ok';
        }
      }
    } catch (err) {
      console.error('Error en Respaldo Open ER API:', err);
    }
  }

  // 2. Consulta DIRECTA a Binance P2P (Promedio de las primeras 10 ofertas)
  try {
    const binanceRes = await fetch(`https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search?_nocache=${now}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        asset: 'USDT',
        fiat: 'VES',
        merchantCheck: false,
        page: 1,
        payTypes: [],
        publisherType: null,
        rows: 10,
        tradeType: 'BUY'
      }),
      cache: 'no-store'
    });

    if (binanceRes.ok) {
      const p2pData = await binanceRes.json();
      if (p2pData?.data?.length > 0) {
        const prices = p2pData.data.map(item => parseFloat(item.adv.price));
        const sum = prices.reduce((acc, curr) => acc + curr, 0);
        binanceUsd = sum / prices.length;
        sourcesStatus.binance = 'ok';
      }
    }
  } catch (err) {
    console.error('Error directo con Binance P2P:', err);
  }

  // Retornar la respuesta con 2 decimales
  return res.status(200).json({
    bcv_usd: bcvUsd ? parseFloat(bcvUsd.toFixed(2)) : null,
    bcv_eur: bcvEur ? parseFloat(bcvEur.toFixed(2)) : null,
    binance_usd: binanceUsd ? parseFloat(binanceUsd.toFixed(2)) : null,
    sources: sourcesStatus,
    timestamp: new Date().toISOString()
  });
};