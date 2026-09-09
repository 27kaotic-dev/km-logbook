/* KM Logbook - data layer (localStorage) */
window.KMS = window.KMS || {};

KMS.store = (function () {
  const K_SETTINGS = 'kmslog.settings.v1';
  const K_TRIPS = 'kmslog.trips.v1';
  const K_ACTIVE = 'kmslog.activeTripId.v1';

  const DEFAULT_SETTINGS = {
    vehicle: { make: '', model: '', engineCapacity: '', registration: '' },
    logbookPeriod: { startDate: '', startOdometer: null, endDate: '', endOdometer: null },
    centsPerKmRate: 0.88,          // $/km - editable; ATO rate for 2024-25 was 0.88
    gpsAccuracyThreshold: 30,      // metres
    lastOdometer: null,
    requirePurposeForWork: true,
    keepTrack: false
  };

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('store.read failed', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('store.write failed', key, e);
      alert('Could not save data - device storage may be full or blocked.');
      return false;
    }
  }

  function getSettings() {
    const s = read(K_SETTINGS, null);
    if (!s) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // shallow-merge to pick up new default keys
    return Object.assign(
      JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      s,
      {
        vehicle: Object.assign({}, DEFAULT_SETTINGS.vehicle, s.vehicle || {}),
        logbookPeriod: Object.assign({}, DEFAULT_SETTINGS.logbookPeriod, s.logbookPeriod || {})
      }
    );
  }

  function saveSettings(s) {
    write(K_SETTINGS, s);
    return s;
  }

  function getTrips() {
    const list = read(K_TRIPS, []);
    return Array.isArray(list) ? list : [];
  }

  function saveTrips(list) {
    write(K_TRIPS, list);
  }

  function getTrip(id) {
    return getTrips().find(function (t) { return t.id === id; }) || null;
  }

  function upsertTrip(trip) {
    const list = getTrips();
    const i = list.findIndex(function (t) { return t.id === trip.id; });
    if (i >= 0) list[i] = trip; else list.push(trip);
    saveTrips(list);
    return trip;
  }

  function deleteTrip(id) {
    saveTrips(getTrips().filter(function (t) { return t.id !== id; }));
  }

  function getActiveTripId() {
    return read(K_ACTIVE, null);
  }

  function setActiveTripId(id) {
    if (id) write(K_ACTIVE, id);
    else { try { localStorage.removeItem(K_ACTIVE); } catch (e) {} }
  }

  function newTrip(startOdometer) {
    return {
      id: uuid(),
      startTime: new Date().toISOString(),
      endTime: null,
      startOdometer: startOdometer == null ? null : Number(startOdometer),
      endOdometer: null,
      gpsDistanceKm: 0,
      distanceKm: 0,
      classification: null,   // 'work' | 'personal'
      purpose: '',
      notes: '',
      startLocation: null,
      endLocation: null,
      track: [],
      status: 'active'
    };
  }

  /* Authoritative distance: odometer diff if both present & sane, else override/gps */
  function resolveDistance(trip) {
    const so = trip.startOdometer, eo = trip.endOdometer;
    if (so != null && eo != null && eo >= so && (eo - so) < 5000) {
      return round1(eo - so);
    }
    if (trip.distanceOverride != null && trip.distanceOverride > 0) {
      return round1(trip.distanceOverride);
    }
    return round1(trip.gpsDistanceKm || 0);
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  function exportBackup() {
    return {
      app: 'km-logbook',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      trips: getTrips()
    };
  }

  function importBackup(obj) {
    if (!obj || obj.app !== 'km-logbook') throw new Error('Not a KM Logbook backup file.');
    if (obj.settings) saveSettings(obj.settings);
    if (Array.isArray(obj.trips)) saveTrips(obj.trips);
  }

  function clearAll() {
    try {
      localStorage.removeItem(K_SETTINGS);
      localStorage.removeItem(K_TRIPS);
      localStorage.removeItem(K_ACTIVE);
    } catch (e) {}
  }

  return {
    uuid,
    getSettings, saveSettings,
    getTrips, saveTrips, getTrip, upsertTrip, deleteTrip,
    getActiveTripId, setActiveTripId,
    newTrip, resolveDistance, round1,
    exportBackup, importBackup, clearAll,
    DEFAULT_SETTINGS
  };
})();
