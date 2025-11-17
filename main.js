const form = document.getElementById('tracker-form');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const altInput = document.getElementById('alt');
const locationPresetButtons = document.querySelectorAll('[data-location-preset]');
const popupOverlay = document.getElementById('popup-overlay');
const azimuthEl = document.getElementById('azimuth');
const elevationEl = document.getElementById('elevation');
const rangeEl = document.getElementById('range');
const timestampEl = document.getElementById('timestamp');

const currentPassContainer = document.getElementById('current-pass');
const currentPassAosEl = document.getElementById('current-pass-aos');
const currentPassLosEl = document.getElementById('current-pass-los');
const currentPassPeakEl = document.getElementById('current-pass-peak');
const satelliteDataBtn = document.getElementById('satellite-data-btn');
const nextPassContainer = document.getElementById('next-pass');
const nextPassAosEl = document.getElementById('next-pass-aos');
const nextPassLosEl = document.getElementById('next-pass-los');
const nextPassPeakEl = document.getElementById('next-pass-peak');
const tleInput = document.getElementById('tle-block');
const upcomingContainer = document.getElementById('upcoming-passes');
const passListEl = document.getElementById('pass-list');
const tleSearchBtn = document.getElementById('tle-search-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const polarCanvas = document.getElementById('polar-canvas');
const polarCtx = polarCanvas ? polarCanvas.getContext('2d') : null;
let polarDisplaySize = polarCanvas?.clientWidth || 0;
let latestPolarPoint = null;
let cachedNextPass = null;
let currentPassInfo = null;
let currentPassTrackPoints = [];
let nextPassTrackPoints = [];
let isTracking = false;
let cachedUpcomingPasses = [];
let lastSatelliteData = null;
let pendingTleName = null;
let latestSunPoint = null;
const modalRoot = document.getElementById('modal-root');
const modalTitleEl = document.getElementById('modal-title');
const modalContentEl = document.getElementById('modal-content');
const modalCloseBtn = document.getElementById('modal-close-btn');

const MAX_PASS_DURATION_SECONDS = 2 * 3600;
const PASS_SCAN_STEP_SECONDS = 30;
const TRACK_STEP_SECONDS = 30;
const PEAK_SCAN_STEP_SECONDS = 10;
const LOS_SEARCH_LIMIT_SECONDS = 24 * 3600;
const POPUP_OVERLAY_CHECK_INTERVAL = 500;

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'short',
  timeStyle: 'medium',
});


let satrec = null;
let timerId = null;

const deg2rad = (deg) => (deg * Math.PI) / 180;
const rad2deg = (rad) => (rad * 180) / Math.PI;
const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
const formatTimestamp = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--';
  const pad = (num, len = 2) => String(num).padStart(len, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
function openModal({ title = '', content = '' } = {}) {
  if (!modalRoot || !modalContentEl || !modalTitleEl) return;
  modalTitleEl.textContent = title;
  if (typeof content === 'string') {
    modalContentEl.innerHTML = content;
  } else {
    modalContentEl.innerHTML = '';
    modalContentEl.appendChild(content);
  }
  modalRoot.hidden = false;
  document.body?.classList.add('popup-overlay-active');
}

function closeModal() {
  if (!modalRoot) return;
  modalRoot.hidden = true;
  document.body?.classList.remove('popup-overlay-active');
}

if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', closeModal);
}
if (modalRoot) {
  modalRoot.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) {
      closeModal();
    }
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modalRoot?.hidden) {
    closeModal();
  }
});

function applyLocationPreset(lat, lon, alt, label = '観測地点') {
  if (!latInput || !lonInput || !altInput) return;
  const latValue = Number(lat);
  const lonValue = Number(lon);
  const altValue = Number(alt);

  if (Number.isFinite(latValue)) {
    latInput.value = latValue;
  }
  if (Number.isFinite(lonValue)) {
    lonInput.value = lonValue;
  }
  if (Number.isFinite(altValue)) {
    altInput.value = altValue;
  }

  // 画面の最終更新欄はトラッキング結果専用なのでプリセット適用時は触らない
}

function getObserverLocation() {
  if (!window.satellite || !latInput || !lonInput || !altInput) return null;
  const latValue = Number(latInput.value);
  const lonValue = Number(lonInput.value);
  if (!Number.isFinite(latValue) || !Number.isFinite(lonValue)) return null;
  const altitudeMeters = Number(altInput.value);
  const altitudeKm = Number.isFinite(altitudeMeters) ? altitudeMeters / 1000 : 0;
  return {
    latitude: satellite.degreesToRadians(latValue),
    longitude: satellite.degreesToRadians(lonValue),
    height: altitudeKm,
  };
}

function computeSunLookAngles(referenceTime = new Date()) {
  if (!window.satellite) return null;
  const observerGd = getObserverLocation();
  if (!observerGd) return null;
  const year = referenceTime.getUTCFullYear();
  const month = referenceTime.getUTCMonth() + 1;
  const day = referenceTime.getUTCDate();
  const hours = referenceTime.getUTCHours();
  const minutes = referenceTime.getUTCMinutes();
  const seconds = referenceTime.getUTCSeconds();

  const jd = satellite.jday(year, month, day, hours, minutes, seconds);
  const T = (jd - 2451545.0) / 36525;
  const meanLon = normalizeDegrees(280.46646 + T * (36000.76983 + 0.0003032 * T));
  const meanAnomaly = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const meanLonRad = deg2rad(meanLon);
  const meanAnomalyRad = deg2rad(meanAnomaly);
  const sunEqCenter =
    Math.sin(meanAnomalyRad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * meanAnomalyRad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * meanAnomalyRad) * 0.000289;
  const sunTrueLon = deg2rad(normalizeDegrees(meanLon + sunEqCenter));
  const omega = deg2rad(125.04 - 1934.136 * T);
  const meanObliq = deg2rad(23 + (26 + ((21.448 - T * (46.815 + T * (0.00059 - T * 0.001813)))) / 60) / 60);
  const obliqCorr = meanObliq + deg2rad(0.00256) * Math.cos(omega);
  const sunAppLon = ((
    sunTrueLon - deg2rad(0.00569) - deg2rad(0.00478) * Math.sin(omega)
  ) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);

  const sinDec = Math.sin(obliqCorr) * Math.sin(sunAppLon);
  const decl = Math.asin(sinDec);
  const ra = Math.atan2(
    Math.cos(obliqCorr) * Math.sin(sunAppLon),
    Math.cos(sunAppLon),
  );

  const gmst = satellite.gstime(referenceTime);
  let hourAngle = gmst + observerGd.longitude - ra;
  hourAngle = ((hourAngle + Math.PI) % (Math.PI * 2)) - Math.PI;

  const lat = observerGd.latitude;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.min(Math.max(sinAlt, -1), 1));

  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle),
  );

  const azimuthDeg = (rad2deg(azimuth) + 360) % 360;
  const elevationDeg = rad2deg(altitude);
  if (elevationDeg <= 0) return null;
  return {
    azimuthDeg,
    elevationDeg,
  };
}

function buildSunTrackForPoints(trackPoints = []) {
  if (!Array.isArray(trackPoints) || !trackPoints.length) return [];
  return trackPoints
    .map((point) => {
      if (!point?.time) return null;
      const sunPoint = computeSunLookAngles(point.time);
      if (!sunPoint) return null;
      return {
        azimuthDeg: sunPoint.azimuthDeg,
        elevationDeg: sunPoint.elevationDeg,
      };
    })
    .filter(Boolean);
}

function validateTrackingInputs() {
  const errors = [];
  if (!latInput || !lonInput || !altInput || !tleInput) {
    errors.push('入力欄の初期化に失敗しました。ページを再読み込みしてください。');
  } else {
    const rawLat = latInput.value?.trim() ?? '';
    const rawLon = lonInput.value?.trim() ?? '';
    const rawAlt = altInput.value?.trim() ?? '';
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    const alt = Number(rawAlt);
    if (!rawLat || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push('緯度は -90° から 90° の範囲で入力してください。');
    }
    if (!rawLon || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      errors.push('経度は -180° から 180° の範囲で入力してください。');
    }
    if (!rawAlt || !Number.isFinite(alt)) {
      errors.push('高度は数値で入力してください。');
    }
    const tleValue = tleInput.value.trim();
    const tleLines = tleValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const line1Index = tleLines.findIndex((line) => line.startsWith('1 '));
    const line2Index =
      line1Index >= 0
        ? tleLines.findIndex((line, idx) => idx > line1Index && line.startsWith('2 '))
        : -1;
    if (line1Index === -1 || line2Index === -1 || line2Index !== line1Index + 1) {
      errors.push('TLE は衛星名（任意）に続けて 1 行目と 2 行目を順番に入力してください。');
    }
  }
  return { valid: errors.length === 0, errors };
}

function setButtonStates(isTracking) {
  if (isTracking) {
    startBtn.classList.add('button-teal');
    startBtn.classList.remove('button-dark');
    stopBtn.classList.add('button-dark');
    stopBtn.classList.remove('button-teal');
  } else {
    startBtn.classList.add('button-dark');
    startBtn.classList.remove('button-teal');
    stopBtn.classList.add('button-teal');
    stopBtn.classList.remove('button-dark');
  }
}

function setFormEnabled(isEnabled) {
  [latInput, lonInput, altInput, tleInput, tleSearchBtn].forEach((el) => {
    if (!el) return;
    el.disabled = !isEnabled;
    if (!isEnabled) {
      el.classList.add('disabled');
    } else {
      el.classList.remove('disabled');
    }
  });
  setLocationPresetsEnabled(isEnabled);
}

function setLocationPresetsEnabled(isEnabled) {
  if (!locationPresetButtons.length) return;
  locationPresetButtons.forEach((btn) => {
    btn.disabled = !isEnabled;
  });
}

function setSatelliteDataEnabled(isEnabled) {
  if (!satelliteDataBtn) return;
  satelliteDataBtn.disabled = !isEnabled;
  satelliteDataBtn.classList.toggle('disabled', !isEnabled);
}

function clearUpcomingPasses() {
  if (!upcomingContainer || !passListEl) return;
  upcomingContainer.hidden = true;
  passListEl.innerHTML = '';
}

function parseTleData(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const entries = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (line1?.startsWith('1 ') && line2?.startsWith('2 ')) {
      entries.push({ name, line1, line2, index: entries.length });
    }
  }
  return entries;
}

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function showTleSearchLoading() {
  const loading = document.createElement('div');
  loading.className = 'modal-loading';
  loading.innerHTML = '<div class=\"modal-spinner\"></div><div>TLE を取得しています...</div>';
  openModal({ title: 'TLE 検索', content: loading });
}

function showTleSearchError(message) {
  const errorEl = document.createElement('div');
  errorEl.textContent = `TLE の取得に失敗しました: ${message}`;
  openModal({ title: 'TLE 検索エラー', content: errorEl });
}

function renderTleSearchWindow(entries) {
  const container = document.createElement('div');
  container.className = 'modal-tle-search';
  const inputEl = document.createElement('input');
  inputEl.type = 'search';
  inputEl.placeholder = '衛星名で検索 (例: ISS)';
  const listEl = document.createElement('ul');
  listEl.className = 'modal-tle-list';
  const emptyEl = document.createElement('div');
  emptyEl.textContent = '該当する衛星が見つかりません';
  emptyEl.hidden = true;
  container.append(inputEl, listEl, emptyEl);
  openModal({ title: 'TLE 検索', content: container });

  const renderList = (keyword = '') => {
    if (!listEl) return;
    const word = keyword.trim().toLowerCase();
    const filtered = word
      ? entries.filter((entry) => entry.name.toLowerCase().includes(word))
      : entries.slice(0, 200);
    listEl.innerHTML = filtered
      .map(
        (entry) => `<li data-entry-index="${entry.index}">
          <div class="modal-tle-name">${escapeHtml(entry.name)}</div>
          <div class="modal-tle-lines">${escapeHtml(entry.line1)}<br/>${escapeHtml(entry.line2)}</div>
        </li>`,
      )
      .join('');
    emptyEl.hidden = filtered.length > 0;
  };

  listEl.addEventListener('click', (event) => {
    const target = event.target.closest('li');
    if (!target) return;
    const idx = Number(target.dataset.entryIndex);
    const entry = entries[idx];
    if (entry && window.setTleFromSearch) {
      window.setTleFromSearch(entry);
    }
  });

  inputEl.addEventListener('input', () => renderList(inputEl.value));
  renderList();
  inputEl.focus();
}

function setTleFromSearch(entry) {
  if (!entry || !tleInput) return;
  const tleName = entry.name?.trim() || 'TLE';
  tleInput.value = `${tleName}\n${entry.line1}\n${entry.line2}`;
  pendingTleName = entry.name || '検索結果';
  tleInput.focus();
  closeModal();
}
window.setTleFromSearch = setTleFromSearch;

async function openTleSearchWindow() {
  showTleSearchLoading();

  try {
    const response = await fetch(
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const entries = parseTleData(text);
    if (!entries.length) {
      throw new Error('TLE を取得できませんでした');
    }
    renderTleSearchWindow(entries);
  } catch (error) {
    console.error(error);
    showTleSearchError(error.message);
  }
}

function formatTimeAz(result) {
  if (!result) return '--';
  return `${dateTimeFormatter.format(result.time)} （方位 ${result.azimuthDeg.toFixed(1)}°）`;
}

function setStatus({ azimuth = '--', elevation = '--', range = '--', time = '--' }) {
  azimuthEl.textContent = typeof azimuth === 'number' ? azimuth.toFixed(2) : azimuth;
  elevationEl.textContent = typeof elevation === 'number' ? elevation.toFixed(2) : elevation;
  rangeEl.textContent = typeof range === 'number' ? range.toFixed(2) : range;
  const formattedTime =
    time instanceof Date ? formatTimestamp(time) : typeof time === 'string' ? time : formatTimestamp();
  timestampEl.textContent = formattedTime;
}

function resizePolarCanvas() {
  if (!polarCanvas || !polarCtx) return;

  const dpr = window.devicePixelRatio || 1;
  const displaySize = polarCanvas.clientWidth || polarCanvas.width;
  if (!displaySize) return;

  if (polarCanvas.width !== displaySize * dpr || polarCanvas.height !== displaySize * dpr) {
    polarCanvas.width = displaySize * dpr;
    polarCanvas.height = displaySize * dpr;
  }

  polarCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  polarDisplaySize = displaySize;
  drawPolarChart();
}

function convertLookAngleToPoint(point, center, maxRadius) {
  const normalizedRadius = 1 - Math.min(Math.max(point.elevationDeg, 0), 90) / 90;
  const radius = normalizedRadius * maxRadius;
  const angleRad = deg2rad((90 - point.azimuthDeg + 360) % 360);
  const x = center + radius * Math.cos(angleRad);
  const y = center - radius * Math.sin(angleRad);
  return { x, y };
}

function drawPolarChart(point = latestPolarPoint, sunPoint = latestSunPoint) {
  if (!polarCanvas || !polarCtx) return;

  if (!polarDisplaySize) {
    polarDisplaySize = polarCanvas.clientWidth || polarCanvas.width || 320;
  }

  const ctx = polarCtx;
  const size = polarDisplaySize;
  const center = size / 2;
  const maxRadius = center - 16;

  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;

  const rings = [
    { fraction: 1, label: '0°' },
    { fraction: 0.66, label: '30°' },
    { fraction: 0.33, label: '60°' },
  ];

  rings.forEach(({ fraction }) => {
    ctx.beginPath();
    ctx.arc(center, center, maxRadius * fraction, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(center, center - maxRadius);
  ctx.lineTo(center, center + maxRadius);
  ctx.moveTo(center - maxRadius, center);
  ctx.lineTo(center + maxRadius, center);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', center, center - maxRadius - 4);
  ctx.fillText('S', center, center + maxRadius + 14);
  ctx.fillText('W', center - maxRadius - 10, center + 4);
  ctx.fillText('E', center + maxRadius + 10, center + 4);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.textAlign = 'center';
  rings.forEach(({ fraction, label }) => {
    const y = center - maxRadius * fraction + 10;
    ctx.fillText(label, center, y);
  });

  const trackPoints =
    point && point.elevationDeg >= 0 ? currentPassTrackPoints : nextPassTrackPoints;
  if (trackPoints.length >= 2) {
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([0, 14]);
    ctx.beginPath();
    trackPoints.forEach((trackPoint, index) => {
      if (trackPoint.elevationDeg < 0) return;
      const { x, y } = convertLookAngleToPoint(trackPoint, center, maxRadius);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
    trackPoints.forEach((trackPoint) => {
      if (trackPoint.elevationDeg < 0) return;
      const { x, y } = convertLookAngleToPoint(trackPoint, center, maxRadius);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  if (sunPoint) {
    const { x: sunX, y: sunY } = convertLookAngleToPoint(sunPoint, center, maxRadius);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 99, 132, 0.75)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (!point) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText('測定待ち', center, center + 4);
    return;
  }

  const safeElev = Math.min(Math.max(point.elevationDeg, -90), 90);
  const { x, y } = convertLookAngleToPoint(point, center, maxRadius);

  ctx.fillStyle = '#00c2ff';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.textAlign = 'left';
  ctx.fillText(
    `Az ${point.azimuthDeg.toFixed(1)}°, El ${safeElev.toFixed(1)}°`,
    12,
    size - 12,
  );
}

function updateSatelliteRecord() {
  try {
    const lines = tleInput.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const nameFromInput = lines.find((line) => line && !line.startsWith('1 ') && !line.startsWith('2 '));

    let line1 = lines.find((line) => line.startsWith('1'));
    let line2 = lines.find((line) => line.startsWith('2'));

    if ((!line1 || !line2) && lines.length >= 2) {
      [line1, line2] = lines;
    }

    if (!line1 || !line2) {
      setStatus({
        azimuth: '--',
        elevation: '--',
        range: '--',
        time: 'TLE を 2 行連続で入力してください',
      });
      return false;
    }

    const nextSatrec = satellite.twoline2satrec(line1, line2);

    if (nextSatrec.error && nextSatrec.error !== 0) {
      const message = `TLE の解析でエラー (code: ${nextSatrec.error})`;
      console.error(message, nextSatrec);
      setStatus({ azimuth: 'ERR', elevation: 'ERR', range: 'ERR', time: message });
      satrec = null;
      cachedNextPass = null;
      currentPassInfo = null;
      currentPassTrackPoints = [];
      nextPassTrackPoints = [];
      updateCurrentPassDisplay(null);
      clearUpcomingPasses();
      pendingTleName = null;
      setFormEnabled(true);
      setSatelliteDataEnabled(false);
      return false;
    }

    satrec = nextSatrec;
    cachedNextPass = null;
    currentPassInfo = null;
    currentPassTrackPoints = [];
    nextPassTrackPoints = [];
    updateCurrentPassDisplay(null);
    setButtonStates(false);
    const designator = line1.length >= 18 ? line1.slice(9, 17).trim() : '--';
    const tleName = pendingTleName ?? nameFromInput ?? lastSatelliteData?.name ?? 'ー';
    pendingTleName = null;
    lastSatelliteData = {
      name: tleName || 'ー',
      line1,
      line2,
      designator,
      catalogNumber: satrec.satnum ?? '--',
    };
    return true;
  } catch (error) {
    console.error(error);
    satrec = null;
    cachedNextPass = null;
    currentPassInfo = null;
    currentPassTrackPoints = [];
    nextPassTrackPoints = [];
    updateCurrentPassDisplay(null);
    isTracking = false;
    setButtonStates(false);
    setFormEnabled(true);
    pendingTleName = null;
    setSatelliteDataEnabled(false);
    setStatus({ azimuth: 'ERR', elevation: 'ERR', range: 'ERR', time: error.message });
    return false;
  }
}

function computeLookAngles(atTime = new Date()) {
  if (!satrec) return null;

  const observerGd = getObserverLocation();
  if (!observerGd) {
    return null;
  }

  const targetTime = new Date(atTime);
  const positionAndVelocity = satellite.propagate(satrec, targetTime);
  const positionEci = positionAndVelocity.position;

  if (!positionEci) return null;

  const gmst = satellite.gstime(targetTime);
  const positionEcf = satellite.eciToEcf(positionEci, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

  return {
    azimuthDeg: (rad2deg(lookAngles.azimuth) + 360) % 360,
    elevationDeg: rad2deg(lookAngles.elevation),
    rangeKm: lookAngles.rangeSat,
    time: targetTime,
  };
}

function refineElevationCrossing(lowTime, highTime, targetAboveZero = true) {
  let low = new Date(lowTime);
  let high = new Date(highTime);
  let bestResult = null;

  for (let i = 0; i < 14; i += 1) {
    const midTime = new Date((low.getTime() + high.getTime()) / 2);
    const midResult = computeLookAngles(midTime);
    if (!midResult) break;
    const isAbove = midResult.elevationDeg >= 0;
    if ((targetAboveZero && isAbove) || (!targetAboveZero && !isAbove)) {
      bestResult = midResult;
      high = midTime;
    } else {
      low = midTime;
    }
  }

  return bestResult;
}

function buildTrackPoints(startTime, endTime, stepSeconds = TRACK_STEP_SECONDS) {
  if (!satrec || !startTime || !endTime || endTime <= startTime) return [];

  const points = [];
  for (let ts = startTime.getTime(); ts <= endTime.getTime(); ts += stepSeconds * 1000) {
    const point = computeLookAngles(new Date(ts));
    if (point && point.elevationDeg >= 0) {
      points.push(point);
    }
  }

  const finalPoint = computeLookAngles(endTime);
  if (finalPoint && finalPoint.elevationDeg >= 0) {
    points.push(finalPoint);
  }

  return points;
}

function findLosAfter(startResult) {
  if (!startResult) return null;
  let lastPositive = startResult;

  for (
    let elapsed = PASS_SCAN_STEP_SECONDS;
    elapsed <= LOS_SEARCH_LIMIT_SECONDS;
    elapsed += PASS_SCAN_STEP_SECONDS
  ) {
    const time = new Date(startResult.time.getTime() + elapsed * 1000);
    const candidate = computeLookAngles(time);
    if (!candidate) continue;

    if (candidate.elevationDeg < 0) {
      return refineElevationCrossing(lastPositive.time, time, false) || candidate;
    }

    lastPositive = candidate;
  }

  return null;
}

function findAosBefore(currentResult) {
  if (!currentResult) return null;
  let lastPositive = currentResult;

  for (
    let elapsed = PASS_SCAN_STEP_SECONDS;
    elapsed <= LOS_SEARCH_LIMIT_SECONDS;
    elapsed += PASS_SCAN_STEP_SECONDS
  ) {
    const time = new Date(currentResult.time.getTime() - elapsed * 1000);
    if (time.getTime() < 0) break;
    const candidate = computeLookAngles(time);
    if (!candidate) continue;

    if (candidate.elevationDeg < 0) {
      return refineElevationCrossing(time, lastPositive.time, true) || lastPositive;
    }

    lastPositive = candidate;
  }

  return null;
}

function computeCurrentPassInfo(currentResult) {
  const aos = findAosBefore(currentResult);
  const los = findLosAfter(currentResult);
  const trackStart = aos?.time ?? currentResult.time;
  const fallbackEnd = new Date(trackStart.getTime() + MAX_PASS_DURATION_SECONDS * 1000);
  const rawEnd = los?.time && los.time > trackStart ? los.time : fallbackEnd;
  const trackPoints = buildTrackPoints(trackStart, rawEnd);
  let peakPoint = currentResult;
  trackPoints.forEach((point) => {
    if (!peakPoint || point.elevationDeg > peakPoint.elevationDeg) {
      peakPoint = point;
    }
  });

  return {
    aos,
    los,
    trackPoints,
    peak: peakPoint,
  };
}

function findNextVisiblePass(referenceTime, maxSearchSeconds = 24 * 3600) {
  if (!satrec) return null;

  const startTime = new Date(referenceTime);
  let previousTime = startTime;
  let previousResult = computeLookAngles(previousTime);

  for (
    let elapsed = PASS_SCAN_STEP_SECONDS;
    elapsed <= maxSearchSeconds;
    elapsed += PASS_SCAN_STEP_SECONDS
  ) {
    const currentTime = new Date(startTime.getTime() + elapsed * 1000);
    const currentResult = computeLookAngles(currentTime);
    if (!currentResult) continue;

    if (currentResult.elevationDeg >= 0 && previousResult && previousResult.elevationDeg < 0) {
      const aosResult =
        refineElevationCrossing(previousTime, currentTime, true) || currentResult;

      let peakResult = aosResult;
      let losResult = null;
      let lastPositiveResult = aosResult;
      let scanTime = new Date(aosResult.time.getTime() + PEAK_SCAN_STEP_SECONDS * 1000);
      const peakLimit = aosResult.time.getTime() + MAX_PASS_DURATION_SECONDS * 1000;

      while (scanTime.getTime() <= peakLimit) {
        const peakCandidate = computeLookAngles(scanTime);
        if (!peakCandidate) break;

        if (peakCandidate.elevationDeg > peakResult.elevationDeg) {
          peakResult = peakCandidate;
        }

        if (peakCandidate.elevationDeg >= 0) {
          lastPositiveResult = peakCandidate;
        } else if (lastPositiveResult && lastPositiveResult.time > aosResult.time) {
          losResult =
            refineElevationCrossing(lastPositiveResult.time, scanTime, false) ||
            peakCandidate;
          break;
        }

        scanTime = new Date(scanTime.getTime() + PEAK_SCAN_STEP_SECONDS * 1000);
      }

      const endTime =
        losResult?.time ??
        new Date(aosResult.time.getTime() + MAX_PASS_DURATION_SECONDS * 1000);

      return {
        aos: aosResult,
        los: losResult,
        peakElevationDeg: peakResult.elevationDeg,
        peakTime: peakResult.time,
        peakAzimuthDeg: peakResult.azimuthDeg,
        trackPoints: buildTrackPoints(aosResult.time, endTime),
      };
    }

    previousTime = currentTime;
    previousResult = currentResult;
  }

  return null;
}

function updateNextPassDisplay(currentResult) {
  if (
    !nextPassContainer ||
    !nextPassAosEl ||
    !nextPassLosEl ||
    !nextPassPeakEl
  ) {
    return;
  }

  if (!satrec || (currentResult && currentResult.elevationDeg >= 0)) {
    cachedNextPass = null;
    nextPassContainer.hidden = true;
    nextPassPeakEl.textContent = '--';
    nextPassTrackPoints = [];
    return;
  }

  const now = new Date();
  if (!cachedNextPass || cachedNextPass.aos.time <= now) {
    cachedNextPass = findNextVisiblePass(currentResult?.time ?? now);
  }

  if (!cachedNextPass) {
    nextPassContainer.hidden = false;
    nextPassAosEl.textContent = '24 時間以内に可視になりません';
    nextPassLosEl.textContent = '--';
    nextPassPeakEl.textContent = '--';
    nextPassTrackPoints = [];
    return;
  }

  nextPassContainer.hidden = false;
  nextPassAosEl.textContent = formatTimeAz(cachedNextPass.aos);
  nextPassLosEl.textContent = cachedNextPass.los
    ? formatTimeAz(cachedNextPass.los)
    : '24 時間以内に LOS なし';
  const peak = cachedNextPass.peakElevationDeg ?? null;
  nextPassPeakEl.textContent =
    peak !== null && cachedNextPass.peakAzimuthDeg !== undefined
      ? `MAX: ${dateTimeFormatter.format(cachedNextPass.peakTime)} （方位 ${cachedNextPass.peakAzimuthDeg.toFixed(
          1,
        )}°、仰角 ${peak.toFixed(1)}°）`
      : '--';
  nextPassTrackPoints = cachedNextPass.trackPoints ?? [];
}

function computeUpcomingPasses(days = 7) {
  if (!satrec) return [];
  const horizonSeconds = days * 24 * 3600;
  const passes = [];
  let cursor = new Date();
  const limitTime = new Date(cursor.getTime() + horizonSeconds * 1000);

  for (let i = 0; i < 100; i += 1) {
    const remainingSeconds = Math.max(
      0,
      Math.floor((limitTime.getTime() - cursor.getTime()) / 1000),
    );
    if (remainingSeconds <= 0) break;
    const pass = findNextVisiblePass(cursor, remainingSeconds);
    if (!pass) break;
    passes.push(pass);

    const advanceBase = pass.los?.time
      ? new Date(pass.los.time.getTime() + 60000)
      : new Date(pass.aos.time.getTime() + MAX_PASS_DURATION_SECONDS * 1000 + 60000);

    cursor = advanceBase;
    if (cursor > limitTime) break;
  }

  return passes;
}

function renderUpcomingPasses() {
  if (!upcomingContainer || !passListEl) return;

  if (!satrec) {
      passListEl.innerHTML = '';
    return;
  }

  cachedUpcomingPasses = computeUpcomingPasses();
  const passes = cachedUpcomingPasses;
  if (!passes.length) {
      passListEl.innerHTML = '';
    return;
  }

  upcomingContainer.hidden = false;
  passListEl.innerHTML = passes
    .map((pass, idx) => {
      const aosText = pass.aos ? formatTimeAz(pass.aos) : '--';
      const losText = pass.los ? formatTimeAz(pass.los) : 'LOS なし';
      const peakText = pass.peakElevationDeg !== undefined
        ? `${dateTimeFormatter.format(pass.peakTime)} （方位 ${pass.peakAzimuthDeg?.toFixed(1) ?? '--'}°、仰角 ${pass.peakElevationDeg.toFixed(1)}°）`
        : '--';
      return `<li class="pass-item" data-pass-index="${idx}">
        <div class="pass-item-header">
          <span>PASS ${idx + 1}</span>
          <button type="button" class="button-dark button-small pass-visual-btn" data-pass-index="${idx}">可視パス</button>
        </div>
        <div class="pass-pill-group">
          <span class="pass-pill"><strong>AOS</strong>${aosText}</span>
          <span class="pass-pill"><strong>LOS</strong>${losText}</span>
          <span class="pass-pill"><strong>MAX</strong>${peakText}</span>
        </div>
      </li>`;
    })
    .join('');

  passListEl.querySelectorAll('.pass-visual-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.passIndex);
      openPassPolarWindow(index);
    });
  });
}

function updateCurrentPassDisplay(passInfo) {
  if (
    !currentPassContainer ||
    !currentPassAosEl ||
    !currentPassLosEl ||
    !currentPassPeakEl
  ) {
    return;
  }

  if (!passInfo) {
    currentPassContainer.hidden = true;
    currentPassAosEl.textContent = '--';
    currentPassLosEl.textContent = '--';
    currentPassPeakEl.textContent = '--';
    return;
  }

  currentPassContainer.hidden = false;
  currentPassAosEl.textContent = formatTimeAz(passInfo.aos ?? null);
  currentPassLosEl.textContent = passInfo.los ? formatTimeAz(passInfo.los) : 'ー';
  currentPassPeakEl.textContent = passInfo.peak
    ? `MAX: ${dateTimeFormatter.format(passInfo.peak.time)} （方位 ${passInfo.peak.azimuthDeg.toFixed(
        1,
      )}°、仰角 ${passInfo.peak.elevationDeg.toFixed(1)}°）`
    : '--';
}

function exportUpcomingPassesToCsv() {
  if (!cachedUpcomingPasses.length) {
    alert('エクスポートできる可視パスがありません。');
    return;
  }

  const rows = [
    ['Pass', 'AOS (日時/方位角)', 'LOS (日時/方位角)', 'MAX (日時/方位/仰角)'],
    ...cachedUpcomingPasses.map((pass, idx) => {
      const formatEntry = (result) =>
        result
          ? `${dateTimeFormatter.format(result.time)} / Az ${result.azimuthDeg.toFixed(1)}°`
          : 'N/A';

      const aosText = formatEntry(pass.aos);
      const losText = pass.los ? formatEntry(pass.los) : 'N/A';
      const peakText = pass.peakElevationDeg !== undefined
        ? `${dateTimeFormatter.format(pass.peakTime)} / Az ${
            pass.peakAzimuthDeg?.toFixed(1) ?? '--'
          }° / El ${pass.peakElevationDeg.toFixed(1)}°`
        : 'N/A';

      return [`Pass ${idx + 1}`, aosText, losText, peakText];
    }),
  ];

  const csvContent = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'upcoming_passes.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openPassPolarWindow(index) {
  if (!cachedUpcomingPasses.length || Number.isNaN(index)) return;
  const pass = cachedUpcomingPasses[index];
  if (!pass || !pass.trackPoints?.length) {
    alert('このパスの軌道データを表示できません。');
    return;
  }

  const sunTrackPoints = buildSunTrackForPoints(pass.trackPoints);
  const container = document.createElement('div');
  container.className = 'modal-pass-polar';
  const canvas = document.createElement('canvas');
  const canvasSize = 315;
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  container.appendChild(canvas);
  const legend = document.createElement('div');
  legend.className = 'modal-pass-legend';
  legend.innerHTML = `
    <span><span class="modal-pass-legend-dot modal-pass-legend-dot--sat"></span>衛星軌跡</span>
    <span><span class="modal-pass-legend-dot modal-pass-legend-dot--sun"></span>太陽位置</span>`;
  container.appendChild(legend);
  openModal({ title: `可視パス (PASS ${index + 1})`, content: container });

  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const maxRadius = center - 16;
  const toPoint = (point) => {
    const normalizedRadius = 1 - Math.min(Math.max(point.elevationDeg, 0), 90) / 90;
    const radius = normalizedRadius * maxRadius;
    const angleRad = deg2rad((90 - point.azimuthDeg + 360) % 360);
    const x = center + radius * Math.cos(angleRad);
    const y = center - radius * Math.sin(angleRad);
    return { x, y };
  };

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  [0.33, 0.66, 1].forEach((fraction) => {
    ctx.beginPath();
    ctx.arc(center, center, maxRadius * fraction, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(center, center - maxRadius);
  ctx.lineTo(center, center + maxRadius);
  ctx.moveTo(center - maxRadius, center);
  ctx.lineTo(center + maxRadius, center);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.textAlign = 'center';
  ctx.fillText('N', center, center - maxRadius - 6);
  ctx.fillText('S', center, center + maxRadius + 14);
  ctx.fillText('W', center - maxRadius - 10, center + 4);
  ctx.fillText('E', center + maxRadius + 10, center + 4);
  ['0°', '30°', '60°'].forEach((label, idx) => {
    ctx.fillText(label, center, center - maxRadius * (1 - idx * 0.33) + 12);
  });

  ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
  pass.trackPoints.forEach((point) => {
    const pos = toPoint(point);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (sunTrackPoints.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 99, 132, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    sunTrackPoints.forEach((sunPoint, idx) => {
      const pos = toPoint(sunPoint);
      if (idx === 0) ctx.moveTo(pos.x, pos.y);
      else ctx.lineTo(pos.x, pos.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 99, 132, 0.25)';
    sunTrackPoints.forEach((sunPoint) => {
      const pos = toPoint(sunPoint);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  const hasOverlap = pass.trackPoints.some((point) =>
    sunTrackPoints.some((sunPoint) => {
      const azDiff = Math.abs(point.azimuthDeg - sunPoint.azimuthDeg);
      const wrappedAzDiff = Math.min(azDiff, 360 - azDiff);
      const elDiff = Math.abs(point.elevationDeg - sunPoint.elevationDeg);
      return wrappedAzDiff <= 5 && elDiff <= 3;
    }),
  );

  if (hasOverlap) {
    const notice = document.createElement('div');
    notice.textContent = '衛星位置と太陽位置が重なっています。観測時には注意してください。';
    notice.style.marginTop = '0.4rem';
    notice.style.fontSize = '0.8rem';
    notice.style.color = '#ff7b9e';
    notice.style.fontWeight = '600';
    container.appendChild(notice);
  }
}

function computeSatelliteData() {
  if (!satrec || !lastSatelliteData) return null;
  const toDeg = (rad) => {
    if (typeof rad !== 'number' || Number.isNaN(rad)) return null;
    let deg = rad2deg(rad);
    deg %= 360;
    if (deg < 0) deg += 360;
    return deg;
  };

  const epochJD = (satrec.jdsatepoch ?? 0) + (satrec.jdsatepochF ?? 0);
  const epochDate = epochJD ? new Date((epochJD - 2440587.5) * 86400000) : null;
  const meanMotionRevPerDay = typeof satrec.no === 'number'
    ? (satrec.no * 1440) / (2 * Math.PI)
    : null;
  const periodMinutes = meanMotionRevPerDay ? 1440 / meanMotionRevPerDay : null;
  const earthRadiusKm =
    (satellite.constants && satellite.constants.earthRadius) || 6378.137;
  const semiMajorKm =
    typeof satrec.a === 'number' ? satrec.a * earthRadiusKm : null;
  const perigee =
    semiMajorKm !== null
      ? semiMajorKm * (1 - satrec.ecco) - earthRadiusKm
      : null;
  const apogee =
    semiMajorKm !== null
      ? semiMajorKm * (1 + satrec.ecco) - earthRadiusKm
      : null;

  return {
    name: lastSatelliteData.name || 'ー',
    catalogNumber: satrec.satnum ?? '---',
    designator: lastSatelliteData.designator || '---',
    epoch: epochDate,
    inclination: toDeg(satrec.inclo),
    raan: toDeg(satrec.nodeo),
    eccentricity: typeof satrec.ecco === 'number' ? satrec.ecco : null,
    argPerigee: toDeg(satrec.argpo),
    meanAnomaly: toDeg(satrec.mo),
    meanMotion: meanMotionRevPerDay,
    periodMinutes,
    perigeeAltitude: perigee,
    apogeeAltitude: apogee,
  };
}

function openSatelliteDataWindow() {
  if (!satrec || !lastSatelliteData) {
    alert('衛星データを表示するにはトラッキングを開始してください。');
    return;
  }
  const data = computeSatelliteData();
  if (!data) {
    alert('衛星データを計算できませんでした。');
    return;
  }

  const formatNumber = (value, decimals = 2, suffix = '') =>
    typeof value === 'number' && Number.isFinite(value)
      ? `${value.toFixed(decimals)}${suffix}`
      : '--';

  const epochText = data.epoch
    ? `${data.epoch.toLocaleString('ja-JP', { timeZone: 'UTC' })} (UTC)`
    : '--';
  const rows = [
    ['カタログ名', escapeHtml(data.name || '---')],
    ['カタログ番号', escapeHtml(String(data.catalogNumber || '---'))],
    ['国際標識', escapeHtml(data.designator || '--')],
    ['エポック', escapeHtml(epochText)],
    ['軌道傾斜角', formatNumber(data.inclination, 3, '°')],
    ['昇交点赤経', formatNumber(data.raan, 3, '°')],
    ['離心率',
      typeof data.eccentricity === 'number'
        ? data.eccentricity.toFixed(7)
        : '--'],
    ['近地点引数', formatNumber(data.argPerigee, 3, '°')],
    ['平均近点離角', formatNumber(data.meanAnomaly, 3, '°')],
    ['平均運動', formatNumber(data.meanMotion, 5, ' rev/day')],
    ['周期', formatNumber(data.periodMinutes, 2, ' 分')],
    ['近地点高度', formatNumber(data.perigeeAltitude, 1, ' km')],
    ['遠地点高度', formatNumber(data.apogeeAltitude, 1, ' km')],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`,
    )
    .join('');

  const container = document.createElement('div');
  container.innerHTML = `<table class="modal-table">${tableRows}</table>`;
  openModal({ title: escapeHtml(data.name || '衛星データ'), content: container });
}

function tick() {
  const result = computeLookAngles();
  if (isTracking && result) {
    latestSunPoint = computeSunLookAngles(result.time);
  } else if (!result) {
    latestSunPoint = null;
  }

  if (!result) {
    setStatus({
      azimuth: 'N/A',
      elevation: 'N/A',
      range: 'N/A',
      time: '入力を確認してください',
    });
    latestPolarPoint = null;
    drawPolarChart();
    updateNextPassDisplay(null);
    return;
  }

  setStatus({
    azimuth: result.azimuthDeg,
    elevation: result.elevationDeg,
    range: result.rangeKm,
    time: result.time,
  });

  if (result.elevationDeg >= 0) {
    const losTime = currentPassInfo?.los?.time ?? null;
    const needsRefresh =
      !currentPassInfo ||
      (losTime && result.time > losTime) ||
      !currentPassInfo.trackPoints?.length;

    if (needsRefresh) {
      currentPassInfo = computeCurrentPassInfo(result);
    }
    currentPassTrackPoints = currentPassInfo?.trackPoints ?? [];
    updateCurrentPassDisplay(currentPassInfo);
  } else {
    currentPassInfo = null;
    currentPassTrackPoints = [];
    updateCurrentPassDisplay(null);
  }

  latestPolarPoint = result;
  drawPolarChart();
  updateNextPassDisplay(result);
}

function startTracking() {
  if (!window.satellite) {
    setStatus({ time: 'satellite.js のロードを待っています...' });
    isTracking = false;
    setButtonStates(false);
    setFormEnabled(true);
    setSatelliteDataEnabled(false);
    return;
  }

  const { valid, errors } = validateTrackingInputs();
  const fieldErrorMap = {
    lat: document.getElementById('lat-error'),
    lon: document.getElementById('lon-error'),
    alt: document.getElementById('alt-error'),
    tle: document.getElementById('tle-error'),
  };
  Object.values(fieldErrorMap).forEach((el) => {
    if (el) el.textContent = '';
  });
  if (!valid) {
    errors.forEach((message) => {
      if (message.includes('緯度') && fieldErrorMap.lat) {
        fieldErrorMap.lat.textContent = message;
      } else if (message.includes('経度') && fieldErrorMap.lon) {
        fieldErrorMap.lon.textContent = message;
      } else if (message.includes('高度') && fieldErrorMap.alt) {
        fieldErrorMap.alt.textContent = message;
      } else if (message.includes('TLE') && fieldErrorMap.tle) {
        fieldErrorMap.tle.textContent = message;
      }
    });
    return;
  }
  Object.values(fieldErrorMap).forEach((el) => {
    if (el) el.textContent = '';
  });

  if (!updateSatelliteRecord()) {
    isTracking = false;
    setButtonStates(false);
    setFormEnabled(true);
    setSatelliteDataEnabled(false);
    return;
  }

  isTracking = true;
  tick();

  clearInterval(timerId);
  timerId = setInterval(tick, 1000);
  setButtonStates(true);
  setFormEnabled(false);
  setSatelliteDataEnabled(true);
  renderUpcomingPasses();
}

function stopTracking() {
  clearInterval(timerId);
  timerId = null;
  isTracking = false;
  latestPolarPoint = null;
  latestSunPoint = null;
  currentPassInfo = null;
  currentPassTrackPoints = [];
  nextPassTrackPoints = [];
  drawPolarChart();
  cachedNextPass = null;
  updateNextPassDisplay(null);
  updateCurrentPassDisplay(null);
  setStatus({ time: '--' });
  setButtonStates(false);
  setFormEnabled(true);
  setSatelliteDataEnabled(false);
}

form.addEventListener('submit', (evt) => {
  evt.preventDefault();
  startTracking();
});
startBtn.addEventListener('click', startTracking);
stopBtn.addEventListener('click', stopTracking);
if (tleSearchBtn) {
  tleSearchBtn.addEventListener('click', openTleSearchWindow);
}
if (tleInput) {
  tleInput.addEventListener('input', () => {
    pendingTleName = null;
  });
}
if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', exportUpcomingPassesToCsv);
}
if (satelliteDataBtn) {
  satelliteDataBtn.addEventListener('click', openSatelliteDataWindow);
}
if (locationPresetButtons.length) {
  const clearActivePresets = () => {
    locationPresetButtons.forEach((btn) => btn.classList.remove('active'));
  };
  locationPresetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const { lat, lon, alt } = btn.dataset;
      applyLocationPreset(lat, lon, alt, btn.textContent.trim());
      clearActivePresets();
      btn.classList.add('active');
    });
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && timerId) {
    clearInterval(timerId);
    timerId = null;
  } else if (!document.hidden && satrec && isTracking && !timerId) {
    tick();
    timerId = setInterval(tick, 1000);
  }
});

window.addEventListener('resize', resizePolarCanvas);
resizePolarCanvas();
setButtonStates(false);
setFormEnabled(true);
setSatelliteDataEnabled(false);
