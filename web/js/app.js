// SPDX-FileCopyrightText: 2026 talgya
// SPDX-License-Identifier: GPL-3.0-or-later
//
// UI wiring. The work lives in pipeline.js; this file only talks to the DOM.

import { isAddress, MAX_ITEMS, CHAINS } from './bundle.js';
import { buildBundle } from './pipeline.js';
import { buildZip } from './zip.js';
import { supportsDirectoryWrite, pickDirectory, writeBundle, describeWriteError, isAirlock } from './fsaccess.js';
import { supportsCamera, startScanner, extractAddress } from './qr.js';
import { formatName } from './raw.js';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('fetch-form'), chain: $('chain'), owner: $('owner'), max: $('max'), fetch: $('fetch'), cancel: $('cancel'),
  scan: $('scan'), status: $('status'), items: $('items'), stepWrite: $('step-write'), summary: $('summary'),
  write: $('write'), zip: $('zip'), optionDrive: $('option-drive'), writeStatus: $('write-status'), nextSteps: $('next-steps'),
  scanner: $('scanner'), scannerVideo: $('scanner-video'), scannerStatus: $('scanner-status'), scannerClose: $('scanner-close'),
  rowTemplate: $('item-row'),
};

let result = null; // { manifest, files, items, skipped, totalBytes, source, owner, chainKey }
let controller = null;
let scanner = null;

const kb = (n) => `${Math.round(n / 1024).toLocaleString()} KB`;
const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function rowFor(index, asset) {
  let li = els.items.querySelector(`[data-index="${index}"]`);
  if (!li) {
    li = els.rowTemplate.content.firstElementChild.cloneNode(true);
    li.dataset.index = String(index);
    li.querySelector('.item-title').textContent = asset.name;
    li.querySelector('.item-meta').textContent = asset.collection ? `${asset.collection} · #${asset.tokenId}` : `#${asset.tokenId}`;
    els.items.appendChild(li);
  }
  return li;
}

function paintThumb(canvas, bitmap) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  bitmap.close?.();
}

function onEvent(ev) {
  if (ev.type === 'list') {
    setStatus(els.status, `${ev.count} item${ev.count === 1 ? '' : 's'} reported by ${ev.source}. Fetching images…`);
    return;
  }
  if (ev.type !== 'item') return;
  const li = rowFor(ev.index, ev.asset);
  li.classList.remove('fetching', 'done', 'skipped');
  li.classList.add(ev.status);
  const state = li.querySelector('.item-state');
  if (ev.status === 'fetching') {
    state.textContent = `${ev.index}/${ev.total}`;
  } else if (ev.status === 'done') {
    state.textContent = `${ev.item.width}×${ev.item.height} · ${kb(ev.item.bytes)} · ${formatName(ev.header.format)}`;
    if (ev.preview) paintThumb(li.querySelector('.thumb'), ev.preview);
  } else {
    state.textContent = 'skipped';
    li.querySelector('.item-meta').textContent = ev.reason;
    li.querySelector('.item-meta').title = ev.reason;
  }
  li.scrollIntoView({ block: 'nearest' });
}

async function runFetch(event) {
  event.preventDefault();
  const owner = els.owner.value.trim();
  const chainKey = els.chain.value;
  const max = Math.min(Math.max(Number(els.max.value) || MAX_ITEMS, 1), MAX_ITEMS);
  if (!isAddress(owner)) {
    setStatus(els.status, 'That is not an address: expected 0x followed by 40 hex characters.', 'bad');
    els.owner.focus();
    return;
  }
  result = null;
  els.items.replaceChildren();
  els.items.hidden = false;
  els.stepWrite.hidden = true;
  els.nextSteps.hidden = true;
  setStatus(els.writeStatus, '');
  els.fetch.disabled = true;
  els.cancel.hidden = false;
  controller = new AbortController();
  setStatus(els.status, `Asking ${CHAINS[chainKey].label}'s Blockscout what ${short(owner)} holds…`);
  try {
    const r = await buildBundle({ chainKey, owner, max, signal: controller.signal, onEvent });
    result = { ...r, owner, chainKey };
    const n = r.items.length;
    setStatus(els.status, `${n} image${n === 1 ? '' : 's'} ready (${kb(r.totalBytes)}), ${r.skipped.length} skipped.`, n ? 'ok' : 'bad');
    if (n) {
      els.summary.textContent = `${n} item${n === 1 ? '' : 's'} for ${short(owner)} on ${CHAINS[chainKey].label}, ${kb(r.totalBytes)} of images plus the manifest.`;
      els.stepWrite.hidden = false;
      els.stepWrite.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    if (e.name === 'AbortError') setStatus(els.status, 'Cancelled.');
    else setStatus(els.status, e.message ?? String(e), 'bad');
  } finally {
    els.fetch.disabled = false;
    els.cancel.hidden = true;
    controller = null;
  }
}

async function runWrite() {
  if (!result) return;
  let dir;
  try {
    dir = await pickDirectory();
  } catch (e) {
    const msg = describeWriteError(e);
    if (msg) setStatus(els.writeStatus, msg, 'bad');
    return;
  }
  els.write.disabled = true;
  els.nextSteps.hidden = true;
  setStatus(els.writeStatus, `Writing to "${dir.name}"…`);
  try {
    const out = await writeBundle(dir, result.files, {
      onProgress: (p) => {
        if (p.phase === 'written') setStatus(els.writeStatus, `Writing to "${dir.name}"… ${p.written}/${p.total}`);
      },
    });
    setStatus(els.writeStatus, `Wrote ${out.written} files to "${out.name}/nft/"${out.cleared ? ` (replaced ${out.cleared} old image${out.cleared === 1 ? '' : 's'})` : ''}.`, 'ok');
    showNextSteps(out.name);
  } catch (e) {
    setStatus(els.writeStatus, describeWriteError(e, dir.name) ?? 'Cancelled.', 'bad');
  } finally {
    els.write.disabled = false;
  }
}

function showNextSteps(dirName) {
  const airlock = isAirlock(dirName);
  els.nextSteps.replaceChildren();
  const h = document.createElement('strong');
  h.textContent = airlock ? 'Now unplug the cable.' : 'Now move the drive to the Passport.';
  const p = document.createElement('p');
  p.textContent = airlock
    ? 'The Passport cannot read the Airlock while a computer holds it. Unplug, then on the device open NFTs → Load from Airlock.'
    : 'Eject the drive, plug it into the Passport, then open NFTs → Load from USB drive.';
  els.nextSteps.append(h, p);
  els.nextSteps.hidden = false;
}

function runZip() {
  if (!result) return;
  const zip = buildZip(result.files.map((f) => ({ name: f.path, data: f.data })));
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `passport-nft-${result.chainKey}-${result.owner.slice(2, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus(els.writeStatus, `Downloaded ${a.download} (${kb(zip.length)}). Extract it onto the drive so nft/ is at the top level, then NFTs → Load from USB drive.`, 'ok');
}

async function openScanner() {
  els.scannerStatus.textContent = 'Starting camera…';
  els.scanner.showModal();
  try {
    scanner = await startScanner(els.scannerVideo, {
      onResult: (text) => {
        const addr = extractAddress(text);
        if (addr) {
          els.owner.value = addr;
          closeScanner();
          els.owner.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          els.scannerStatus.textContent = `QR read, but it holds no address: ${text.slice(0, 60)}`;
        }
      },
    });
    els.scannerStatus.textContent = `Point the camera at the wallet's address QR (${scanner.kind === 'native' ? 'native detector' : 'jsQR'}).`;
  } catch (e) {
    els.scannerStatus.textContent = e.name === 'NotAllowedError' ? 'Camera access was denied.' : `Camera unavailable: ${e.message}`;
  }
}

function closeScanner() {
  scanner?.stop();
  scanner = null;
  if (els.scanner.open) els.scanner.close();
}

function init() {
  els.form.addEventListener('submit', runFetch);
  els.cancel.addEventListener('click', () => controller?.abort());
  els.write.addEventListener('click', runWrite);
  els.zip.addEventListener('click', runZip);
  els.scan.addEventListener('click', openScanner);
  els.scannerClose.addEventListener('click', closeScanner);
  els.scanner.addEventListener('close', closeScanner);

  if (!supportsDirectoryWrite()) {
    els.write.disabled = true;
    const hint = els.optionDrive.querySelector('.hint');
    hint.textContent = 'Direct drive access needs a Chromium browser (Chrome, Edge, or Brave with the flag below). Use the .zip instead.';
    // Brave ships with the File System Access API off; the flag turns it on.
    Promise.resolve(navigator.brave?.isBrave?.()).then((brave) => {
      if (brave) {
        hint.textContent =
          'Brave turns this API off by default. Open brave://flags/#file-system-access-api, set it to Enabled, relaunch, and reload this page. Or use the .zip.';
      }
    }).catch(() => {});
  }
  if (!supportsCamera()) els.scan.hidden = true;

  const params = new URLSearchParams(location.search);
  if (params.get('owner')) els.owner.value = params.get('owner');
  if (params.get('chain') && CHAINS[params.get('chain')]) els.chain.value = params.get('chain');
}

init();
