// Pabst Precision Farming Kit – Feldmarker: Export direkt im Browser
// Shapefile (Punkte, WGS84) + ZIP ohne fremde Bibliotheken, dazu CSV und GeoJSON.
(function (root) {
  'use strict';
  const enc = new TextEncoder();

  const PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  const FIELDS = [
    { name: 'ID', type: 'C', len: 40, get: p => p.uid },
    { name: 'FELD', type: 'C', len: 60, get: p => p.feld },
    { name: 'KATEGORIE', type: 'C', len: 12, get: p => p.kategorie },
    { name: 'KAT_NR', type: 'N', len: 2, dec: 0, get: p => p.cat },
    { name: 'GENAU_M', type: 'N', len: 7, dec: 3, get: p => p.acc },
    { name: 'ZEIT', type: 'C', len: 19, get: p => p.zeit },
    { name: 'TAG', type: 'C', len: 10, get: p => p.tag },
    { name: 'LAT', type: 'N', len: 12, dec: 7, get: p => p.lat },
    { name: 'LON', type: 'N', len: 12, dec: 7, get: p => p.lon }
  ];

  function bbox(pts) {
    if (!pts.length) return [0, 0, 0, 0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(p => { x0 = Math.min(x0, p.lon); x1 = Math.max(x1, p.lon); y0 = Math.min(y0, p.lat); y1 = Math.max(y1, p.lat); });
    return [x0, y0, x1, y1];
  }

  function shpHeader(dv, lengthBytes, box) {
    dv.setInt32(0, 9994, false);
    dv.setInt32(24, lengthBytes / 2, false);
    dv.setInt32(28, 1000, true);
    dv.setInt32(32, 1, true);                 // Point
    box.forEach((v, i) => dv.setFloat64(36 + i * 8, v, true));
  }

  // UTF-8-Text auf feste Bytebreite bringen, ohne ein Zeichen zu zerschneiden
  function fixedBytes(str, len) {
    let b = enc.encode(str == null ? '' : String(str));
    if (b.length > len) {
      let cut = len;
      while (cut > 0 && (b[cut] & 0xC0) === 0x80) cut--;
      b = b.slice(0, cut);
    }
    const out = new Uint8Array(len).fill(0x20);
    out.set(b, 0);
    return out;
  }

  function numBytes(v, len, dec) {
    if (v == null || Number.isNaN(v)) return new Uint8Array(len).fill(0x20);
    let s = Number(v).toFixed(dec);
    if (s.length > len) s = s.slice(0, len);
    return enc.encode(s.padStart(len, ' '));
  }

  function shapefile(pts) {
    const n = pts.length, box = bbox(pts);
    // .shp
    const shpLen = 100 + n * 28;
    const shp = new ArrayBuffer(shpLen), sv = new DataView(shp);
    shpHeader(sv, shpLen, box);
    pts.forEach((p, i) => {
      const o = 100 + i * 28;
      sv.setInt32(o, i + 1, false);
      sv.setInt32(o + 4, 10, false);
      sv.setInt32(o + 8, 1, true);
      sv.setFloat64(o + 12, p.lon, true);
      sv.setFloat64(o + 20, p.lat, true);
    });
    // .shx
    const shxLen = 100 + n * 8;
    const shx = new ArrayBuffer(shxLen), xv = new DataView(shx);
    shpHeader(xv, shxLen, box);
    pts.forEach((p, i) => {
      xv.setInt32(100 + i * 8, (100 + i * 28) / 2, false);
      xv.setInt32(104 + i * 8, 10, false);
    });
    // .dbf
    const recLen = 1 + FIELDS.reduce((s, f) => s + f.len, 0);
    const headLen = 32 + 32 * FIELDS.length + 1;
    const dbf = new Uint8Array(headLen + n * recLen + 1);
    const dv = new DataView(dbf.buffer);
    const d = new Date();
    dbf[0] = 0x03; dbf[1] = d.getFullYear() - 1900; dbf[2] = d.getMonth() + 1; dbf[3] = d.getDate();
    dv.setUint32(4, n, true);
    dv.setUint16(8, headLen, true);
    dv.setUint16(10, recLen, true);
    FIELDS.forEach((f, i) => {
      const o = 32 + i * 32;
      dbf.set(enc.encode(f.name).slice(0, 10), o);
      dbf[o + 11] = f.type.charCodeAt(0);
      dbf[o + 16] = f.len;
      dbf[o + 17] = f.dec || 0;
    });
    dbf[headLen - 1] = 0x0D;
    pts.forEach((p, i) => {
      let o = headLen + i * recLen;
      dbf[o++] = 0x20;
      FIELDS.forEach(f => {
        const v = f.get(p);
        dbf.set(f.type === 'C' ? fixedBytes(v, f.len) : numBytes(v, f.len, f.dec), o);
        o += f.len;
      });
    });
    dbf[dbf.length - 1] = 0x1A;
    return { shp: new Uint8Array(shp), shx: new Uint8Array(shx), dbf, prj: enc.encode(PRJ), cpg: enc.encode('UTF-8') };
  }

  // ---------------------------------------------------------- ZIP (ohne Kompression)
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {          // files: [{name, data: Uint8Array}]
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    });
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
    let o = 0; all.forEach(b => { out.set(b, o); o += b.length; });
    return out;
  }

  // ---------------------------------------------------------- Komfort
  const KAT = ['Maus', 'Unkraut', 'Grenzstein'];
  const pad = n => String(n).padStart(2, '0');
  function lokal(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function enrich(pts, feldName) {
    return pts.map(p => ({ ...p, feld: feldName || '', kategorie: KAT[p.cat], zeit: lokal(p.t), tag: lokal(p.t).slice(0, 10),
      acc: p.acc == null ? null : Math.round(p.acc * 1000) / 1000 }));
  }

  function shapefileZip(pts, feldName, base) {
    const rows = enrich(pts, feldName);
    const files = [];
    const add = (prefix, r) => { const s = shapefile(r); for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) files.push({ name: `${prefix}.${ext}`, data: s[ext] }); };
    add(base, rows);
    KAT.forEach((k, i) => {
      const teil = rows.filter(r => r.cat === i);
      if (teil.length) add(`je_kategorie/${base}_${k.toLowerCase()}`, teil);
    });
    return zip(files);
  }

  function csv(pts, feldName) {
    const z = v => String(v).replace('.', ',');
    const lines = [['id', 'feld', 'kategorie', 'lat', 'lon', 'genauigkeit_m', 'zeit', 'tag'].join(';')];
    enrich(pts, feldName).forEach(p => lines.push([p.uid, (p.feld || '').replace(/;/g, ','), p.kategorie, z(p.lat.toFixed(7)), z(p.lon.toFixed(7)),
      p.acc == null ? '' : z(p.acc.toFixed(3)), p.zeit, p.tag].join(';')));
    return enc.encode('﻿' + lines.join('\r\n') + '\r\n');
  }

  function geojson(pts, feldName) {
    return enc.encode(JSON.stringify({
      type: 'FeatureCollection',
      features: enrich(pts, feldName).map(p => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.uid, feld: p.feld, kategorie: p.kategorie, genauigkeit_m: p.acc, zeit: p.zeit, tag: p.tag }
      }))
    }, null, 1));
  }

  function safeName(s) {
    const map = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
    s = String(s || '').replace(/[äöüÄÖÜß]/g, c => map[c]).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
    return s.slice(0, 40) || 'feld';
  }

  const api = { shapefile, zip, shapefileZip, csv, geojson, safeName, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMExport = api;
})(typeof self !== 'undefined' ? self : this);
