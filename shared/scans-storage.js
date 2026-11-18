(function(global) {
  const STORAGE_KEY = 'valuescan_recent_scans';
  const MAX_SCANS = 25;

  function getRecentScans() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(item => item && typeof item === 'object' && item.itemName)
        .sort((a, b) => new Date(b.scannedAt || 0).getTime() - new Date(a.scannedAt || 0).getTime());
    } catch (_) {
      return [];
    }
  }

  function notifyScansUpdated() {
    try {
      global.dispatchEvent(new CustomEvent('valuescan:scans-updated'));
    } catch (_) {}
  }

  function persistList(list) {
    let items = list.slice(0, MAX_SCANS);
    while (items.length > 0) {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        notifyScansUpdated();
        return items;
      } catch (err) {
        if (items.length === 1) {
          // Strip imageDataUrl from last item if still over quota
          items = [{ ...items[0], imageDataUrl: '' }];
          try {
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
            notifyScansUpdated();
            return items;
          } catch (_) {
            return [];
          }
        }
        items = items.slice(0, items.length - 1);
      }
    }
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      notifyScansUpdated();
    } catch (_) {}
    return [];
  }

  function createThumbnail(dataUrl, maxSide = 240) {
    return new Promise(resolve => {
      if (!dataUrl || typeof dataUrl !== 'string') {
        resolve('');
        return;
      }
      const img = new Image();
      img.onload = function() {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = function() {
        resolve('');
      };
      img.src = dataUrl;
    });
  }

  async function saveRecentScan(result, imageDataUrl, mode = 'single') {
    const thumbnail = await createThumbnail(imageDataUrl, 240);
    const existing = getRecentScans();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      itemName: result.itemName || 'Objeto analizado',
      category: result.category || 'General',
      confidence: Number(result.confidence || 92),
      priceMinUsd: Number(result.priceMinUsd || 0),
      priceMaxUsd: Number(result.priceMaxUsd || 0),
      liquidityLabel: result.liquidityLabel || 'Demanda activa',
      conditionNote: result.conditionNote || '',
      featureAnchors: Array.isArray(result.featureAnchors) ? result.featureAnchors.slice(0, 3) : [],
      comparables: Array.isArray(result.comparables) ? result.comparables.slice(0, 4) : [],
      mode,
      imageDataUrl: thumbnail,
      scannedAt: new Date().toISOString(),
    };
    const updated = persistList([entry, ...existing]);
    return { entry, list: updated };
  }

  function deleteRecentScan(id) {
    const existing = getRecentScans();
    const updated = existing.filter(item => String(item.id) !== String(id));
    return persistList(updated);
  }

  function clearRecentScans() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
      notifyScansUpdated();
    } catch (_) {}
    return [];
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return 'Reciente';
    const ts = new Date(isoString).getTime();
    if (Number.isNaN(ts)) return 'Reciente';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'Hace un momento';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;
    return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  function formatUsdRange(minVal, maxVal) {
    const minP = Number(minVal || 0).toLocaleString('en-US');
    const maxP = Number(maxVal || 0).toLocaleString('en-US');
    return `$${minP} – $${maxP}`;
  }

  const PROFILE_KEY = 'valuescan_profile';
  const PREFS_KEY = 'valuescan_preferences';
  const LOCATION_KEY = 'valuescan_user_location';

  const DEFAULT_PROFILE = {
    name: 'Coleccionista ValueScan',
    specialty: 'Electrónica & Coleccionables',
    location: 'Santiago, CL',
    avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDnslrSNk7LAdESiwiKke2C-aU2rJ8OpmZa0nFRYDtcQwzZ2WUunto1CaPctfEJ-VP81atPwCGiMJRrxAkvYg4GyXo2yNycVJOl7LdGuC1-RiJzYh4H3HsZOIeGOERRcz_PQnI7yg8PfbEskwDClWi-PYpF8lwbZXKE_cncTE7kDrxrcmUEXen_wAoGnEJ4pl5P_i7xWwjZQ9QwG1U5eD3eoHbib3ugB4IMD6HuuJw',
  };

  const DEFAULT_PREFERENCES = {
    defaultMode: 'single',
    hapticFeedback: true,
    autoSave: true,
    showTips: true,
  };

  function getProfile() {
    try {
      const raw = global.localStorage.getItem(PROFILE_KEY);
      if (!raw) return { ...DEFAULT_PROFILE };
      return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    } catch (_) {
      return { ...DEFAULT_PROFILE };
    }
  }

  function saveProfile(profile) {
    const merged = { ...DEFAULT_PROFILE, ...getProfile(), ...profile };
    try {
      global.localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    } catch (_) {}
    return merged;
  }

  function getPreferences() {
    try {
      const raw = global.localStorage.getItem(PREFS_KEY);
      if (!raw) return { ...DEFAULT_PREFERENCES };
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
    } catch (_) {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  function savePreferences(prefs) {
    const merged = { ...DEFAULT_PREFERENCES, ...getPreferences(), ...prefs };
    try {
      global.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    } catch (_) {}
    return merged;
  }

  function getUserLocation() {
    try {
      const raw = global.localStorage.getItem(LOCATION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Number.isFinite(Number(parsed.lat)) || !Number.isFinite(Number(parsed.lng))) {
        return null;
      }
      return {
        lat: Number(parsed.lat),
        lng: Number(parsed.lng),
        address: parsed.address || '',
        city: parsed.city || '',
        source: parsed.source || 'pin',
        updatedAt: parsed.updatedAt || '',
      };
    } catch (_) {
      return null;
    }
  }

  function saveUserLocation(location) {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const payload = {
      lat,
      lng,
      address: String(location?.address || '').trim(),
      city: String(location?.city || '').trim(),
      source: location?.source || 'pin',
      updatedAt: new Date().toISOString(),
    };
    try {
      global.localStorage.setItem(LOCATION_KEY, JSON.stringify(payload));
      global.dispatchEvent(new CustomEvent('valuescan:location-updated', { detail: payload }));
    } catch (_) {}
    return payload;
  }

  function clearUserLocation() {
    try {
      global.localStorage.removeItem(LOCATION_KEY);
      global.dispatchEvent(new CustomEvent('valuescan:location-updated', { detail: null }));
    } catch (_) {}
  }

  global.ValueScanStorage = {
    STORAGE_KEY,
    MAX_SCANS,
    getRecentScans,
    saveRecentScan,
    deleteRecentScan,
    clearRecentScans,
    formatRelativeTime,
    formatUsdRange,
    getProfile,
    saveProfile,
    getPreferences,
    savePreferences,
    getUserLocation,
    saveUserLocation,
    clearUserLocation,
  };
})(window);
