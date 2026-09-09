/* KM Logbook - GPS tracking */
window.KMS = window.KMS || {};

KMS.geo = (function () {
  let watchId = null;
  let wakeLock = null;
  let lastFix = null;          // {lat, lon, ts}
  let onUpdate = null;         // callback({distanceKm, speedKmh, accuracy, coords})
  let accuracyThreshold = 30;
  let running = false;

  const R = 6371000; // earth radius, metres

  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function toRad(d) { return (d * Math.PI) / 180; }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', function () { wakeLock = null; });
      }
    } catch (e) { /* not fatal */ }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  // re-acquire wake lock when tab becomes visible again
  document.addEventListener('visibilitychange', function () {
    if (running && document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
  });

  function start(opts) {
    opts = opts || {};
    onUpdate = opts.onUpdate || null;
    accuracyThreshold = opts.accuracyThreshold || 30;
    lastFix = null;
    running = true;

    let distanceM = opts.resumeDistanceKm ? opts.resumeDistanceKm * 1000 : 0;

    if (!('geolocation' in navigator)) {
      if (opts.onError) opts.onError('This device has no geolocation support.');
      return;
    }

    requestWakeLock();

    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        const c = pos.coords;
        const fix = { lat: c.latitude, lon: c.longitude, ts: pos.timestamp };
        const acc = c.accuracy || 999;

        let accepted = false;
        if (acc <= accuracyThreshold) {
          if (lastFix) {
            const d = haversine(lastFix, fix);
            const dt = Math.max(1, (fix.ts - lastFix.ts) / 1000);
            const implied = d / dt; // m/s
            // ignore GPS noise (<4 m) and impossible jumps (>62 m/s ~ 223 km/h)
            if (d >= 4 && implied <= 62) {
              distanceM += d;
              lastFix = fix;
              accepted = true;
            } else if (d >= 4) {
              // large jump, don't add but re-anchor so we don't accumulate later
              lastFix = fix;
            }
          } else {
            lastFix = fix;
            accepted = true;
          }
        }

        if (onUpdate) {
          onUpdate({
            distanceKm: distanceM / 1000,
            speedKmh: c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null,
            accuracy: acc,
            coords: { lat: c.latitude, lon: c.longitude },
            accepted: accepted
          });
        }
      },
      function (err) {
        if (opts.onError) opts.onError(geoErrText(err));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }
    );
  }

  function getCurrent() {
    return new Promise(function (resolve) {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
        function () { resolve(null); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
    });
  }

  function stop() {
    running = false;
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    releaseWakeLock();
    const last = lastFix ? { lat: lastFix.lat, lon: lastFix.lon } : null;
    lastFix = null;
    return last;
  }

  function geoErrText(err) {
    if (!err) return 'Location error.';
    if (err.code === 1) return 'Location permission denied. Enable it in your browser site settings.';
    if (err.code === 2) return 'Location unavailable right now.';
    if (err.code === 3) return 'Location request timed out.';
    return err.message || 'Location error.';
  }

  return { start, stop, getCurrent, isRunning: function () { return running; } };
})();
