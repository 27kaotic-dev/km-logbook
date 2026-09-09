/* KM Logbook - XLSX export (ATO logbook + cents-per-km) */
window.KMS = window.KMS || {};

KMS.exporter = (function () {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function localDate(iso) { return iso ? new Date(iso) : null; }
  function ymKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function ymLabel(d) { return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function hhmm(d) { return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; }

  /* ---- financial-year helpers (AU: 1 Jul - 30 Jun) ---- */
  function fyOf(d) {
    // returns the ending calendar year of the FY (e.g. Aug 2025 -> 2026)
    return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
  }
  function fyLabel(endYear) {
    return 'FY' + (endYear - 1) + '-' + String(endYear).slice(-2);
  }
  function fyRange(endYear) {
    return { start: new Date(endYear - 1, 6, 1, 0, 0, 0), end: new Date(endYear, 5, 30, 23, 59, 59) };
  }
  function cyRange(year) {
    return { start: new Date(year, 0, 1, 0, 0, 0), end: new Date(year, 11, 31, 23, 59, 59) };
  }

  /* ---- list the periods that exist in the data ---- */
  function availablePeriods(trips, basis) {
    const set = new Map();
    trips.forEach(function (t) {
      if (t.status !== 'completed') return;
      const d = localDate(t.startTime);
      if (!d) return;
      if (basis === 'fy') {
        const y = fyOf(d);
        set.set('fy' + y, { value: 'fy' + y, label: fyLabel(y), sort: y });
      } else {
        const y = d.getFullYear();
        set.set('cy' + y, { value: 'cy' + y, label: String(y), sort: y });
      }
    });
    const arr = Array.from(set.values()).sort(function (a, b) { return b.sort - a.sort; });
    arr.push({ value: 'all', label: 'All time', sort: -1 });
    return arr;
  }

  function periodRange(periodValue) {
    if (periodValue === 'all') return null;
    const y = parseInt(periodValue.slice(2), 10);
    return periodValue.slice(0, 2) === 'fy' ? fyRange(y) : cyRange(y);
  }

  function availableMonths(trips, periodValue) {
    const range = periodRange(periodValue);
    const map = new Map();
    trips.forEach(function (t) {
      if (t.status !== 'completed') return;
      const d = localDate(t.startTime);
      if (!d) return;
      if (range && (d < range.start || d > range.end)) return;
      map.set(ymKey(d), { value: ymKey(d), label: ymLabel(d), sort: d.getFullYear() * 12 + d.getMonth() });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.sort - b.sort; });
  }

  function filterTrips(trips, periodValue, monthValue) {
    const range = periodRange(periodValue);
    return trips
      .filter(function (t) { return t.status === 'completed'; })
      .filter(function (t) {
        const d = localDate(t.startTime);
        if (!d) return false;
        if (range && (d < range.start || d > range.end)) return false;
        if (monthValue && ymKey(d) !== monthValue) return false;
        return true;
      })
      .sort(function (a, b) { return new Date(a.startTime) - new Date(b.startTime); });
  }

  function scopeLabel(periodValue, monthValue, periods) {
    const p = (periods.find(function (x) { return x.value === periodValue; }) || {}).label || 'All time';
    if (!monthValue) return p;
    const d = new Date(monthValue + '-01T00:00:00');
    return p + ' - ' + ymLabel(d);
  }

  function distanceSource(t) {
    const so = t.startOdometer, eo = t.endOdometer;
    if (so != null && eo != null && eo >= so && (eo - so) < 5000) return 'odometer';
    if (t.distanceOverride != null && t.distanceOverride > 0) return 'override';
    return 'gps';
  }

  /* ================= workbook builder ================= */
  function build(opts) {
    const S = KMS.store;
    const settings = S.getSettings();
    const allTrips = S.getTrips();
    const periods = availablePeriods(allTrips, opts.basis);
    const trips = filterTrips(allTrips, opts.period, opts.month);
    const label = scopeLabel(opts.period, opts.month, periods);

    if (!trips.length) throw new Error('No completed trips in the selected period.');

    let businessKm = 0, privateKm = 0, totalKm = 0;
    const monthAgg = new Map(); // ymKey -> {km, trips, label, sort}

    const logRows = trips.map(function (t) {
      const sd = localDate(t.startTime);
      const ed = localDate(t.endTime) || sd;
      const km = S.resolveDistance(t);
      totalKm += km;
      const isWork = t.classification === 'work';
      if (isWork) businessKm += km; else privateKm += km;

      if (isWork) {
        const key = ymKey(sd);
        const agg = monthAgg.get(key) || { km: 0, trips: 0, label: ymLabel(sd), sort: sd.getFullYear() * 12 + sd.getMonth() };
        agg.km += km; agg.trips += 1;
        monthAgg.set(key, agg);
      }

      return [
        sd,                                   // Date (journey began)
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][sd.getDay()],
        hhmm(sd),
        hhmm(ed),
        t.startOdometer != null ? Number(t.startOdometer) : '',
        t.endOdometer != null ? Number(t.endOdometer) : '',
        Number(km.toFixed(1)),
        isWork ? 'Business' : 'Private',
        t.purpose || (isWork ? '(no purpose recorded)' : 'Private travel'),
        Number((t.gpsDistanceKm || 0).toFixed(1)),
        t.notes || ''
      ];
    });

    businessKm = round1(businessKm);
    privateKm = round1(privateKm);
    totalKm = round1(totalKm);
    const businessPct = totalKm > 0 ? Math.round((businessKm / totalKm) * 1000) / 10 : 0;

    const wb = XLSX.utils.book_new();

    /* ---------- Sheet 1: Logbook ---------- */
    const logHead = [
      ['KM LOGBOOK - ATO LOGBOOK METHOD'],
      ['Scope', label],
      ['Generated', new Date()],
      [],
      ['Date', 'Day', 'Start', 'End', 'Odometer start', 'Odometer end', 'Kilometres', 'Business / Private', 'Purpose of journey', 'GPS km', 'Notes']
    ];
    const logFoot = [
      [],
      ['Total kilometres', '', '', '', '', '', totalKm],
      ['Business kilometres', '', '', '', '', '', businessKm],
      ['Private kilometres', '', '', '', '', '', privateKm],
      ['Business use %', '', '', '', '', '', businessPct]
    ];
    const wsLog = XLSX.utils.aoa_to_sheet(logHead.concat(logRows).concat(logFoot), { cellDates: true });
    wsLog['!cols'] = [
      { wch: 12 }, { wch: 5 }, { wch: 6 }, { wch: 6 }, { wch: 15 }, { wch: 15 },
      { wch: 11 }, { wch: 18 }, { wch: 40 }, { wch: 9 }, { wch: 30 }
    ];
    // date format on col A of the data rows
    const firstDataRow = logHead.length; // 0-indexed row where first trip sits
    for (let i = 0; i < logRows.length; i++) {
      const cell = wsLog[XLSX.utils.encode_cell({ r: firstDataRow + i, c: 0 })];
      if (cell) cell.z = 'dd/mm/yyyy';
    }
    const genCell = wsLog[XLSX.utils.encode_cell({ r: 2, c: 1 })];
    if (genCell) genCell.z = 'dd/mm/yyyy hh:mm';
    XLSX.utils.book_append_sheet(wb, wsLog, 'Logbook');

    /* ---------- Sheet 2: Cents per km ---------- */
    const rate = Number(settings.centsPerKmRate) || 0;
    const monthRows = Array.from(monthAgg.values())
      .sort(function (a, b) { return a.sort - b.sort; })
      .map(function (m) { return [m.label, Number(m.km.toFixed(1)), m.trips]; });
    const cappedKm = Math.min(businessKm, 5000);
    const cpk = [
      ['CENTS PER KILOMETRE METHOD'],
      ['Scope', label],
      ['Rate ($/km)', rate],
      [],
      ['Month', 'Business km', 'Business trips']
    ].concat(monthRows).concat([
      ['TOTAL', businessKm, monthRows.reduce(function (s, r) { return s + r[2]; }, 0)],
      [],
      ['Business km (capped at 5,000)', cappedKm],
      ['Estimated claim ($)', Math.round(cappedKm * rate * 100) / 100],
      [],
      ['Notes'],
      ['Max 5,000 business km per car per year under this method.'],
      ['You need a reasonable basis for the km claimed - this log is that basis.'],
      ['You cannot use cents-per-km and the logbook method for the same car in the same year.']
    ]);
    const wsCpk = XLSX.utils.aoa_to_sheet(cpk, { cellDates: true });
    wsCpk['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 14 }];
    const rateCell = wsCpk[XLSX.utils.encode_cell({ r: 2, c: 1 })];
    if (rateCell) rateCell.z = '0.00';
    const claimCell = wsCpk[XLSX.utils.encode_cell({ r: 5 + monthRows.length + 3, c: 1 })];
    if (claimCell) claimCell.z = '$#,##0.00';
    XLSX.utils.book_append_sheet(wb, wsCpk, 'Cents per km');

    /* ---------- Sheet 3: Vehicle & Period ---------- */
    const v = settings.vehicle || {};
    const lp = settings.logbookPeriod || {};
    let days = '', weeks = '', periodOdoKm = '';
    if (lp.startDate && lp.endDate) {
      const d1 = new Date(lp.startDate + 'T00:00:00');
      const d2 = new Date(lp.endDate + 'T00:00:00');
      days = Math.round((d2 - d1) / 86400000);
      weeks = Math.round((days / 7) * 10) / 10;
    }
    if (lp.startOdometer != null && lp.endOdometer != null) {
      periodOdoKm = Number(lp.endOdometer) - Number(lp.startOdometer);
    }
    const vp = [
      ['KM LOGBOOK - VEHICLE & LOGBOOK PERIOD DETAILS'],
      ['Generated', new Date()],
      ['Export scope', label],
      [],
      ['VEHICLE'],
      ['Make', v.make || ''],
      ['Model', v.model || ''],
      ['Engine capacity', v.engineCapacity || ''],
      ['Registration', v.registration || ''],
      [],
      ['LOGBOOK PERIOD (ATO: continuous period of at least 12 weeks)'],
      ['Period start date', lp.startDate ? new Date(lp.startDate + 'T00:00:00') : ''],
      ['Odometer at period start', lp.startOdometer != null ? Number(lp.startOdometer) : ''],
      ['Period end date', lp.endDate ? new Date(lp.endDate + 'T00:00:00') : ''],
      ['Odometer at period end', lp.endOdometer != null ? Number(lp.endOdometer) : ''],
      ['Days in period', days],
      ['Weeks in period', weeks],
      ['Total km in period (odometer)', periodOdoKm],
      [],
      ['BUSINESS USE % (trips in this export)'],
      ['Business km', businessKm],
      ['Private km', privateKm],
      ['Total km', totalKm],
      ['Business use %', businessPct],
      [],
      ['RECORD-KEEPING NOTES'],
      ['Logbook method claim = business use % x total car expenses for the income year.'],
      ['Record odometer readings at the start and end of each income year you use the logbook method.'],
      ['Keep receipts: fuel & oil (or odometer-based estimate), servicing, rego, insurance, interest, depreciation.'],
      ['A logbook is generally valid for 5 years. Keep records for 5 years after you lodge.'],
      ['This spreadsheet is a record-keeping aid, not tax advice.']
    ];
    const wsVp = XLSX.utils.aoa_to_sheet(vp, { cellDates: true });
    wsVp['!cols'] = [{ wch: 40 }, { wch: 30 }];
    [[1, 1, 'dd/mm/yyyy hh:mm'], [11, 1, 'dd/mm/yyyy'], [13, 1, 'dd/mm/yyyy']].forEach(function (spec) {
      const c = wsVp[XLSX.utils.encode_cell({ r: spec[0], c: spec[1] })];
      if (c && c.v !== '') c.z = spec[2];
    });
    XLSX.utils.book_append_sheet(wb, wsVp, 'Vehicle & Period');

    /* ---------- Sheet 4: All trips (audit) ---------- */
    const auditHead = ['Trip ID', 'Start', 'End', 'Type', 'Purpose', 'Odometer start', 'Odometer end',
      'Distance km (used)', 'GPS km', 'Distance source', 'Start lat', 'Start lon', 'End lat', 'End lon', 'Notes'];
    const auditRows = trips.map(function (t) {
      return [
        t.id,
        localDate(t.startTime),
        localDate(t.endTime) || '',
        t.classification === 'work' ? 'Business' : 'Private',
        t.purpose || '',
        t.startOdometer != null ? Number(t.startOdometer) : '',
        t.endOdometer != null ? Number(t.endOdometer) : '',
        Number(S.resolveDistance(t).toFixed(1)),
        Number((t.gpsDistanceKm || 0).toFixed(1)),
        distanceSource(t),
        t.startLocation ? t.startLocation.lat : '',
        t.startLocation ? t.startLocation.lon : '',
        t.endLocation ? t.endLocation.lat : '',
        t.endLocation ? t.endLocation.lon : '',
        t.notes || ''
      ];
    });
    const wsAudit = XLSX.utils.aoa_to_sheet([auditHead].concat(auditRows), { cellDates: true });
    wsAudit['!cols'] = [{ wch: 38 }, { wch: 17 }, { wch: 17 }, { wch: 10 }, { wch: 32 },
      { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 9 }, { wch: 14 },
      { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 26 }];
    for (let i = 0; i < auditRows.length; i++) {
      [1, 2].forEach(function (col) {
        const c = wsAudit[XLSX.utils.encode_cell({ r: i + 1, c: col })];
        if (c && c.v !== '') c.z = 'dd/mm/yyyy hh:mm';
      });
    }
    XLSX.utils.book_append_sheet(wb, wsAudit, 'All trips');

    const safe = label.replace(/[^\w\- ]+/g, '').trim();
    return { wb: wb, filename: 'KM Logbook - ' + safe + '.xlsx' };
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  function run(opts) {
    const out = build(opts);
    XLSX.writeFile(out.wb, out.filename, { compression: true });
    return out.filename;
  }

  return { availablePeriods, availableMonths, filterTrips, build, run };
})();
