import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '12mb' }));

function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

app.post('/api/scan', async (req, res) => {
  const { imageDataUrl, mode = 'single' } = req.body ?? {};
  const parsedImage = parseDataUrl(imageDataUrl);

  if (!parsedImage) {
    return res.status(400).json({
      error: 'La imagen capturada no tiene un formato válido.',
    });
  }

  const ai = getGenAIClient();
  if (!ai) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY no está configurada. Configúrala en Settings > Secrets para habilitar el escaneo IA.',
    });
  }

  const modeHint =
    mode === 'batch'
      ? 'El usuario seleccionó modo Lote / Multi: identifica el conjunto principal u objeto más valioso y estima el valor total o del lote.'
      : mode === 'barcode'
        ? 'El usuario seleccionó modo Código / Etiqueta: prioriza leer códigos, etiquetas, marcas o números de serie visibles en el objeto.'
        : 'El usuario seleccionó modo Objeto único: identifica marca, modelo exacto o tipo de objeto principal en el encuadre.';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: parsedImage.mimeType,
              data: parsedImage.data,
            },
          },
          {
            text: `Analiza esta fotografía tomada con la cámara para tasar el objeto mostrado. ${modeHint} Responde en español con datos realistas de mercado en USD.`,
          },
        ],
      },
      config: {
        systemInstruction:
          'Eres ValueScan AI, un tasador experto de objetos, electrónica, moda, coleccionables y artículos de segunda mano. Identifica con precisión el objeto de la foto, estima su rango de precio de mercado actual en USD, su categoría, liquidez, estado visual y 3 rasgos clave visibles en la imagen.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            itemName: {
              type: Type.STRING,
              description: 'Nombre técnico, marca y modelo aproximado del objeto identificado.',
            },
            category: {
              type: Type.STRING,
              description: 'Categoría corta o rareza (ej. "Fotografía Pro", "Electrónica", "Raro / Colección").',
            },
            confidence: {
              type: Type.NUMBER,
              description: 'Porcentaje de confianza de identificación entre 50 y 99.9.',
            },
            priceMinUsd: {
              type: Type.NUMBER,
              description: 'Valor mínimo estimado en USD (entero).',
            },
            priceMaxUsd: {
              type: Type.NUMBER,
              description: 'Valor máximo estimado en USD (entero).',
            },
            liquidityLabel: {
              type: Type.STRING,
              description: 'Resumen breve de liquidez o demanda (ej. "Alta liquidez • Demanda activa").',
            },
            conditionNote: {
              type: Type.STRING,
              description: 'Observación breve del estado físico y autenticidad basada en la foto.',
            },
            featureAnchors: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Exactamente 3 etiquetas cortas de rasgos visibles detectados (máx 3 palabras cada una).',
            },
            comparables: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  marketplace: { type: Type.STRING },
                  priceRange: { type: Type.STRING },
                  note: { type: Type.STRING },
                },
                required: ['marketplace', 'priceRange', 'note'],
              },
              description: '2 a 3 referencias comparables de mercado (eBay, Amazon, Wallapop, StockX, etc.).',
            },
          },
          required: [
            'itemName',
            'category',
            'confidence',
            'priceMinUsd',
            'priceMaxUsd',
            'liquidityLabel',
            'conditionNote',
            'featureAnchors',
            'comparables',
          ],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return res.status(502).json({
        error: 'El motor de IA devolvió una respuesta vacía. Intenta tomar otra fotografía.',
      });
    }

    const result = JSON.parse(rawText);
    return res.json({
      ok: true,
      result,
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ValueScan /api/scan error]', err);
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    const message =
      status === 403 || status === 400
        ? 'Error de autenticación o solicitud inválida en el servicio de IA. Verifica GEMINI_API_KEY en Settings > Secrets.'
        : status === 429
          ? 'Se alcanzó el límite temporal de solicitudes al motor de IA. Intenta de nuevo en unos segundos.'
          : err?.message || 'No se pudo completar el análisis de la fotografía.';

    return res.status(status).json({ error: message });
  }
});

const OSM_USER_AGENT = 'ValueScanAI/1.0 (https://valuescan.local)';

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDistanceLabel(meters) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function inferPlaceSearchProfile(itemName = '', category = '') {
  const text = `${itemName} ${category}`.toLowerCase();

  if (/cámara|camara|fotograf|lente|sony alpha|canon|nikon|fujifilm|leica|gopro/.test(text)) {
    return {
      keywords: ['fotografia', 'camara', 'electronica', 'empeño'],
      reasonPrefix: 'Fotografía, óptica o compra-venta especializada',
    };
  }
  if (/zapatilla|sneaker|calzado|nike|adidas|jordan|zapato|bota/.test(text)) {
    return {
      keywords: ['zapatillas', 'calzado', 'deportes', 'segunda mano'],
      reasonPrefix: 'Calzado, deporte o consignación',
    };
  }
  if (/reloj|joya|oro|plata|anillo|pulsera|rolex|casio|seiko|lujo/.test(text)) {
    return {
      keywords: ['relojeria', 'joyeria', 'empeño', 'compraventa'],
      reasonPrefix: 'Tasación de relojería, joyería o empeño',
    };
  }
  if (/computador|laptop|notebook|macbook|pc|tablet|ipad|celular|iphone|samsung|audio|audifono|auricular|bose|consola|nintendo|playstation|xbox|electrón|electron/.test(text)) {
    return {
      keywords: ['electronica', 'computacion', 'celulares', 'servicio tecnico'],
      reasonPrefix: 'Electrónica, servicio técnico o reventa tech',
    };
  }
  if (/libro|revista|comic|vinilo|disco|guitarra|instrumento|colecc|antig|arte|cuadro|juguete|lego|carta/.test(text)) {
    return {
      keywords: ['libreria', 'antiguedades', 'coleccionables', 'musica'],
      reasonPrefix: 'Coleccionables, antigüedades o cultura',
    };
  }
  if (/herramienta|taladro|sierra|bici|bicicleta|hogar|mueble|silla|mesa|lampara/.test(text)) {
    return {
      keywords: ['ferreteria', 'herramientas', 'muebles', 'segunda mano'],
      reasonPrefix: 'Equipamiento, taller o artículos de hogar',
    };
  }

  return {
    keywords: ['tienda', 'electronica', 'segunda mano', 'compraventa'],
    reasonPrefix: 'Comercio o punto de compra-venta cercano',
  };
}

const OSM_TYPE_LABELS = {
  electronics: 'Electrónica',
  mobile_phone: 'Telefonía móvil',
  computer: 'Computación',
  camera: 'Fotografía y cámaras',
  photo: 'Estudio / Fotografía',
  hifi: 'Audio y Hi-Fi',
  video_games: 'Videojuegos',
  shoes: 'Calzado y zapatillas',
  sports: 'Deportes',
  clothes: 'Indumentaria y moda',
  boutique: 'Boutique',
  jewelry: 'Joyería',
  watches: 'Relojería',
  pawnbroker: 'Casa de empeño',
  second_hand: 'Segunda mano',
  antiques: 'Antigüedades',
  books: 'Librería',
  musical_instrument: 'Instrumentos musicales',
  music: 'Música y discos',
  hardware: 'Ferretería y herramientas',
  doityourself: 'Hogar y herramientas',
  furniture: 'Muebles y hogar',
  department_store: 'Tienda por departamento',
  mall: 'Centro comercial',
  gift: 'Regalos y colección',
  toys: 'Juguetería',
  bicycle: 'Bicicletas',
  repair: 'Servicio técnico',
  yes: 'Comercio local',
};

function translateOsmType(osmKey, osmValue) {
  if (osmValue && OSM_TYPE_LABELS[osmValue]) {
    return OSM_TYPE_LABELS[osmValue];
  }
  if (osmKey === 'craft') return 'Taller / Servicio técnico';
  if (osmKey === 'amenity') return 'Servicio local';
  if (osmKey === 'shop') return 'Tienda especializada';
  return 'Lugar de interés';
}

function buildPhotonAddress(props = {}) {
  const streetLine = [props.street, props.housenumber].filter(Boolean).join(' ');
  const areaLine = [props.locality || props.district, props.city || props.county].filter(Boolean).join(', ');
  return [streetLine, areaLine].filter(Boolean).join(' · ') || props.state || props.country || 'Ubicación registrada';
}

app.get('/api/geocode/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Ingresa al menos 2 caracteres para buscar una ubicación.' });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': OSM_USER_AGENT,
        'Accept-Language': 'es',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      throw new Error(`Nominatim respondió con estado ${response.status}`);
    }

    const raw = await response.json();
    const results = (Array.isArray(raw) ? raw : []).map((item) => {
      const addr = item.address || {};
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.state || '';
      const shortLabel =
        item.name ||
        [addr.road, addr.house_number].filter(Boolean).join(' ') ||
        city ||
        item.display_name;

      return {
        displayName: item.display_name,
        shortLabel,
        city,
        lat: Number(item.lat),
        lng: Number(item.lon),
      };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));

    return res.json({ ok: true, results });
  } catch (err) {
    console.error('[ValueScan /api/geocode/search error]', err);
    return res.status(502).json({
      error: 'No se pudo consultar el servicio de direcciones en este momento.',
    });
  }
});

app.get('/api/geocode/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lon ?? req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Coordenadas inválidas.' });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': OSM_USER_AGENT,
        'Accept-Language': 'es',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      throw new Error(`Nominatim reverse respondió con estado ${response.status}`);
    }

    const data = await response.json();
    const addr = data.address || {};
    const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.state || '';
    const country = addr.country_code ? addr.country_code.toUpperCase() : '';
    const shortAddress =
      [street || addr.neighbourhood || addr.suburb, city].filter(Boolean).join(', ') ||
      data.display_name ||
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    return res.json({
      ok: true,
      lat,
      lng,
      address: shortAddress,
      city: [city, country].filter(Boolean).join(', '),
    });
  } catch (err) {
    console.error('[ValueScan /api/geocode/reverse error]', err);
    return res.json({
      ok: true,
      lat,
      lng,
      address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      city: 'Ubicación manual',
    });
  }
});

app.post('/api/nearby-places', async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const itemName = String(req.body?.itemName || '').trim();
  const category = String(req.body?.category || '').trim();
  const radiusMeters = Math.min(10000, Math.max(1000, Number(req.body?.radiusMeters || 3000)));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Debes registrar una ubicación válida primero.' });
  }

  const profile = inferPlaceSearchProfile(itemName, category);

  // If Gemini is configured, ask quickly for 2 additional hyper-specific place keywords
  let searchKeywords = [...profile.keywords];
  const ai = getGenAIClient();
  if (ai && (itemName || category)) {
    try {
      const aiResp = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Para el objeto "${itemName || category}" (categoría: "${category || 'General'}"), sugiere exactamente 2 palabras clave cortas en español de tipos de tiendas o lugares locales donde se pueda tasar, vender, comprar o reparar (ej: "joyeria", "fotografia", "empeño", "zapatillas").`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                keywords: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['keywords'],
            },
          },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI keyword timeout')), 2800)),
      ]);
      const parsed = JSON.parse((aiResp.text || '{}').trim());
      if (Array.isArray(parsed.keywords)) {
        const cleaned = parsed.keywords
          .map((k) => String(k || '').trim().toLowerCase())
          .filter((k) => k.length >= 3 && k.length <= 28);
        searchKeywords = Array.from(new Set([...cleaned, ...searchKeywords])).slice(0, 4);
      }
    } catch (_) {
      // Deterministic keywords remain ready
    }
  }

  const latDelta = radiusMeters / 111320;
  const cosLat = Math.max(0.2, Math.abs(Math.cos((lat * Math.PI) / 180)));
  const lonDelta = radiusMeters / (111320 * cosLat);
  const bbox = `${(lng - lonDelta).toFixed(5)},${(lat - latDelta).toFixed(5)},${(lng + lonDelta).toFixed(5)},${(lat + latDelta).toFixed(5)}`;

  async function queryPhoton(keyword) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(keyword)}&bbox=${bbox}&lat=${lat}&lon=${lng}&limit=10`;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': OSM_USER_AGENT },
        signal: AbortSignal.timeout(6500),
      });
      if (!resp.ok) return [];
      const json = await resp.json();
      return Array.isArray(json.features) ? json.features : [];
    } catch (_) {
      return [];
    }
  }

  try {
    const batchResults = await Promise.all(searchKeywords.map((kw) => queryPhoton(kw)));
    let allFeatures = batchResults.flat();

    if (allFeatures.length < 3) {
      const fallback = await queryPhoton('tienda');
      allFeatures = [...allFeatures, ...fallback];
    }

    const seen = new Set();
    const places = [];

    for (const feat of allFeatures) {
      const coords = feat?.geometry?.coordinates;
      const props = feat?.properties || {};
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const pLng = Number(coords[0]);
      const pLat = Number(coords[1]);
      if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

      const name = String(props.name || '').trim();
      if (!name) continue;

      const osmKey = String(props.osm_key || '');
      const osmValue = String(props.osm_value || '');
      if (osmKey && !['shop', 'amenity', 'craft', 'office', 'tourism'].includes(osmKey)) {
        continue;
      }

      const distanceMeters = haversineMeters(lat, lng, pLat, pLng);
      if (distanceMeters > radiusMeters * 1.35) continue;

      const dedupKey = `${props.osm_type || ''}:${props.osm_id || ''}:${name.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      places.push({
        id: dedupKey,
        name,
        placeType: translateOsmType(osmKey, osmValue),
        relevanceReason: profile.reasonPrefix,
        address: buildPhotonAddress(props),
        lat: pLat,
        lng: pLng,
        distanceMeters,
        distanceLabel: formatDistanceLabel(distanceMeters),
        directionsUrl: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${lat}%2C${lng}%3B${pLat}%2C${pLng}`,
      });
    }

    places.sort((a, b) => a.distanceMeters - b.distanceMeters);

    return res.json({
      ok: true,
      keywordsUsed: searchKeywords,
      radiusMeters,
      places: places.slice(0, 14),
    });
  } catch (err) {
    console.error('[ValueScan /api/nearby-places error]', err);
    return res.status(502).json({
      error: 'No se pudieron consultar lugares cercanos en este momento.',
    });
  }
});

function sendNoCacheHtml(res, ...segments) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, ...segments));
}

app.get('/', (_req, res) => {
  sendNoCacheHtml(res, 'valuescan_pantalla_de_inicio', 'code.html');
});

app.get('/inicio', (_req, res) => {
  sendNoCacheHtml(res, 'valuescan_pantalla_de_inicio', 'code.html');
});

app.get('/escanear', (_req, res) => {
  sendNoCacheHtml(res, 'valuescan_escaneo_activo_ia', 'code.html');
});

app.get('/mapa', (_req, res) => {
  sendNoCacheHtml(res, 'valuescan_mapa', 'code.html');
});

app.get('/historial', (_req, res) => {
  sendNoCacheHtml(res, 'valuescan_historial', 'code.html');
});

app.get('/perfil', (_req, res) => {
  sendNoCacheHtml(res, 'valuescan_perfil', 'code.html');
});

app.use(express.static(__dirname));

app.use((_req, res) => {
  sendNoCacheHtml(res, 'valuescan_pantalla_de_inicio', 'code.html');
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
