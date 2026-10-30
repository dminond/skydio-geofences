(() => {
  'use strict';

  // Altitude reference frames offered in the UI. The sample file uses "AGL";
  // "MSL" is included for absolute-altitude fences.
  const FRAMES = ['AGL', 'MSL'];
  const STORAGE_KEY = 'skydio-geofence-builder-v1';
  const M_TO_FT = 3.28084;

  const state = {
    title: 'Airspace Manager Geofences',
    description: 'Custom geofences for Airspace Manager',
    filename: 'geofences.geojson',
    defaults: { keepOut: true, floor: 0, ceiling: 120, floorFrame: 'AGL', ceilingFrame: 'AGL' },
    zones: [], // { id, layer, props: {name, keepOut, floor, ceiling, floorFrame, ceilingFrame} }
    selectedId: null,
  };
  let nextId = 1;

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: true }).setView([37.5343, -122.3318], 17);

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery &copy; Esri' }
  );
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  });
  satellite.addTo(map);
  L.control.layers({ Satellite: satellite, Streets: streets }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: true, metric: true }).addTo(map);

  map.pm.addControls({
    position: 'topleft',
    drawMarker: false,
    drawCircleMarker: false,
    drawPolyline: false,
    drawCircle: false,
    drawText: false,
    drawPolygon: true,
    drawRectangle: true,
    editMode: true,
    dragMode: true,
    cutPolygon: false,
    removalMode: true,
    rotateMode: true,
  });
  map.pm.setGlobalOptions({ snappable: true, snapDistance: 15, allowSelfIntersection: false });

  map.on('pm:create', (e) => {
    addZone(e.layer, { ...state.defaults, name: uniqueName('Zone') });
    save();
  });
  map.on('pm:remove', (e) => {
    const zone = state.zones.find((z) => z.layer === e.layer);
    if (zone) removeZone(zone.id, false);
  });

  // ---------- Zones ----------
  function uniqueName(base) {
    const names = new Set(state.zones.map((z) => z.props.name));
    let i = state.zones.length + 1;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  function styleFor(props, selected) {
    const color = props.keepOut ? '#d93636' : '#1f9d55';
    return { color, fillColor: color, fillOpacity: selected ? 0.35 : 0.2, weight: selected ? 4 : 2 };
  }

  function addZone(layer, props) {
    const zone = { id: nextId++, layer, props };
    state.zones.push(zone);
    if (!map.hasLayer(layer)) layer.addTo(map);
    layer.setStyle(styleFor(props, false));
    layer.on('click', () => select(zone.id));
    layer.on('pm:edit pm:dragend pm:rotateend', () => { renderZoneMeta(zone); save(); });
    renderList();
    select(zone.id);
    return zone;
  }

  function removeZone(id, removeLayer = true) {
    const idx = state.zones.findIndex((z) => z.id === id);
    if (idx < 0) return;
    const [zone] = state.zones.splice(idx, 1);
    if (removeLayer) map.removeLayer(zone.layer);
    if (state.selectedId === id) state.selectedId = null;
    renderList();
    save();
  }

  function select(id) {
    state.selectedId = id;
    for (const z of state.zones) z.layer.setStyle(styleFor(z.props, z.id === id));
    document.querySelectorAll('.zone').forEach((el) => {
      const on = Number(el.dataset.id) === id;
      el.classList.toggle('selected', on);
      if (on) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // Outer ring as [lng, lat] pairs, closed (first point repeated at end).
  function ringOf(layer) {
    let latlngs = layer.getLatLngs();
    while (Array.isArray(latlngs[0])) latlngs = latlngs[0];
    const ring = latlngs.map((ll) => [ll.lng, ll.lat]);
    if (ring.length) {
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
    }
    return ring;
  }

  // Approximate polygon area in m² (spherical excess formula).
  function areaM2(ring) {
    const R = 6378137;
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      sum += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
    }
    return Math.abs(sum * R * R / 2);
  }

  function validate(zone) {
    const p = zone.props;
    const errs = [];
    if (!p.name.trim()) errs.push('Name is required.');
    if (!Number.isFinite(p.floor)) errs.push('Floor must be a number.');
    if (!Number.isFinite(p.ceiling)) errs.push('Ceiling must be a number.');
    if (Number.isFinite(p.floor) && Number.isFinite(p.ceiling) && p.floorFrame === p.ceilingFrame && p.ceiling <= p.floor) {
      errs.push('Ceiling must be above floor.');
    }
    if (ringOf(zone.layer).length < 4) errs.push('Polygon needs at least 3 points.');
    return errs;
  }

  // ---------- Sidebar rendering ----------
  const listEl = document.getElementById('zone-list');

  function frameOptions(selected) {
    return FRAMES.map((f) => `<option value="${f}"${f === selected ? ' selected' : ''}>${f}</option>`).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ftLabel(m) {
    return Number.isFinite(m) ? `≈ ${Math.round(m * M_TO_FT)} ft` : '';
  }

  function renderList() {
    document.getElementById('zone-count').textContent = `(${state.zones.length})`;
    if (!state.zones.length) {
      listEl.innerHTML = '<p class="hint">No zones yet.</p>';
      renderPreview();
      return;
    }
    listEl.innerHTML = state.zones.map((z) => {
      const p = z.props;
      return `
      <div class="zone ${p.keepOut ? '' : 'keepin'}" data-id="${z.id}">
        <div class="zone-head">
          <input data-f="name" value="${esc(p.name)}" aria-label="Zone name">
          <button class="btn small" data-act="zoom" title="Zoom to zone">Zoom</button>
          <button class="btn small danger" data-act="delete" title="Delete zone">✕</button>
        </div>
        <div class="grid2">
          <label>Type
            <select data-f="keepOut">
              <option value="true"${p.keepOut ? ' selected' : ''}>Keep-out</option>
              <option value="false"${p.keepOut ? '' : ' selected'}>Keep-in</option>
            </select>
          </label>
          <span></span>
          <label>Floor (m) <span class="ft" data-ft="floor">${ftLabel(p.floor)}</span>
            <input data-f="floor" type="number" step="0.1" value="${p.floor}">
          </label>
          <label>Floor frame<select data-f="floorFrame">${frameOptions(p.floorFrame)}</select></label>
          <label>Ceiling (m) <span class="ft" data-ft="ceiling">${ftLabel(p.ceiling)}</span>
            <input data-f="ceiling" type="number" step="0.1" value="${p.ceiling}">
          </label>
          <label>Ceiling frame<select data-f="ceilingFrame">${frameOptions(p.ceilingFrame)}</select></label>
        </div>
        <div class="zone-meta"></div>
        <div class="error"></div>
      </div>`;
    }).join('');
    state.zones.forEach(renderZoneMeta);
    for (const z of state.zones) {
      if (z.id === state.selectedId) listEl.querySelector(`[data-id="${z.id}"]`).classList.add('selected');
    }
    renderPreview();
  }

  function renderZoneMeta(zone) {
    const el = listEl.querySelector(`[data-id="${zone.id}"]`);
    if (!el) return;
    const ring = ringOf(zone.layer);
    const area = areaM2(ring);
    el.querySelector('.zone-meta').textContent =
      `${Math.max(ring.length - 1, 0)} points · ${area >= 1e5 ? (area / 1e6).toFixed(3) + ' km²' : Math.round(area) + ' m²'}`;
    el.querySelector('.error').textContent = validate(zone).join(' ');
    renderPreview();
  }

  listEl.addEventListener('input', onZoneInput);
  listEl.addEventListener('change', onZoneInput);
  function onZoneInput(e) {
    const f = e.target.dataset.f;
    if (!f) return;
    const card = e.target.closest('.zone');
    const zone = card && state.zones.find((z) => z.id === Number(card.dataset.id));
    if (!zone) return; // stale event from a card that was just re-rendered
    let v = e.target.value;
    if (f === 'keepOut') v = v === 'true';
    if (f === 'floor' || f === 'ceiling') {
      v = v === '' ? NaN : Number(v);
      card.querySelector(`[data-ft="${f}"]`).textContent = ftLabel(v);
    }
    zone.props[f] = v;
    if (f === 'keepOut') card.classList.toggle('keepin', !v);
    zone.layer.setStyle(styleFor(zone.props, zone.id === state.selectedId));
    renderZoneMeta(zone);
    save();
  }

  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('.zone');
    if (!card) return;
    const id = Number(card.dataset.id);
    const zone = state.zones.find((z) => z.id === id);
    const act = e.target.dataset.act;
    if (act === 'delete') {
      if (confirm(`Delete "${zone.props.name}"?`)) removeZone(id);
      return;
    }
    if (act === 'zoom') map.fitBounds(zone.layer.getBounds(), { padding: [40, 40] });
    if (state.selectedId !== id) select(id);
  });

  // ---------- File-level settings & defaults ----------
  const fcTitle = document.getElementById('fc-title');
  const fcDesc = document.getElementById('fc-description');
  const fcFile = document.getElementById('fc-filename');
  const def = {
    keepOut: document.getElementById('def-keepOut'),
    floor: document.getElementById('def-floor'),
    ceiling: document.getElementById('def-ceiling'),
    floorFrame: document.getElementById('def-floorFrame'),
    ceilingFrame: document.getElementById('def-ceilingFrame'),
  };
  def.floorFrame.innerHTML = frameOptions();
  def.ceilingFrame.innerHTML = frameOptions();

  function syncSettingsInputs() {
    fcTitle.value = state.title;
    fcDesc.value = state.description;
    fcFile.value = state.filename;
    def.keepOut.value = String(state.defaults.keepOut);
    def.floor.value = state.defaults.floor;
    def.ceiling.value = state.defaults.ceiling;
    def.floorFrame.value = state.defaults.floorFrame;
    def.ceilingFrame.value = state.defaults.ceilingFrame;
  }

  fcTitle.addEventListener('input', () => { state.title = fcTitle.value; renderPreview(); save(); });
  fcDesc.addEventListener('input', () => { state.description = fcDesc.value; renderPreview(); save(); });
  fcFile.addEventListener('input', () => { state.filename = fcFile.value; save(); });
  for (const [k, el] of Object.entries(def)) {
    el.addEventListener('change', () => {
      let v = el.value;
      if (k === 'keepOut') v = v === 'true';
      if (k === 'floor' || k === 'ceiling') v = Number(v) || 0;
      state.defaults[k] = v;
      save();
    });
  }

  // ---------- GeoJSON output ----------
  function toGeoJSON() {
    return {
      type: 'FeatureCollection',
      title: state.title,
      description: state.description,
      features: state.zones.map((z) => ({
        type: 'Feature',
        properties: {
          name: z.props.name,
          keepOut: z.props.keepOut,
          floor: z.props.floor,
          ceiling: z.props.ceiling,
          floorFrame: z.props.floorFrame,
          ceilingFrame: z.props.ceilingFrame,
        },
        geometry: {
          coordinates: [ringOf(z.layer)],
          type: 'Polygon',
        },
      })),
    };
  }

  // Serialize with 2-space indent, one number per line, and floor/ceiling
  // always written with a decimal point (e.g. 0.0, 120.0) like the sample file.
  function serialize(fc) {
    return JSON.stringify(fc, null, 2)
      .replace(/("(?:floor|ceiling)": )(-?\d+)(?=,?\n)/g, '$1$2.0') + '\n';
  }

  const previewEl = document.getElementById('preview');
  function renderPreview() {
    previewEl.textContent = serialize(toGeoJSON());
  }

  function checkBeforeExport() {
    if (!state.zones.length) { toast('Draw at least one zone first.'); return false; }
    const bad = state.zones.filter((z) => validate(z).length);
    if (bad.length) {
      select(bad[0].id);
      toast(`Fix errors in: ${bad.map((z) => z.props.name || '(unnamed)').join(', ')}`);
      return false;
    }
    return true;
  }

  document.getElementById('download-btn').addEventListener('click', () => {
    if (!checkBeforeExport()) return;
    let name = (state.filename || 'geofences').trim();
    if (!/\.(geo)?json$/i.test(name)) name += '.geojson';
    const blob = new Blob([serialize(toGeoJSON())], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.getElementById('copy-btn').addEventListener('click', async () => {
    if (!checkBeforeExport()) return;
    try {
      await navigator.clipboard.writeText(serialize(toGeoJSON()));
      toast('GeoJSON copied to clipboard');
    } catch {
      toast('Clipboard unavailable — use Download instead');
    }
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!state.zones.length || !confirm('Delete all zones?')) return;
    clearZones();
    save();
  });

  function clearZones() {
    for (const z of state.zones) map.removeLayer(z.layer);
    state.zones = [];
    state.selectedId = null;
    renderList();
  }

  // ---------- GeoJSON input ----------
  function num(v, fallback) {
    const n = Number(v);
    return v === undefined || v === null || v === '' || !Number.isFinite(n) ? fallback : n;
  }

  // Load a FeatureCollection (or single Feature). Returns number of zones added.
  function loadGeoJSON(data, { replace }) {
    const features = data.type === 'FeatureCollection' ? data.features || []
      : data.type === 'Feature' ? [data] : [];
    if (replace) {
      clearZones();
      if (data.title !== undefined) state.title = String(data.title);
      if (data.description !== undefined) state.description = String(data.description);
    }
    let added = 0;
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach((rings, i) => {
        const outer = rings[0].map(([lng, lat]) => [lat, lng]);
        const first = outer[0], last = outer[outer.length - 1];
        if (outer.length > 1 && first[0] === last[0] && first[1] === last[1]) outer.pop();
        const p = f.properties || {};
        const name = String(p.name ?? uniqueName('Zone')) + (polys.length > 1 ? ` (${i + 1})` : '');
        addZone(L.polygon(outer), {
          name,
          keepOut: p.keepOut === undefined ? state.defaults.keepOut : p.keepOut === true || p.keepOut === 'true',
          floor: num(p.floor, state.defaults.floor),
          ceiling: num(p.ceiling, state.defaults.ceiling),
          floorFrame: p.floorFrame || state.defaults.floorFrame,
          ceilingFrame: p.ceilingFrame || state.defaults.ceilingFrame,
        });
        added++;
      });
    }
    state.selectedId = null;
    select(null);
    syncSettingsInputs();
    renderPreview();
    return added;
  }

  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const replace = !state.zones.length || confirm('Replace existing zones?\n\nOK = replace, Cancel = add to current zones');
      const n = loadGeoJSON(data, { replace });
      if (replace) state.filename = file.name;
      syncSettingsInputs();
      fitAll();
      save();
      toast(`Imported ${n} zone${n === 1 ? '' : 's'}`);
    } catch (err) {
      toast(`Could not read file: ${err.message}`);
    }
  });

  function fitAll() {
    if (!state.zones.length) return;
    const b = L.featureGroup(state.zones.map((z) => z.layer)).getBounds();
    map.fitBounds(b, { padding: [40, 40] });
  }

  // ---------- Search (OpenStreetMap Nominatim) ----------
  document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;
    const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) { map.setView([Number(coord[1]), Number(coord[2])], 18); return; }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      const [hit] = await res.json();
      if (!hit) { toast('No results found'); return; }
      const [s, n, w, ea] = hit.boundingbox.map(Number);
      map.fitBounds([[s, w], [n, ea]], { maxZoom: 18 });
    } catch {
      toast('Search failed');
    }
  });

  // ---------- Persistence (local draft) ----------
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          geojson: toGeoJSON(), filename: state.filename, defaults: state.defaults,
          view: { center: map.getCenter(), zoom: map.getZoom() },
        }));
      } catch { /* storage unavailable */ }
    }, 300);
  }
  map.on('moveend', save);

  function restore() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { saved = null; }
    if (!saved) return;
    if (saved.defaults) Object.assign(state.defaults, saved.defaults);
    if (saved.filename) state.filename = saved.filename;
    if (saved.geojson) loadGeoJSON(saved.geojson, { replace: true });
    if (saved.view) map.setView(saved.view.center, saved.view.zoom);
  }

  // ---------- Misc ----------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  syncSettingsInputs();
  restore();
  syncSettingsInputs();
  renderList();
})();
