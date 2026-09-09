/* KM Logbook - UI */
window.KMS = window.KMS || {};

KMS.ui = (function () {
  const S = KMS.store;
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  let activeTrip = null;
  let tickTimer = null;
  let lastPersist = 0;
  let editingId = null;
  let stopClass = null;
  let editClass = null;

  const VIEW_TITLES = { track: 'Track', trips: 'Trips', export: 'Export', settings: 'Settings' };

  /* ---------------- helpers ---------------- */
  function parseNum(v) {
    if (v == null) return null;
    const s = String(v).replace(/[, ]+/g, '').trim();
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  function fmtKm(n) { return (Math.round((n || 0) * 10) / 10).toFixed(1) + ' km'; }
  function two(n) { return String(n).padStart(2, '0'); }
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return two(Math.floor(s / 3600)) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU') + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* ---------------- view switching ---------------- */
  function switchView(name) {
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.view === name); });
    $('#screen-title').textContent = VIEW_TITLES[name] || 'Track';
    if (name === 'trips') renderTrips();
    if (name === 'export') refreshExportForm();
    if (name === 'settings') loadSettingsForm();
  }

  /* ---------------- track screen ---------------- */
  function renderTrackScreen() {
    const s = S.getSettings();
    const v = s.vehicle || {};
    $('#vehicle-warning').hidden = !!(v.make && v.model && v.registration);
    $('#idle-odo').textContent = s.lastOdometer != null ? s.lastOdometer.toLocaleString('en-AU') + ' km' : '—';

    const isActive = !!activeTrip;
    $('#trip-idle').hidden = isActive;
    $('#trip-active').hidden = !isActive;
    if (isActive) updateLive({ distanceKm: activeTrip.gpsDistanceKm, speedKmh: null, accuracy: null });
  }

  function startTick() {
    stopTick();
    tickTimer = setInterval(function () {
      if (!activeTrip) return;
      $('#live-elapsed').textContent = fmtElapsed(Date.now() - new Date(activeTrip.startTime).getTime());
    }, 1000);
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  function updateLive(u) {
    if (u.distanceKm != null) $('#live-distance').textContent = fmtKm(u.distanceKm);
    if (u.speedKmh != null) $('#live-speed').textContent = Math.round(u.speedKmh) + ' km/h';
    if (u.accuracy != null) $('#live-accuracy').textContent = '±' + Math.round(u.accuracy) + ' m';
  }

  function beginTracking(resumeKm) {
    KMS.geo.start({
      accuracyThreshold: S.getSettings().gpsAccuracyThreshold || 30,
      resumeDistanceKm: resumeKm || 0,
      onUpdate: function (u) {
        if (!activeTrip) return;
        activeTrip.gpsDistanceKm = u.distanceKm;
        if (!activeTrip.startLocation && u.coords) activeTrip.startLocation = u.coords;
        updateLive(u);
        const poor = u.accuracy != null && u.accuracy > (S.getSettings().gpsAccuracyThreshold || 30);
        $('#gps-status').textContent = poor
          ? 'Waiting for a better GPS fix (±' + Math.round(u.accuracy) + ' m). Keep the app open – locking the screen may pause GPS.'
          : 'Tracking. Keep the app open – locking the screen may pause GPS.';
        const now = Date.now();
        if (now - lastPersist > 4000) { lastPersist = now; S.upsertTrip(activeTrip); }
      },
      onError: function (msg) { $('#gps-status').textContent = msg; }
    });
  }

  /* ---------------- start flow ---------------- */
  function openStartDialog() {
    if (activeTrip) return;
    const s = S.getSettings();
    $('#start-odo').value = s.lastOdometer != null ? s.lastOdometer : '';
    const dlg = $('#dlg-start');
    dlg.returnValue = '';
    dlg.showModal();
  }

  function onStartDialogClose() {
    const dlg = $('#dlg-start');
    if (dlg.returnValue !== 'go') return;
    const odo = parseNum($('#start-odo').value);
    activeTrip = S.newTrip(odo);
    S.upsertTrip(activeTrip);
    S.setActiveTripId(activeTrip.id);
    lastPersist = Date.now();
    renderTrackScreen();
    startTick();
    $('#gps-status').textContent = 'Getting GPS fix…';
    beginTracking(0);
    KMS.geo.getCurrent().then(function (c) {
      if (c && activeTrip && !activeTrip.startLocation) {
        activeTrip.startLocation = c;
        S.upsertTrip(activeTrip);
      }
    });
  }

  /* ---------------- stop flow ---------------- */
  function openStopDialog() {
    if (!activeTrip) return;
    const lastLoc = KMS.geo.stop();
    stopTick();
    if (lastLoc) activeTrip.endLocation = lastLoc;
    activeTrip.gpsDistanceKm = S.round1(activeTrip.gpsDistanceKm || 0);
    S.upsertTrip(activeTrip);

    stopClass = null;
    setSeg($('#dlg-stop'), null);
    $('#stop-purpose').value = '';
    $('#stop-notes').value = '';
    $('#stop-err').hidden = true;
    const startOdo = activeTrip.startOdometer;
    $('#stop-start-odo').value = startOdo != null ? startOdo : '';
    $('#stop-end-odo').value = startOdo != null ? Math.round(startOdo + activeTrip.gpsDistanceKm) : '';
    $('#stop-gps-line').textContent = 'GPS distance this trip: ' + fmtKm(activeTrip.gpsDistanceKm) +
      '. End odometer is pre‑filled from GPS – correct it to your real reading.';
    $('#purpose-req').hidden = !S.getSettings().requirePurposeForWork;

    const dlg = $('#dlg-stop');
    dlg.returnValue = '';
    dlg.showModal();
  }

  function handleStopResult(result) {
    const dlg = $('#dlg-stop');

    if (result === 'cancel') {
      // resume tracking - trip continues
      startTick();
      beginTracking(activeTrip.gpsDistanceKm || 0);
      return;
    }
    if (result === 'discard') {
      if (!confirm('Discard this trip? It will not be saved.')) { openStopDialog(); return; }
      S.deleteTrip(activeTrip.id);
      S.setActiveTripId(null);
      activeTrip = null;
      renderTrackScreen();
      toast('Trip discarded.');
      return;
    }
    // save
    const s = S.getSettings();
    const startOdo = parseNum($('#stop-start-odo').value);
    const endOdo = parseNum($('#stop-end-odo').value);
    let err = '';
    if (!stopClass) err = 'Choose Work or Personal.';
    else if (stopClass === 'work' && s.requirePurposeForWork && !$('#stop-purpose').value.trim())
      err = 'Enter a purpose for the work trip.';
    else if (startOdo != null && endOdo != null && endOdo < startOdo)
      err = 'End odometer cannot be less than start odometer.';

    if (err) {
      $('#stop-err').textContent = err;
      $('#stop-err').hidden = false;
      dlg.returnValue = '';
      dlg.showModal();
      return;
    }

    activeTrip.endTime = new Date().toISOString();
    activeTrip.classification = stopClass;
    activeTrip.purpose = $('#stop-purpose').value.trim();
    activeTrip.notes = $('#stop-notes').value.trim();
    activeTrip.startOdometer = startOdo;
    activeTrip.endOdometer = endOdo;
    activeTrip.status = 'completed';
    if (!s.keepTrack) activeTrip.track = [];
    S.upsertTrip(activeTrip);

    if (endOdo != null) { s.lastOdometer = endOdo; S.saveSettings(s); }

    S.setActiveTripId(null);
    const savedKm = S.resolveDistance(activeTrip);
    activeTrip = null;
    renderTrackScreen();
    toast('Trip saved – ' + fmtKm(savedKm) + '.');
  }

  /* ---------------- segmented control ---------------- */
  function setSeg(scope, value) {
    $$('.seg-btn', scope).forEach(function (b) {
      b.classList.toggle('is-selected', b.dataset.class === value);
    });
  }

  /* ---------------- trips list ---------------- */
  function renderTrips() {
    const trips = S.getTrips()
      .filter(function (t) { return t.status === 'completed'; })
      .sort(function (a, b) { return new Date(b.startTime) - new Date(a.startTime); });

    $('#trips-count').textContent = trips.length
      ? trips.length + ' trip' + (trips.length === 1 ? '' : 's')
      : '';

    const list = $('#trips-list');
    if (!trips.length) {
      list.innerHTML = '<p class="empty">No trips yet. Tap <strong>Track</strong> to record one.</p>';
      return;
    }

    const groups = new Map();
    trips.forEach(function (t) {
      const d = new Date(t.startTime);
      const key = d.getFullYear() + '-' + two(d.getMonth() + 1);
      const label = d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      if (!groups.has(key)) groups.set(key, { label: label, items: [], work: 0, priv: 0 });
      const g = groups.get(key);
      const km = S.resolveDistance(t);
      g.items.push({ t: t, km: km });
      if (t.classification === 'work') g.work += km; else g.priv += km;
    });

    let html = '';
    Array.from(groups.keys()).sort().reverse().forEach(function (key) {
      const g = groups.get(key);
      html += '<div class="month-group">';
      html += '<div class="month-head"><span>' + g.label + '</span>' +
        '<span class="month-sub">' + fmtKm(g.work) + ' work &middot; ' + fmtKm(g.priv) + ' personal</span></div>';
      g.items.forEach(function (it) {
        const t = it.t;
        const d = new Date(t.startTime);
        const badge = t.classification === 'work' ? 'work' : 'personal';
        html += '<button class="trip-row" data-id="' + t.id + '">' +
          '<span class="trip-date">' + two(d.getDate()) + '/' + two(d.getMonth() + 1) + '</span>' +
          '<span class="trip-main">' +
            '<span class="trip-purpose">' + escapeHtml(t.purpose || (badge === 'work' ? '(no purpose)' : 'Personal travel')) + '</span>' +
            '<span class="trip-meta">' + two(d.getHours()) + ':' + two(d.getMinutes()) + ' &middot; ' + fmtKm(it.km) + '</span>' +
          '</span>' +
          '<span class="pill pill-' + badge + '">' + (badge === 'work' ? 'Work' : 'Personal') + '</span>' +
        '</button>';
      });
      html += '</div>';
    });
    list.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- edit dialog ---------------- */
  function openEditDialog(id) {
    const t = S.getTrip(id);
    if (!t) return;
    editingId = id;
    editClass = t.classification || null;

    const sd = new Date(t.startTime);
    const ed = t.endTime ? new Date(t.endTime) : sd;
    $('#ed-start-date').value = isoDate(sd);
    $('#ed-start-time').value = two(sd.getHours()) + ':' + two(sd.getMinutes());
    $('#ed-end-date').value = isoDate(ed);
    $('#ed-end-time').value = two(ed.getHours()) + ':' + two(ed.getMinutes());
    setSeg($('#dlg-edit'), editClass);
    $('#ed-purpose').value = t.purpose || '';
    $('#ed-start-odo').value = t.startOdometer != null ? t.startOdometer : '';
    $('#ed-end-odo').value = t.endOdometer != null ? t.endOdometer : '';
    $('#ed-distance').value = t.distanceOverride != null ? t.distanceOverride : (t.startOdometer == null || t.endOdometer == null ? S.round1(t.gpsDistanceKm || 0) : '');
    $('#ed-notes').value = t.notes || '';
    $('#ed-err').hidden = true;

    const dlg = $('#dlg-edit');
    dlg.returnValue = '';
    dlg.showModal();
  }

  function isoDate(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }

  function handleEditResult(result) {
    const dlg = $('#dlg-edit');
    const t = S.getTrip(editingId);
    if (!t) return;

    if (result === 'delete') {
      if (!confirm('Delete this trip permanently?')) { openEditDialog(editingId); return; }
      S.deleteTrip(editingId);
      editingId = null;
      renderTrips();
      toast('Trip deleted.');
      return;
    }
    if (result !== 'save') return;

    const sDate = $('#ed-start-date').value, sTime = $('#ed-start-time').value || '00:00';
    const eDate = $('#ed-end-date').value, eTime = $('#ed-end-time').value || '00:00';
    const startOdo = parseNum($('#ed-start-odo').value);
    const endOdo = parseNum($('#ed-end-odo').value);
    const dist = parseNum($('#ed-distance').value);

    let err = '';
    if (!sDate) err = 'Start date is required.';
    else if (!editClass) err = 'Choose Work or Personal.';
    else if (startOdo != null && endOdo != null && endOdo < startOdo) err = 'End odometer is less than start.';
    else if (startOdo == null && endOdo == null && (dist == null || dist <= 0)) err = 'Enter odometer readings or a distance.';

    if (err) {
      $('#ed-err').textContent = err;
      $('#ed-err').hidden = false;
      dlg.returnValue = '';
      dlg.showModal();
      return;
    }

    const start = new Date(sDate + 'T' + sTime);
    let end = eDate ? new Date(eDate + 'T' + eTime) : new Date(start.getTime());
    if (end < start) end = new Date(start.getTime());

    t.startTime = start.toISOString();
    t.endTime = end.toISOString();
    t.classification = editClass;
    t.purpose = $('#ed-purpose').value.trim();
    t.notes = $('#ed-notes').value.trim();
    t.startOdometer = startOdo;
    t.endOdometer = endOdo;
    t.distanceOverride = (startOdo != null && endOdo != null) ? null : dist;
    t.status = 'completed';
    S.upsertTrip(t);

    editingId = null;
    renderTrips();
    toast('Trip updated.');
  }

  /* ---------------- export form ---------------- */
  function refreshExportForm() {
    const trips = S.getTrips();
    const basis = $('#ex-basis').value;
    const periods = KMS.exporter.availablePeriods(trips, basis);
    fillSelect($('#ex-period'), periods.map(function (p) { return { value: p.value, label: p.label }; }));
    refreshMonths();
  }
  function refreshMonths() {
    const trips = S.getTrips();
    const period = $('#ex-period').value;
    const months = KMS.exporter.availableMonths(trips, period);
    fillSelect($('#ex-month'),
      [{ value: '', label: 'Whole period' }].concat(months.map(function (m) { return { value: m.value, label: m.label }; })));
  }
  function fillSelect(sel, opts) {
    const cur = sel.value;
    sel.innerHTML = '';
    opts.forEach(function (o) {
      const el = document.createElement('option');
      el.value = o.value; el.textContent = o.label;
      sel.appendChild(el);
    });
    if (opts.some(function (o) { return o.value === cur; })) sel.value = cur;
  }
  function doExport() {
    try {
      const name = KMS.exporter.run({
        basis: $('#ex-basis').value,
        period: $('#ex-period').value,
        month: $('#ex-month').value || null
      });
      toast('Exported ' + name);
    } catch (e) {
      toast(e.message || 'Export failed.');
    }
  }

  /* ---------------- settings ---------------- */
  function loadSettingsForm() {
    const s = S.getSettings();
    const v = s.vehicle || {}, lp = s.logbookPeriod || {};
    $('#set-make').value = v.make || '';
    $('#set-model').value = v.model || '';
    $('#set-engine').value = v.engineCapacity || '';
    $('#set-rego').value = v.registration || '';
    $('#set-lp-start').value = lp.startDate || '';
    $('#set-lp-start-odo').value = lp.startOdometer != null ? lp.startOdometer : '';
    $('#set-lp-end').value = lp.endDate || '';
    $('#set-lp-end-odo').value = lp.endOdometer != null ? lp.endOdometer : '';
    $('#set-rate').value = s.centsPerKmRate != null ? s.centsPerKmRate : '';
    $('#set-accuracy').value = s.gpsAccuracyThreshold != null ? s.gpsAccuracyThreshold : 30;
    $('#set-last-odo').value = s.lastOdometer != null ? s.lastOdometer : '';
    $('#set-require-purpose').checked = !!s.requirePurposeForWork;
    $('#set-keep-track').checked = !!s.keepTrack;
  }
  function saveSettingsForm() {
    const s = S.getSettings();
    s.vehicle = {
      make: $('#set-make').value.trim(),
      model: $('#set-model').value.trim(),
      engineCapacity: $('#set-engine').value.trim(),
      registration: $('#set-rego').value.trim()
    };
    s.logbookPeriod = {
      startDate: $('#set-lp-start').value || '',
      startOdometer: parseNum($('#set-lp-start-odo').value),
      endDate: $('#set-lp-end').value || '',
      endOdometer: parseNum($('#set-lp-end-odo').value)
    };
    const rate = parseNum($('#set-rate').value);
    s.centsPerKmRate = rate != null ? rate : 0;
    const acc = parseNum($('#set-accuracy').value);
    s.gpsAccuracyThreshold = acc != null && acc >= 5 ? acc : 30;
    s.lastOdometer = parseNum($('#set-last-odo').value);
    s.requirePurposeForWork = $('#set-require-purpose').checked;
    s.keepTrack = $('#set-keep-track').checked;
    S.saveSettings(s);
    renderTrackScreen();
  }

  function backup() {
    const data = JSON.stringify(S.exportBackup(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'km-logbook-backup-' + isoDate(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function restore(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        S.importBackup(JSON.parse(reader.result));
        loadSettingsForm();
        renderTrackScreen();
        toast('Backup restored.');
      } catch (e) {
        toast(e.message || 'Could not read backup.');
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- init ---------------- */
  function bind() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });
    $('#btn-settings').addEventListener('click', function () { switchView('settings'); });
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.dataset.goto); });
    });

    $('#btn-start').addEventListener('click', openStartDialog);
    $('#dlg-start').addEventListener('close', onStartDialogClose);

    $('#btn-stop').addEventListener('click', openStopDialog);
    $('#dlg-stop').addEventListener('close', function () {
      handleStopResult($('#dlg-stop').returnValue || 'cancel');
    });
    $$('#dlg-stop .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { stopClass = b.dataset.class; setSeg($('#dlg-stop'), stopClass); });
    });

    $('#dlg-edit').addEventListener('close', function () {
      handleEditResult($('#dlg-edit').returnValue || 'cancel');
    });
    $$('#dlg-edit .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { editClass = b.dataset.class; setSeg($('#dlg-edit'), editClass); });
    });

    $('#trips-list').addEventListener('click', function (e) {
      const row = e.target.closest('.trip-row');
      if (row) openEditDialog(row.dataset.id);
    });

    $('#ex-basis').addEventListener('change', refreshExportForm);
    $('#ex-period').addEventListener('change', refreshMonths);
    $('#btn-export').addEventListener('click', doExport);
    $('#btn-backup').addEventListener('click', backup);
    $('#file-restore').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) {
        if (confirm('Restore will overwrite current trips and settings. Continue?')) restore(e.target.files[0]);
        e.target.value = '';
      }
    });

    // settings auto-save on change
    ['#set-make', '#set-model', '#set-engine', '#set-rego', '#set-lp-start', '#set-lp-start-odo',
      '#set-lp-end', '#set-lp-end-odo', '#set-rate', '#set-accuracy', '#set-last-odo',
      '#set-require-purpose', '#set-keep-track'].forEach(function (sel) {
      $(sel).addEventListener('change', saveSettingsForm);
    });

    $('#btn-clear').addEventListener('click', function () {
      if (confirm('Delete ALL trips and settings? This cannot be undone.') &&
          confirm('Really delete everything?')) {
        S.clearAll();
        location.reload();
      }
    });
  }

  function resumeActive() {
    const id = S.getActiveTripId();
    if (!id) return;
    const t = S.getTrip(id);
    if (!t || t.status !== 'active') { S.setActiveTripId(null); return; }
    activeTrip = t;
    lastPersist = Date.now();
    renderTrackScreen();
    startTick();
    $('#gps-status').textContent = 'Resuming trip…';
    beginTracking(t.gpsDistanceKm || 0);
    toast('Resumed trip in progress.');
  }

  function init() {
    $('#app-version').textContent = KMS.APP_VERSION || '';
    bind();
    renderTrackScreen();
    resumeActive();
  }

  return { init: init, toast: toast };
})();
