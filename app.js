import ICAL from './vendor/ical.min.js';
import { parseICS, buildICS, mergedEvents, normalizeUrl, emptyConfig, emptyRemote, startMs, categoriesOf, googlePayload } from './shared/ics.js';
import { findGist, readGist, writeGist, createGist, dispatchSync } from './shared/gist.js';
import { MUSIC_SOURCE_ID, searchArtists, musicReleases } from './shared/itunes.js';

/* ================= État ================= */
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('radar.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('radar.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('radar.' + k); } catch {} },
};

const COLORS = ['#0B8A65', '#2F6FEB', '#E0573B', '#C2410C', '#9333EA', '#DB2777', '#0891B2', '#65A30D', '#CA8A04', '#64748B'];
const SYNC_EVERY = '30 min';

const S = {
  token: LS.get('token'),
  gistId: LS.get('gistId'),
  config: LS.get('config') || emptyConfig(),
  remote: LS.get('remote') || emptyRemote(),
  icsUrl: LS.get('icsUrl'),
  tab: ({ share: 'settings' })[LS.get('tab', 'home')] || LS.get('tab', 'home'),
  filter: 'all',
  query: '',
  loading: false,
  lastLoad: LS.get('lastLoad'),
  syncToken: LS.get('syncToken'),
  syncing: {},
};

/* ================= Utilitaires ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const localDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTime = (iso) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const evDayKey = (ev) => (ev.allDay ? ev.start : localDateKey(new Date(ev.start)));
const evEndMs = (ev) => {
  if (ev.allDay) return keyToDate(ev.end && ev.end > ev.start ? ev.end : ev.start).getTime() + (ev.end && ev.end > ev.start ? 0 : 864e5);
  return Date.parse(ev.end || ev.start);
};
const evStartLocalMs = (ev) => (ev.allDay ? keyToDate(ev.start).getTime() : Date.parse(ev.start));

function dayLabel(key) {
  const d = keyToDate(key);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 864e5);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  const s = new Intl.DateTimeFormat('fr-FR', opts).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function relDays(key) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((keyToDate(key) - today) / 864e5);
  if (diff < 2) return '';
  if (diff < 7) return `dans ${diff} j`;
  if (diff < 60) return `dans ${Math.round(diff / 7)} sem.`;
  return `dans ${Math.round(diff / 30)} mois`;
}
function countdown(ev) {
  const ms = evStartLocalMs(ev) - Date.now();
  if (ms <= 0) return { n: 'En', u: 'cours' };
  const m = Math.round(ms / 6e4);
  if (m < 60) return { n: m, u: 'min' };
  const h = Math.round(m / 60);
  if (h < 36) return { n: h, u: h > 1 ? 'heures' : 'heure' };
  const d = Math.round(h / 24);
  return { n: d, u: 'jours' };
}
function whenText(ev) {
  const d = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (ev.allDay) {
    const endIncl = ev.end && ev.end > ev.start ? new Date(keyToDate(ev.end).getTime() - 864e5) : keyToDate(ev.start);
    const a = d.format(keyToDate(ev.start));
    return localDateKey(endIncl) === ev.start ? `${a} · toute la journée` : `Du ${a} au ${d.format(endIncl)}`;
  }
  const s = new Date(ev.start), e = new Date(ev.end || ev.start);
  if (localDateKey(s) === localDateKey(e)) return `${d.format(s)} · ${fmtTime(ev.start)} – ${fmtTime(ev.end || ev.start)}`;
  return `${d.format(s)} ${fmtTime(ev.start)} → ${d.format(e)} ${fmtTime(ev.end)}`;
}
function ago(iso) {
  if (!iso) return 'jamais';
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function persist() {
  LS.set('config', S.config); LS.set('remote', S.remote); LS.set('icsUrl', S.icsUrl); LS.set('lastLoad', S.lastLoad);
}

const ICON = {
  radar: '<svg class="logo" viewBox="0 0 96 96" style="color:var(--accent)"><circle cx="48" cy="48" r="44" fill="var(--accent-soft)" stroke="none"/><circle cx="48" cy="48" r="32" opacity=".45"/><circle cx="48" cy="48" r="18" opacity=".7"/><path d="M48 48 L80 30" stroke-width="3"/><circle cx="48" cy="48" r="4" fill="currentColor" stroke="none"/><circle cx="66" cy="62" r="4.5" fill="currentColor" stroke="none"/><circle cx="34" cy="30" r="3" fill="currentColor" stroke="none" opacity=".7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  google: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4M9 15h6M12 12v6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
};

const cats = () => categoriesOf(S.config);
const catById = (id) => cats().find((c) => c.id === id);
/** Sélecteur de rubrique (pastilles). */
function catPicker(selected, { noneLabel = 'Aucune' } = {}) {
  return `<div class="chips cat-picker" style="margin:0;padding:4px 0 2px;flex-wrap:wrap;overflow:visible">
    ${cats().map((c) => `<button type="button" class="chip ${selected === c.id ? 'on' : ''}" data-cat="${esc(c.id)}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('')}
    <button type="button" class="chip ${!selected ? 'on' : ''}" data-cat="">${esc(noneLabel)}</button></div>`;
}
function bindCatPicker(root, onPick) {
  root.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => {
    root.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.cat || null);
  }));
}

/* Illustrations de fond par rubrique (viewBox 100×100, trait). */
const ART = {
  ballon: { label: 'Ballon', svg: '<circle cx="50" cy="50" r="44"/><path d="M50 33 66 44.5 60 63H40l-6-18.5Z" fill="currentColor"/><path d="M50 33V6.5M66 44.5l25-8M60 63l15.5 21.5M40 63 24.5 84.5M34 44.5l-25-8"/><path d="M38 9.5 50 6.5l12 3M86 27l5 9.5-1.5 12M84 75l-8.5 9.5L64 89M36 89l-11.5-4.5L16 75M10.5 48.5 9 36.5 14 27"/>' },
  manette: { label: 'Manette', svg: '<path d="M31 30h38c11 0 18.5 8 20.5 19.5l4 19c2 10-4.5 17.5-12.5 17.5-6.5 0-10-4.5-13-9.5l-3-5H35l-3 5c-3 5-6.5 9.5-13 9.5-8 0-14.5-7.5-12.5-17.5l4-19C12.5 38 20 30 31 30Z"/><path d="M28 44v16M20 52h16"/><circle cx="70" cy="46" r="3.5" fill="currentColor"/><circle cx="78" cy="54" r="3.5" fill="currentColor"/><circle cx="62" cy="54" r="3.5" fill="currentColor"/><circle cx="70" cy="62" r="3.5" fill="currentColor"/>' },
  clap: { label: 'Clap', svg: '<rect x="12" y="42" width="76" height="46" rx="5"/><path d="M12 42h76"/><path d="m10 36 74-17 3 12-74 17Z"/><path d="m24 33 9 11M41 29l9 11M58 25l9 11M75 21l8 10"/><path d="M24 58h52M24 70h34"/>' },
  tele: { label: 'Télé', svg: '<rect x="10" y="28" width="80" height="54" rx="8"/><rect x="18" y="36" width="52" height="38" rx="4"/><path d="m36 12 14 16 14-16M34 90h32"/><circle cx="80" cy="44" r="3" fill="currentColor"/><circle cx="80" cy="56" r="3" fill="currentColor"/>' },
  lecture: { label: 'Lecture', svg: '<rect x="8" y="20" width="84" height="60" rx="16"/><path d="M42 36v28l24-14Z" fill="currentColor"/>' },
  musique: { label: 'Musique', svg: '<path d="M38 74V22l46-10v52"/><circle cx="27" cy="74" r="11"/><circle cx="73" cy="64" r="11"/><path d="M38 36l46-10"/>' },
  ticket: { label: 'Billet', svg: '<path d="M10 30h80v12a8 8 0 0 0 0 16v12H10V58a8 8 0 0 0 0-16Z"/><path d="M64 30v40" stroke-dasharray="4 5"/><path d="m33 41 3.5 7 7.5 1-5.5 5.5 1.5 7.5-7-3.5-7 3.5 1.5-7.5L22 49l7.5-1Z" fill="currentColor"/>' },
  etoile: { label: 'Étoile', svg: '<path d="m50 8 12.5 26 28.5 4-20.5 20 5 28.5L50 73 24.5 86.5l5-28.5L9 38l28.5-4Z"/>' },
  radar: { label: 'Radar', svg: '<circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="31"/><circle cx="50" cy="50" r="16"/><path d="M50 50 83 30"/><circle cx="50" cy="50" r="3" fill="currentColor"/>' },
};
const DEFAULT_ART = { sport: 'ballon', jeux: 'manette', film: 'clap', serie: 'tele', video: 'lecture', musique: 'musique' };
const artOf = (cat) => (cat && (cat.icon || DEFAULT_ART[cat.id])) || 'radar';
const artSvg = (key, cls = 'art') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${(ART[key] || ART.radar).svg}</svg>`;

/* ================= Données ================= */
async function load({ quiet = false } = {}) {
  if (!S.token || !S.gistId || S.loading) return;
  S.loading = true; if (!quiet) render();
  try {
    const g = await readGist(S.token, S.gistId);
    if (LS.get('dirty')) {
      // une modification faite hors ligne n'a pas été envoyée : on la publie maintenant
      const remote = g.remote || S.remote;
      await writeGist(S.token, S.gistId, { 'config.json': S.config, 'radar.ics': buildICS(S.config, remote), 'google.json': googlePayload(S.config, remote) });
      g.config = S.config; LS.del('dirty');
      toast('Modifications hors ligne envoyées ✓');
    }
    S.config = { ...emptyConfig(), ...(g.config || {}) };
    S.remote = g.remote || emptyRemote();
    S.icsUrl = g.icsRawUrl;
    S.lastLoad = new Date().toISOString();
    persist();
  } catch (err) {
    if (err.status === 401 || err.status === 404) { toast(err.message, 5000); }
    else if (!quiet) toast('Hors ligne : affichage de la dernière version.');
  } finally { S.loading = false; render(); }
}

/** Applique une modification sur la config la plus récente, puis publie config.json + radar.ics. */
let saving = Promise.resolve();
function mutate(fn, okMsg) {
  fn(S.config); persist(); render(); // optimiste
  saving = saving.then(async () => {
    try {
      const g = await readGist(S.token, S.gistId);
      const cfg = { ...emptyConfig(), ...(g.config || {}) };
      fn(cfg);
      const remote = g.remote || S.remote;
      await writeGist(S.token, S.gistId, { 'config.json': cfg, 'radar.ics': buildICS(cfg, remote), 'google.json': googlePayload(cfg, remote) });
      S.config = cfg; S.remote = remote; LS.del('dirty'); persist(); render();
      if (okMsg) toast(okMsg);
    } catch (err) {
      if (err.status === 401 || err.status === 404) toast("Échec de l'enregistrement : " + err.message, 5000);
      else { LS.set('dirty', true); toast('Hors ligne : la modification sera envoyée au prochain lancement.', 4000); }
    }
  });
  return saving;
}

/** Essaie de lire un flux directement depuis le téléphone (possible si le serveur autorise CORS). */
async function tryDirectFetch(src) {
  try {
    const res = await fetch(normalizeUrl(src.url), { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) return { error: "Ce lien ne renvoie pas un calendrier .ics" };
    return parseICS(text, ICAL);
  } catch { return null; } // CORS bloqué : la synchro GitHub s'en chargera
}

async function publishRemoteFor(src, parsed) {
  const g = await readGist(S.token, S.gistId);
  const remote = g.remote || emptyRemote();
  remote.sources = remote.sources || {};
  remote.sources[src.id] = { fetchedAt: new Date().toISOString(), calName: parsed.calName, error: null, events: parsed.events, via: 'app' };
  const cfg = { ...emptyConfig(), ...(g.config || {}) };
  await writeGist(S.token, S.gistId, { 'remote.json': remote, 'radar.ics': buildICS(cfg, remote), 'google.json': googlePayload(cfg, remote) });
  S.remote = remote; S.config = cfg; persist(); render();
}

/** Déclenche la synchro GitHub et attend que les sources demandées soient relues. */
async function syncNow(ids, { quietOk = false, silent = false } = {}) {
  ids = ids.filter(Boolean);
  if (!ids.length) return;
  const t0 = Date.now();
  try {
    await dispatchSync(S.syncToken || S.token);
  } catch (err) {
    if (silent) return;
    if ([401, 403, 404, 422].includes(err.status)) { openSyncTokenSheet(() => syncNow(ids, { quietOk })); return; }
    toast('Impossible de lancer la synchro : ' + err.message, 5000); return;
  }
  ids.forEach((id) => (S.syncing[id] = true)); render();
  if (!quietOk && !silent) toast('Synchronisation lancée…');
  const done = (r) => r && Math.max(Date.parse(r.fetchedAt || 0) || 0, Date.parse(r.failedAt || 0) || 0) >= t0 - 3000;
  for (let i = 0; i < 36; i++) { // jusqu'à 3 min
    await new Promise((r) => setTimeout(r, i < 4 ? 8000 : 5000));
    try {
      const g = await readGist(S.token, S.gistId);
      const remote = g.remote || emptyRemote();
      if (ids.every((id) => done(remote.sources?.[id]))) {
        S.remote = remote; S.config = { ...emptyConfig(), ...(g.config || {}) }; S.lastLoad = new Date().toISOString();
        ids.forEach((id) => delete S.syncing[id]); persist(); render();
        const errs = ids.map((id) => remote.sources[id]).filter((r) => r.error);
        const n = ids.reduce((a, id) => a + (remote.sources[id].error ? 0 : remote.sources[id].events.length), 0);
        if (!silent || errs.length) toast(errs.length ? `Erreur : ${errs[0].error}` : `${n} événement${n > 1 ? 's' : ''} synchronisé${n > 1 ? 's' : ''} ✓`, 4000);
        return;
      }
    } catch { /* réseau : on réessaie */ }
  }
  ids.forEach((id) => delete S.syncing[id]); render();
  if (!silent) toast('La synchro prend du temps : le résultat apparaîtra à la prochaine actualisation.', 5000);
}

function openSyncTokenSheet(retry) {
  const on = !!S.syncToken;
  const tokenUrl = 'https://github.com/settings/personal-access-tokens/new?name=Radar%20synchro&description=Lancer%20la%20synchro%20Radar&expires_in=none&actions=write';
  const form = `<div data-form ${on ? 'hidden' : ''}>
      <div class="section-title">${on ? 'Nouveau jeton' : 'Activer en 3 étapes'}</div>
      <div class="card">
        <div class="kv"><span>1 · Créer le jeton sur GitHub</span><div><a class="inline-btn" href="${tokenUrl}" target="_blank" rel="noopener">Ouvrir GitHub ↗</a></div></div>
        <div class="kv"><span>2 · Régler</span><div>Nom « Radar synchro » · expiration la plus longue<br>Dépôt <b>radar</b> uniquement · Actions : <b>Read and write</b></div></div>
        <label class="field"><span>3 · Coller le jeton</span><input name="st" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      </div>
      <div class="err-msg" data-err hidden></div>
      <div class="btns"><button class="btn" data-ok>Activer</button></div>
    </div>`;
  (retry ? openSheet : openPage)(`<div class="sheet-head"><button data-close>Fermer</button><h3>Synchro immédiate</h3><span style="width:56px"></span></div>
    <div class="stack">
      <div class="card"><div class="row"><span class="dot" style="width:10px;height:10px;background:${on ? 'var(--succes)' : 'var(--faint)'}"></span>
        <div class="grow"><div class="name">${on ? 'Activée' : 'Désactivée'}</div>
        <div class="info">${on ? 'Un agenda ajouté est lu tout de suite.' : `Sans elle, un agenda ajouté est lu sous ${SYNC_EVERY}.`}</div></div></div></div>
      ${on ? `<div class="btns" data-actions><button class="btn ghost" data-replace>Remplacer le jeton</button><button class="btn danger" data-off>Désactiver</button></div>` : ''}
      ${form}
    </div>`, (sh) => {
    sh.querySelector('[data-close]').onclick = closeSheet;
    const rep = sh.querySelector('[data-replace]');
    if (rep) rep.onclick = () => { sh.querySelector('[data-actions]').hidden = true; sh.querySelector('[data-form]').hidden = false; sh.querySelector('[name="st"]').focus(); };
    const off = sh.querySelector('[data-off]');
    if (off) off.onclick = () => {
      if (!confirm('Désactiver la synchro immédiate sur cet appareil ?')) return;
      S.syncToken = null; LS.del('syncToken'); closeSheet(); render(); toast('Synchro immédiate désactivée');
    };
    sh.querySelector('[data-ok]').onclick = async () => {
      const v = sh.querySelector('[name="st"]').value.trim();
      const err = sh.querySelector('[data-err]');
      if (!v) { err.textContent = 'Colle le jeton.'; err.hidden = false; return; }
      const b = sh.querySelector('[data-ok]'); b.disabled = true; b.textContent = 'Vérification…';
      try {
        await dispatchSync(v);
        S.syncToken = v; LS.set('syncToken', v); closeSheet(); render(); toast('Synchro immédiate activée ✓');
        if (retry) retry();
      } catch (e) {
        err.textContent = e.status === 401 ? 'Jeton refusé.' : "Ce jeton ne peut pas lancer la synchro : vérifie le dépôt « radar » et « Actions : Read and write ».";
        err.hidden = false; b.disabled = false; b.textContent = 'Activer';
      }
    };
  });
}

/** Ajoute un calendrier lié et le lit tout de suite (directement si possible, sinon via la synchro GitHub). */
async function addSource({ name, url, category, translate = true }) {
  const parsed = await tryDirectFetch({ url });
  if (parsed && parsed.error) return { error: parsed.error };
  if (!name) name = parsed?.calName || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Calendrier'; } })();
  const src = { id: uid(), name, url, category: category || undefined, enabled: true, translate, addedAt: new Date().toISOString() };
  if (S.tab !== 'sources') { S.tab = 'sources'; LS.set('tab', 'sources'); }
  if (!parsed) S.syncing[src.id] = true;
  await mutate((c) => { c.sources = [...(c.sources || []), src]; }, null);
  if (parsed) {
    try { await publishRemoteFor(src, parsed); toast(`${src.name} : ${parsed.events.length} événements importés ✓`); }
    catch (e2) { syncNow([src.id]); }
  } else {
    delete S.syncing[src.id];
    syncNow([src.id]); // le serveur du calendrier bloque la lecture directe : GitHub s'en charge tout de suite
  }
  return { ok: true };
}

/* Calendriers gratuits vérifiés (recherche du 12/11/2026), à ajouter d'un appui depuis Sources. */
const SUGGESTIONS = [
  { group: 'Football', cat: 'sport', items: [
    ['OM', 'https://matchcalendar.football/team/marseille/marseille.ics'],
    ['Ligue des champions', 'https://matchcalendar.football/competition/champions-league/champions-league.ics'],
    ['Équipe de France', 'https://matchcalendar.football/team/france/france.ics'],
    ['Real Madrid', 'https://matchcalendar.football/team/real-madrid/real-madrid.ics'],
  ] },
  { group: 'Séries', cat: 'serie', items: [
    ['Netflix', 'https://www.smartcalendars.ai/cal/4fc097ff8c48803f38c6272953b5c349e4669652cc4686e154ecc61a7b7d968f.ics'],
    ['Prime Video', 'https://www.smartcalendars.ai/cal/a1d170b8827c245b4bf4391c83e3551a797f91537c3d9a0f291efbd6bdde4d29.ics'],
    ['Disney+', 'https://www.smartcalendars.ai/cal/53757181785a61d01d52b99de46f6e975311dd558adf00e3828a01756c08a1b5.ics'],
    ['Apple TV+', 'https://www.smartcalendars.ai/cal/e93ddfee3629f75f5eec91218b5b42027335911a7d42b820b8d5c82ad1081bdf.ics'],
  ] },
  { group: 'Films', cat: 'film', items: [
    ['Films les plus attendus', 'https://www.smartcalendars.ai/cal/1d98bae7fac4944084f941ee1e715ec74b994c71e7c596ec01b38b61d37a9067.ics'],
  ] },
];
const sameFeed = (a, b) => normalizeUrl(a).replace(/[?#].*$/, '').replace(/\/+$/, '') === normalizeUrl(b).replace(/[?#].*$/, '').replace(/\/+$/, '');
/** Rubrique existante la plus proche (ex. « serie » absente → la rubrique Film). */
function suggestCat(id) {
  if (catById(id)) return id;
  const byName = cats().find((c) => c.name.toLowerCase().includes(id === 'serie' ? 'séri' : id === 'film' ? 'film' : id));
  return byName ? byName.id : null;
}

/* ================= Rendu ================= */
function render() {
  const app = $('#app');
  const connected = S.token && S.gistId;
  $('#tabbar').hidden = !connected;
  $('#fab').hidden = true; // le « + » est dans l'en-tête de l'Agenda, comme dans Sources et Réglages
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  // Comme dans Fantôme : sur l'Accueil, le menu en haut puis le grand titre ; ailleurs, le titre
  // plus petit au-dessus du menu. Pendant un changement d'onglet, la transition fait glisser l'un et l'autre.
  const titre = $('.titre-site'), menu = $('#tabbar');
  const accueil = !connected || S.tab === 'home';
  titre.classList.toggle('accueil', accueil);
  app.classList.toggle('sans-feuille', connected && S.tab === 'home'); // Accueil : les cartes posées sur le fond, comme dans Fantôme
  if (accueil && connected && menu.nextElementSibling !== titre) document.body.insertBefore(menu, titre);
  if (!accueil && titre.nextElementSibling !== menu) document.body.insertBefore(titre, menu);
  if (!connected) { app.innerHTML = viewSetup(); bindSetup(); return; }
  if (S.tab === 'sources') app.innerHTML = viewSources();
  else if (S.tab === 'settings') app.innerHTML = viewSettings();
  else if (S.tab === 'agenda') app.innerHTML = viewAgenda();
  else app.innerHTML = viewHome();
  bindView();
}

function header(title, sub, buttons) {
  return `<header class="head"><div><h1 class="visually-hidden">${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    ${buttons || `<button class="iconbtn ${S.loading ? 'spin' : ''}" data-act="reload" aria-label="Actualiser">${ICON.refresh}</button>`}</header>`;
}

function allEvents() { return mergedEvents(S.config, S.remote); }

/** Où le voir : la chaîne d'un match ou la plateforme d'un film, d'une série ou d'une sortie musicale. */
const whereOf = (ev) => ev.tv || ev.platform || '';

function nextCard(ev, label = 'Prochain') {
  const c = countdown(ev);
  const nc = catById(ev.category);
  const bg = nc ? ` style="--card:${esc(nc.color)}"` : '';
  return `<button class="next ${nc ? 'cat' : ''} art-${artOf(nc)}" data-ev="${esc(ev.icsUid)}"${bg}>${artSvg(artOf(nc))}
    <div class="k">${esc(label)}</div><div class="t">${esc(ev.title)}</div>
    <div class="w">${esc(dayLabel(evDayKey(ev)))}${ev.allDay ? '' : ' · ' + fmtTime(ev.start)}${ev.location ? ' · ' + esc(ev.location) : ''}</div>
    ${whereOf(ev) ? `<div class="where">${esc(whereOf(ev))}</div>` : ''}
    <div class="count"><b>${c.n}</b><span>${c.u}</span></div></button>`;
}
function eventRow(e, now = Date.now(), withDay = false) {
  const past = evEndMs(e) <= now;
  const time = e.allDay ? `<div class="time">Jour<small>entier</small></div>`
    : `<div class="time">${fmtTime(e.start)}${e.end && e.end !== e.start ? `<small>${fmtTime(e.end)}</small>` : ''}</div>`;
  const meta = [withDay && `<span>${esc(dayLabel(evDayKey(e)))}</span>`, e.location && `<span>${esc(e.location)}</span>`,
    whereOf(e) && `<span class="where-tag">${esc(whereOf(e))}</span>`].filter(Boolean).join('');
  return `<button class="ev ${past ? 'past' : ''}" data-ev="${esc(e.icsUid)}">${time}
    <div class="bar" style="background:${esc(e.color || 'var(--faint)')}"></div>
    <div><div class="title">${esc(e.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div></button>`;
}

/** Accueil : les événements du jour, complétés par les suivants (au moins 3), chacun en carte de rubrique. */
function viewHome() {
  const now = Date.now();
  const todayKey = localDateKey(new Date());
  const evs = allEvents().filter((e) => evEndMs(e) > now);
  let html = '';
  // Les événements du jour (en cours ou à venir), complétés par les suivants pour en avoir au moins 3.
  const isToday = (e) => (e.allDay ? e.start <= todayKey : localDateKey(new Date(e.start)) <= todayKey);
  const items = evs.filter(isToday);
  for (const e of evs) { if (items.length >= 3) break; if (!items.includes(e)) items.push(e); }
  if (!items.length) {
    return html + `<div class="empty">${ICON.radar}<h3>Rien sur le radar</h3><p>Ajoute un événement ou lie un calendrier.</p></div>`;
  }
  // chacun dans une carte aux couleurs de sa rubrique, dans l'ordre chronologique
  const nextEv = items.find((e) => evStartLocalMs(e) > now) || items[0];
  html += `<div class="next-list">${items.map((e) => nextCard(e, evStartLocalMs(e) <= now ? 'En cours' : e === nextEv ? 'Prochain' : 'Ensuite')).join('')}</div>`;
  return html;
}

function viewAgenda() {
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  let evs = allEvents().filter((e) => evEndMs(e) > startToday.getTime());
  const presentCats = new Set(evs.map((e) => e.category || ''));
  if (S.filter === 'none') evs = evs.filter((e) => !e.category);
  else if (S.filter !== 'all') evs = evs.filter((e) => e.category === S.filter);
  if (S.query) {
    const q = S.query.toLowerCase();
    evs = evs.filter((e) => [e.title, e.location, e.notes, e.categoryName].some((x) => x && x.toLowerCase().includes(q)));
  }
  const upcoming = evs.filter((e) => evEndMs(e) > now);
  const busy = S.loading || Object.keys(S.syncing).length > 0;
  let html = `<div class="toolbar"><h1 class="visually-hidden">Agenda</h1><label class="search">${ICON.search}<input id="q" type="search" placeholder="Rechercher" value="${esc(S.query)}" autocomplete="off"></label>
    <div class="head-btns">
      <button class="iconbtn" data-act="add" aria-label="Ajouter" title="Ajouter"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="iconbtn ${busy ? 'spin' : ''}" data-act="refresh-all" ${Object.keys(S.syncing).length ? 'disabled' : ''} aria-label="Synchroniser" title="Synchroniser les sources et l'agenda">${ICON.refresh}</button>
    </div></div>`;

  {
    const shownCats = cats().filter((c) => presentCats.has(c.id) || S.filter === c.id);
    if (shownCats.length) {
      html += `<div class="chips">
        <button class="chip ${S.filter === 'all' ? 'on' : ''}" data-filter="all">Tout</button>
        ${shownCats.map((c) => `<button class="chip ${S.filter === c.id ? 'on' : ''}" data-filter="${esc(c.id)}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`).join('')}
        ${presentCats.has('') || S.filter === 'none' ? `<button class="chip ${S.filter === 'none' ? 'on' : ''}" data-filter="none"><span class="dot" style="background:var(--faint)"></span>Sans rubrique</button>` : ''}
      </div>`;
    }
  }

  if (!evs.length) {
    html += S.query || S.filter !== 'all'
      ? `<div class="empty"><p>Aucun événement ne correspond.</p></div>`
      : `<div class="empty">${ICON.radar}<h3>Rien sur le radar</h3><p>Ajoute un événement à la main ou colle le lien d'un calendrier (Sync2Cal, Google, sport…).</p>
          <button class="btn" data-act="add" style="max-width:260px;margin:0 auto">Ajouter</button></div>`;
    return html;
  }

  const groups = new Map();
  for (const e of evs) {
    // un événement sur plusieurs jours déjà commencé apparaît aujourd'hui
    let k = evDayKey(e);
    if (k < localDateKey(new Date())) k = localDateKey(new Date());
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const todayKey = localDateKey(new Date());
  let shown = 0;
  for (const [k, list] of groups) {
    if (shown > 400) break;
    shown += list.length;
    html += `<section class="day"><h2 class="${k === todayKey ? 'today' : ''}">${esc(dayLabel(k))}<em>${relDays(k)}</em></h2><div class="card">`;
    for (const e of list) html += eventRow(e, now);
    html += `</div></section>`;
  }
  return html;
}

function viewSources() {
  const srcs = S.config.sources || [];
  const busy = Object.keys(S.syncing).length > 0;
  let html = '';

  // 1. Entrées : calendriers liés
  html += `<div class="section-head"><div class="section-title">Calendriers liés${srcs.length ? ` <span class="count-pill">${srcs.length}</span>` : ''}</div>
    <div class="head-btns">
      <button class="iconbtn sm" data-act="add-source" aria-label="Ajouter un calendrier" title="Ajouter un calendrier"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    </div></div>`;
  if (!srcs.length) {
    html += `<div class="card"><button class="row" data-act="add-source"><div class="grow"><div class="name">Coller un lien de calendrier</div><div class="info">Sync2Cal, Google Agenda, club de sport, billetterie…</div></div>${ICON.chev}</button></div>`;
  } else {
    html += `<div class="card">${srcs.map((s) => {
      const r = S.remote.sources?.[s.id];
      let info, cls = '';
      if (S.syncing[s.id]) info = 'Synchronisation en cours…';
      else if (s.enabled === false) info = 'Masqué';
      else if (!r) info = 'Pas encore synchronisé';
      else if (r.error) { info = `Erreur : ${r.error}`; cls = 'err'; }
      else info = `${r.events.length} événement${r.events.length > 1 ? 's' : ''}`;
      const sc = catById(s.category);
      if (sc && !S.syncing[s.id]) info = `${sc.name} · ${info}`;
      return `<button class="row" data-src="${esc(s.id)}"><span class="dot" style="background:${esc(sc ? sc.color : 'var(--faint)')};width:12px;height:12px"></span>
        <div class="grow"><div class="name">${esc(s.name)}</div><div class="info ${cls}">${esc(info)}</div></div>${ICON.chev}</button>`;
    }).join('')}</div>`;
  }

  // Sorties musicales : artistes suivis (API iTunes)
  const artists = S.config.artists || [];
  const music = S.remote.sources?.[MUSIC_SOURCE_ID];
  html += `<div class="section-head"><div class="section-title">Artistes suivis${artists.length ? ` <span class="count-pill">${artists.length}</span>` : ''}</div>
    <div class="head-btns"><button class="iconbtn sm" data-act="add-artist" aria-label="Suivre un artiste" title="Suivre un artiste"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div></div>`;
  if (!artists.length) {
    html += `<div class="card"><button class="row" data-act="add-artist"><div class="grow"><div class="name">Suivre un artiste</div><div class="info">Ses sorties (albums, EP, singles, précommandes) arrivent dans Radar</div></div>${ICON.chev}</button></div>`;
  } else {
    html += `<div class="card">${artists.map((a) => {
      const n = (music?.events || []).filter((e) => e.artistId === a.id).length;
      return `<button class="row" data-artist="${esc(String(a.id))}"><span class="dot" style="background:${esc(catById(S.config.musicCategory || 'musique')?.color || 'var(--faint)')};width:12px;height:12px"></span>
        <div class="grow"><div class="name">${esc(a.name)}</div><div class="info">${S.syncing[MUSIC_SOURCE_ID] ? 'Recherche des sorties…' : `${n} sortie${n > 1 ? 's' : ''} à venir ou récente${n > 1 ? 's' : ''}`}</div></div>${ICON.chev}</button>`;
    }).join('')}</div>`;
  }

  // Suggestions : calendriers vérifiés, ajout en un appui
  const have = (u) => srcs.some((x) => sameFeed(x.url, u));
  const groups = SUGGESTIONS.map((g) => ({ ...g, items: g.items.filter(([, u]) => !have(u)) })).filter((g) => g.items.length);
  if (groups.length) {
    html += `<div class="section-title">Suggestions</div>`;
    for (const g of groups) {
      const c = catById(suggestCat(g.cat));
      html += `<div class="sugg-group">${esc(g.group)}</div><div class="card">${g.items.map(([name, u]) => `
        <div class="row"><span class="dot" style="background:${esc(c ? c.color : 'var(--faint)')};width:10px;height:10px"></span>
          <div class="grow"><div class="name">${esc(name)}</div><div class="info">${esc(new URL(u).hostname.replace(/^www\./, ''))}</div></div>
          <button class="iconbtn sm" data-suggest="${esc(u)}" data-sname="${esc(name)}" data-scat="${esc(g.cat)}" aria-label="Ajouter ${esc(name)}" title="Ajouter"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>`).join('')}</div>`;
    }
  }
  return html;
}

function viewSettings() {
  const url = S.icsUrl;
  let html = '';
  // Organisation : rubriques
  const all = allEvents();
  html += `<div class="section-head"><div class="section-title">Rubriques <span class="count-pill">${cats().length}</span></div>
    <div class="head-btns"><button class="iconbtn sm" data-act="add-cat" aria-label="Nouvelle rubrique" title="Nouvelle rubrique"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div></div>
    <div class="card">${cats().map((c) => {
    const n = all.filter((e) => e.category === c.id).length;
    return `<button class="row" data-catedit="${esc(c.id)}"><span class="dot" style="background:${esc(c.color)};width:12px;height:12px"></span>
      <div class="grow"><div class="name">${esc(c.name)}</div><div class="info">${n} événement${n > 1 ? 's' : ''}</div></div>${ICON.chev}</button>`;
  }).join('')}</div>`;

  // Publication : Google Agenda et lien
  html += `<div class="section-title">Publication</div>
    <div class="card"><div class="row"><div class="grow"><div class="name">Google Agenda</div></div>
      <span class="badge-ok"><i></i>Connecté</span></div>
    <label class="field"><span>Nom du calendrier</span><input id="calname" value="${esc(S.config.calendarName || 'Radar')}" maxlength="60"></label></div>
    <div class="card"><div class="field"><span>URL de l'agenda</span>
      <div class="url-line"><div class="url-text" id="icsurl">${esc(url || 'Lien disponible après la première synchro…')}</div>
      <button class="iconbtn sm" data-act="copy" aria-label="Copier le lien" title="Copier le lien">${ICON.copy}</button></div></div></div>`;

  // Compte
  html += `<div class="section-title">Compte</div><div class="card">
    <button class="row" data-act="sync-token"><div class="grow"><div class="name">Synchro immédiate</div><div class="info">${S.syncToken ? 'Activée' : 'Désactivée'}</div></div>${ICON.chev}</button>
    <button class="row" data-act="logout"><div class="grow"><div class="name" style="color:var(--danger)">Déconnecter cet appareil</div><div class="info">Tes données restent dans ton Gist GitHub.</div></div></button>
  </div>
  <p class="note">Données : <a href="https://gist.github.com/${esc(S.gistId)}" target="_blank" rel="noopener">Gist secret</a>.</p>`;
  return html;
}

function viewSetup() {
  return `<div class="hero">${ICON.radar}<h1>Radar</h1><p>Tous tes événements à venir réunis dans un seul agenda, suivi depuis Google Agenda et ton iPhone.</p></div>
  <div class="section-title">Connexion (une seule fois)</div>
  <ol class="steps card">
    <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=Radar" target="_blank" rel="noopener">Créer un jeton GitHub</a> : laisse uniquement la case <b>gist</b> cochée, choisis « No expiration », puis « Generate token ».</li>
    <li>Copie le jeton (il commence par <b>ghp_</b>) et colle-le ci-dessous.</li>
  </ol>
  <div class="card" style="margin-top:12px"><label class="field"><span>Jeton GitHub</span>
    <input id="tok" type="password" placeholder="ghp_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>
  <div class="err-msg" id="setup-err" hidden></div>
  <div class="btns"><button class="btn" id="connect">Connecter</button></div>
  <p class="note">Le jeton reste sur cet appareil. Tes données sont stockées dans un Gist secret de ton compte GitHub. Sur iPhone, fais cette étape <b>depuis l'app ajoutée à l'écran d'accueil</b> (Partager › Sur l'écran d'accueil).</p>`;
}

/* ================= Interactions ================= */
function bindSetup() {
  $('#connect').onclick = async () => {
    const tok = $('#tok').value.trim();
    const errEl = $('#setup-err');
    if (!tok) return;
    const btn = $('#connect'); btn.disabled = true; btn.textContent = 'Connexion…'; errEl.hidden = true;
    try {
      let id = await findGist(tok);
      if (!id) {
        const cfg = emptyConfig(), rem = emptyRemote();
        const g = await createGist(tok, { 'config.json': cfg, 'remote.json': rem, 'radar.ics': buildICS(cfg, rem), 'google.json': googlePayload(cfg, rem) });
        id = g.id;
      }
      S.token = tok; S.gistId = id; LS.set('token', tok); LS.set('gistId', id);
      await load();
      toast('Connecté ✓');
    } catch (err) {
      errEl.textContent = err.status === 401 ? 'Jeton refusé : vérifie qu’il est complet et que la case « gist » est cochée.' : err.message;
      errEl.hidden = false; btn.disabled = false; btn.textContent = 'Connecter';
    }
  };
}

function bindView() {
  const q = $('#q');
  if (q) q.oninput = () => { S.query = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  const cn = $('#calname');
  if (cn) cn.onchange = () => { const v = cn.value.trim() || 'Radar'; mutate((c) => { c.calendarName = v; }, 'Nom mis à jour'); };
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-ev],[data-src],[data-filter],[data-tab],[data-catedit],[data-suggest],[data-artist]');
  if (!t) return;
  if (t.dataset.tab) { goTab(t.dataset.tab); return; }
  if (t.dataset.catedit) { openCatForm(catById(t.dataset.catedit)); return; }
  if (t.dataset.suggest) {
    t.disabled = true; t.classList.add('spin');
    addSource({ name: t.dataset.sname, url: t.dataset.suggest, category: suggestCat(t.dataset.scat) }).then((r) => { if (r?.error) toast(r.error, 4000); });
    return;
  }
  if (t.dataset.artist) { const a = (S.config.artists || []).find((x) => String(x.id) === t.dataset.artist); if (a) openArtist(a); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); return; }
  if (t.dataset.ev) { const ev = allEvents().find((x) => x.icsUid === t.dataset.ev); if (ev) openDetail(ev); return; }
  if (t.dataset.src) { const s = S.config.sources.find((x) => x.id === t.dataset.src); if (s) openSourceForm(s); return; }
  const a = t.dataset.act;
  if (a === 'reload') load();
  else if (a === 'refresh-all') {
    // deux actions : relire l'agenda tout de suite, puis relire chaque calendrier lié (synchro GitHub)
    load();
    const ids = (S.config.sources || []).filter((x) => x.enabled !== false).map((x) => x.id);
    if (ids.length) syncNow(ids);
  }
  else if (a === 'sync-all') syncNow((S.config.sources || []).filter((s) => s.enabled !== false).map((s) => s.id));
  else if (a === 'sync-token') openSyncTokenSheet();
  else if (a === 'add-cat') openCatForm();
  else if (a === 'add-artist') openArtistSearch();
  else if (a === 'add') openAddMenu();
  else if (a === 'add-source') openSourceForm();
  else if (a === 'add-manual') openEventForm();
  else if (a === 'copy') copyUrl();
  else if (a === 'gcal') { const w = window.open('https://calendar.google.com/calendar/u/0/r/settings/addbyurl', '_blank', 'noopener'); copyUrl(true); if (!w) location.href = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl'; }
  else if (a === 'logout') logout();
});
$('#fab').onclick = () => openAddMenu();

/* Onglets dans l'ordre du menu : flèches ← → du clavier, ou glissement du doigt vers la gauche / la droite. */
const TABS = ['home', 'agenda', 'sources', 'settings'];
function goTab(tab) {
  if (!TABS.includes(tab) || tab === S.tab) return;
  const swap = () => { S.tab = tab; LS.set('tab', tab); closeSheet(); render(); window.scrollTo(0, 0); };
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
  // la feuille ne porte son nom de transition que le temps du passage (comme dans Fantôme)
  const app = $('#app');
  app.style.viewTransitionName = 'feuille';
  document.startViewTransition(swap).finished.finally(() => (app.style.viewTransitionName = ''));
}
function stepTab(dir) {
  if (!(S.token && S.gistId) || !$('#sheet').hidden) return;
  const i = TABS.indexOf(S.tab) + dir;
  if (i >= 0 && i < TABS.length) goTab(TABS[i]);
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  stepTab(e.key === 'ArrowRight' ? 1 : -1);
});
let swipe = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  swipe = e.touches.length === 1 && !e.target.closest('.chips, input, textarea, .sheet') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (Date.now() - swipe.at < 600 && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) stepTab(dx < 0 ? 1 : -1);
  swipe = null;
}, { passive: true });
$('#scrim').onclick = () => closeSheet();

async function copyUrl(forGoogle = false) {
  if (!S.icsUrl) return;
  try { await navigator.clipboard.writeText(S.icsUrl); toast(forGoogle ? 'Lien copié : colle-le dans Google Agenda, puis « Ajouter un agenda »' : 'Lien copié', forGoogle ? 6000 : 2600); }
  catch { const r = document.createRange(); r.selectNodeContents($('#icsurl')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Lien sélectionné : copie-le'); }
}
function logout() {
  if (!confirm('Déconnecter Radar de cet appareil ?')) return;
  ['token', 'gistId', 'config', 'remote', 'icsUrl', 'lastLoad', 'dirty', 'syncToken'].forEach(LS.del);
  Object.assign(S, { syncToken: null, syncing: {}, token: null, gistId: null, config: emptyConfig(), remote: emptyRemote(), icsUrl: null, lastLoad: null, tab: 'home' });
  render();
}

/* ---------- Feuilles ---------- */
function openSheet(html, onMount, { page = false } = {}) {
  const sh = $('#sheet');
  sh.classList.toggle('page', page);
  sh.innerHTML = `${page ? '' : '<div class="grab"></div>'}${html}`;
  if (page) { const back = sh.querySelector('.sheet-head [data-close]'); if (back) back.innerHTML = '‹ Retour'; }
  sh.hidden = false; $('#scrim').hidden = page; document.body.style.overflow = 'hidden';
  sh.scrollTop = 0;
  onMount && onMount(sh);
}
/** Fiche ouverte depuis une ligne à flèche : une page qui glisse depuis la droite, avec « ‹ Retour ». */
const openPage = (html, onMount) => openSheet(html, onMount, { page: true });
function closeSheet() {
  $('#sheet').hidden = true; $('#scrim').hidden = true; document.body.style.overflow = '';
}

function openAddMenu() {
  openSheet(`<div class="sheet-head"><h3>Ajouter à Radar</h3><button data-close>Fermer</button></div>
    <div class="card">
      <button class="choice" data-c="manual"><span class="ic">${ICON.pen}</span><span><b>Saisir un événement</b><small>Titre, date, lieu…</small></span></button>
      <button class="choice" disabled><span class="ic">${ICON.camera}</span><span><b>Depuis une capture d'écran<span class="badge">BIENTÔT</span></b><small>Extraire l'événement d'une image</small></span></button>
    </div>`, (sh) => {
    sh.querySelector('[data-close]').onclick = closeSheet;
    sh.querySelector('[data-c="manual"]').onclick = () => openEventForm();
  });
}

function openEventForm(existing) {
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  let sDate, sTime, eDate, eTime, allDay = false;
  if (existing) {
    allDay = existing.allDay;
    if (allDay) {
      sDate = existing.start; const endIncl = new Date(keyToDate(existing.end || existing.start).getTime() - (existing.end > existing.start ? 864e5 : 0));
      eDate = localDateKey(endIncl); sTime = '20:00'; eTime = '21:00';
    } else {
      const s = new Date(existing.start), e = new Date(existing.end || existing.start);
      sDate = localDateKey(s); sTime = localTime(s); eDate = localDateKey(e); eTime = localTime(e);
    }
  } else {
    const end = new Date(now.getTime() + 36e5);
    sDate = localDateKey(now); sTime = localTime(now); eDate = localDateKey(end); eTime = localTime(end);
  }
  const v = existing || {};
  openSheet(`<div class="sheet-head"><button data-close>Annuler</button><h3>${existing ? 'Modifier' : 'Nouvel événement'}</h3><button data-save><b>${existing ? 'OK' : 'Ajouter'}</b></button></div>
    <div class="card">
      <label class="field"><span>Titre</span><input name="title" value="${esc(v.title)}" placeholder="Concert, match, expo…" enterkeyhint="done"></label>
      <label class="field"><span>Lieu</span><input name="location" value="${esc(v.location)}" placeholder="Facultatif"></label>
      <div class="field"><span>Rubrique</span>${catPicker(v.category || (S.filter !== 'all' && S.filter !== 'none' ? S.filter : null))}</div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="toggle"><span>Toute la journée</span><label class="switch"><input type="checkbox" name="allDay" ${allDay ? 'checked' : ''}><i></i></label></div>
      <div class="pair"><label class="field"><span>Début</span><input type="date" name="sDate" value="${sDate}"></label><label class="field" data-t><span>Heure</span><input type="time" name="sTime" value="${sTime}"></label></div>
      <div class="pair"><label class="field"><span>Fin</span><input type="date" name="eDate" value="${eDate}"></label><label class="field" data-t><span>Heure</span><input type="time" name="eTime" value="${eTime}"></label></div>
    </div>
    <div class="card" style="margin-top:12px">
      <label class="field"><span>Lien</span><input name="url" type="url" value="${esc(v.url)}" placeholder="Billetterie, page de l'événement…" autocapitalize="off"></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3">${esc(v.notes)}</textarea></label>
    </div>
    <div class="err-msg" data-err hidden></div>
    ${existing ? `<div class="btns"><button class="btn danger" data-del>Supprimer l'événement</button></div>` : ''}`, (sh) => {
    const f = (n) => sh.querySelector(`[name="${n}"]`);
    let category = v.category || (S.filter !== 'all' && S.filter !== 'none' ? S.filter : null);
    bindCatPicker(sh, (id) => (category = id));
    const syncAllDay = () => sh.querySelectorAll('[data-t]').forEach((el) => (el.style.visibility = f('allDay').checked ? 'hidden' : 'visible'));
    syncAllDay();
    f('allDay').onchange = syncAllDay;
    let lastS = f('sDate').value;
    f('sDate').onchange = () => { // décale la fin avec le début
      const delta = keyToDate(f('sDate').value) - keyToDate(lastS);
      if (f('eDate').value && !isNaN(delta)) f('eDate').value = localDateKey(new Date(keyToDate(f('eDate').value).getTime() + delta));
      lastS = f('sDate').value;
    };
    f('sTime').onchange = () => {
      const [h, m] = f('sTime').value.split(':').map(Number);
      if (f('sDate').value === f('eDate').value) f('eTime').value = `${pad(Math.min(23, h + 1))}:${pad(m)}`;
    };
    if (!existing) setTimeout(() => f('title').focus(), 300);
    sh.querySelector('[data-close]').onclick = closeSheet;
    sh.querySelector('[data-save]').onclick = () => {
      const err = sh.querySelector('[data-err]');
      const title = f('title').value.trim();
      if (!title) { err.textContent = 'Donne un titre à l’événement.'; err.hidden = false; return; }
      if (!f('sDate').value) { err.textContent = 'Choisis une date.'; err.hidden = false; return; }
      const ad = f('allDay').checked;
      let start, end;
      if (ad) {
        start = f('sDate').value;
        const lastDay = f('eDate').value && f('eDate').value >= start ? f('eDate').value : start;
        end = localDateKey(new Date(keyToDate(lastDay).getTime() + 864e5 + 3 * 36e5)); // +1 j (exclusif), +3 h pour franchir un éventuel changement d'heure
      } else {
        const s = new Date(`${f('sDate').value}T${f('sTime').value || '00:00'}`);
        let e = new Date(`${f('eDate').value || f('sDate').value}T${f('eTime').value || f('sTime').value || '00:00'}`);
        if (!(e > s)) e = new Date(s.getTime() + 36e5);
        start = s.toISOString(); end = e.toISOString();
      }
      const rec = {
        id: existing ? existing.id : uid(), title, start, end, allDay: ad, origin: existing?.origin || 'manual', category: category || undefined,
        location: f('location').value.trim() || undefined, url: f('url').value.trim() || undefined, notes: f('notes').value.trim() || undefined,
        createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      closeSheet();
      mutate((c) => {
        c.manual = (c.manual || []).filter((m) => m.id !== rec.id);
        c.manual.push(rec);
      }, existing ? 'Événement modifié' : 'Ajouté au radar ✓');
      if (S.tab !== 'agenda' && S.tab !== 'home') { S.tab = 'agenda'; LS.set('tab', 'agenda'); render(); }
    };
    const del = sh.querySelector('[data-del]');
    if (del) del.onclick = () => {
      if (!confirm('Supprimer cet événement ?')) return;
      closeSheet();
      mutate((c) => { c.manual = (c.manual || []).filter((m) => m.id !== existing.id); }, 'Événement supprimé');
    };
  });
}

function openDetail(ev) {
  const rows = [
    whereOf(ev) && `<div class="kv"><span>${ev.tv ? 'Diffusion' : 'Où le voir'}</span><div>${esc(whereOf(ev))}</div></div>`,
    ev.location && `<div class="kv"><span>Lieu</span><div><a href="https://maps.apple.com/?q=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener">${esc(ev.location)}</a></div></div>`,
    ev.url && /^https?:\/\//i.test(ev.url) && `<div class="kv"><span>Lien</span><div><a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.url.replace(/^https?:\/\//, ''))}</a></div></div>`,
    ev.notes && `<div class="kv"><span>Notes</span><div>${esc(ev.notes)}</div></div>`,
    `<div class="kv"><span>Rubrique</span>${catPicker(ev.category)}</div>`,
  ].filter(Boolean).join('');
  openSheet(`<div class="sheet-head"><span></span><button data-close>Fermer</button></div>
    <div class="detail"><h3>${esc(ev.title)}</h3><div class="when">${esc(whenText(ev))}</div></div>
    <div class="card">${rows}</div>
    <div class="btns">${ev.origin === 'feed'
      ? `<button class="btn ghost" data-hide>Masquer de Radar</button>`
      : `<button class="btn ghost" data-edit>${ICON.pen} Modifier</button>`}</div>`, (sh) => {
    sh.querySelector('[data-close]').onclick = closeSheet;
    bindCatPicker(sh, (id) => {
      if (ev.origin === 'feed') {
        const src = S.config.sources.find((x) => x.id === ev.sourceId);
        mutate((c) => {
          c.eventCategories = { ...(c.eventCategories || {}) };
          if ((id || null) === (src?.category || null)) delete c.eventCategories[ev.icsUid]; else c.eventCategories[ev.icsUid] = id;
        }, 'Rubrique mise à jour');
      } else {
        mutate((c) => { const m = (c.manual || []).find((x) => x.id === ev.id); if (m) m.category = id || undefined; }, 'Rubrique mise à jour');
      }
    });
    const ed = sh.querySelector('[data-edit]');
    if (ed) ed.onclick = () => openEventForm(S.config.manual.find((m) => m.id === ev.id));
    const hd = sh.querySelector('[data-hide]');
    if (hd) hd.onclick = () => { closeSheet(); mutate((c) => { c.hidden = [...new Set([...(c.hidden || []), ev.icsUid])]; }, 'Événement masqué'); };
  });
}

function openSourceForm(existing) {
  let category = existing ? existing.category || null : null;
  (existing ? openPage : openSheet)(`<div class="sheet-head"><button data-close>Annuler</button><h3>${existing ? 'Calendrier' : 'Lier un calendrier'}</h3><button data-save><b>${existing ? 'OK' : 'Ajouter'}</b></button></div>
    <div class="card">
      <label class="field"><span>Lien du calendrier (.ics ou webcal://)</span><input name="url" type="url" value="${esc(existing?.url)}" placeholder="https://…/calendar.ics" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Nom</span><input name="name" value="${esc(existing?.name)}" placeholder="Ex. : Ligue 1, Concerts…"></label>
      <div class="field"><span>Rubrique</span>${catPicker(category)}</div>
      <div class="toggle"><span>Traduire en français</span><label class="switch"><input type="checkbox" name="translate" ${existing?.translate === false ? '' : 'checked'}><i></i></label></div>
      ${existing ? `<div class="toggle"><span>Afficher dans Radar</span><label class="switch"><input type="checkbox" name="enabled" ${existing.enabled !== false ? 'checked' : ''}><i></i></label></div>` : ''}
    </div>
    <div class="err-msg" data-err hidden></div>
    ${existing ? `<div class="btns"><button class="btn danger" data-del>Retirer ce calendrier</button></div>` : ''}`, (sh) => {
    const f = (n) => sh.querySelector(`[name="${n}"]`);
    bindCatPicker(sh, (id) => (category = id));
    if (!existing) setTimeout(() => f('url').focus(), 300);
    sh.querySelector('[data-close]').onclick = closeSheet;
    sh.querySelector('[data-save]').onclick = async () => {
      const err = sh.querySelector('[data-err]');
      const raw = f('url').value.trim();
      if (!raw || !/\./.test(raw)) { err.textContent = 'Colle le lien du calendrier.'; err.hidden = false; return; }
      const url = normalizeUrl(raw);
      let name = f('name').value.trim();
      if (existing) {
        const enabled = f('enabled').checked;
        const translate = f('translate').checked;
        closeSheet();
        await mutate((c) => { const s = c.sources.find((x) => x.id === existing.id); if (s) Object.assign(s, { url, name: name || s.name, category: category || undefined, enabled, translate }); }, url === existing.url ? 'Calendrier mis à jour' : null);
        if (url !== existing.url && enabled) syncNow([existing.id]);
        return;
      }
      const btn = sh.querySelector('[data-save]'); btn.innerHTML = '…'; btn.disabled = true;
      const res = await addSource({ name, url, category, translate: f('translate').checked });
      if (res && res.error) { err.textContent = res.error; err.hidden = false; btn.innerHTML = '<b>Ajouter</b>'; btn.disabled = false; return; }
      closeSheet();
    };
    const del = sh.querySelector('[data-del]');
    if (del) del.onclick = () => {
      if (!confirm(`Retirer « ${existing.name} » de Radar ?`)) return;
      closeSheet();
      mutate((c) => { c.sources = c.sources.filter((s) => s.id !== existing.id); }, 'Calendrier retiré');
    };
  });
}

function openCatForm(existing) {
  const used = new Set(cats().map((c) => c.color));
  let color = existing?.color || COLORS.find((c) => !used.has(c)) || COLORS[0];
  let icon = existing ? artOf(existing) : 'etoile';
  (existing ? openPage : openSheet)(`<div class="sheet-head"><button data-close>Annuler</button><h3>${existing ? 'Rubrique' : 'Nouvelle rubrique'}</h3><button data-save><b>${existing ? 'OK' : 'Ajouter'}</b></button></div>
    <div class="card">
      <label class="field"><span>Nom</span><input name="name" value="${esc(existing?.name)}" placeholder="Ex. : Concert, Expo…" maxlength="30"></label>
      <div class="field"><span>Couleur</span><div class="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" class="${c === color ? 'on' : ''}" style="background:${c};color:${c}" aria-label="Couleur"></button>`).join('')}</div></div>
      <div class="field"><span>Illustration</span><div class="art-picker">${Object.entries(ART).map(([k, a]) => `<button type="button" data-icon="${k}" class="${k === icon ? 'on' : ''}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${artSvg(k, 'mini')}</button>`).join('')}</div></div>
    </div>
    <div class="err-msg" data-err hidden></div>
    ${existing ? `<div class="btns"><button class="btn danger" data-del>Supprimer la rubrique</button></div><p class="note">Ses événements resteront dans Radar, sans rubrique.</p>` : ''}`, (sh) => {
    const name = sh.querySelector('[name="name"]');
    sh.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => {
      color = b.dataset.color; sh.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    sh.querySelectorAll('[data-icon]').forEach((b) => (b.onclick = () => {
      icon = b.dataset.icon; sh.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    if (!existing) setTimeout(() => name.focus(), 300);
    sh.querySelector('[data-close]').onclick = closeSheet;
    sh.querySelector('[data-save]').onclick = () => {
      const n = name.value.trim();
      const err = sh.querySelector('[data-err]');
      if (!n) { err.textContent = 'Donne un nom à la rubrique.'; err.hidden = false; return; }
      if (cats().some((c) => c.name.toLowerCase() === n.toLowerCase() && c.id !== existing?.id)) { err.textContent = 'Cette rubrique existe déjà.'; err.hidden = false; return; }
      closeSheet();
      mutate((c) => {
        c.categories = categoriesOf(c).map((x) => ({ ...x }));
        if (existing) { const x = c.categories.find((k) => k.id === existing.id); if (x) Object.assign(x, { name: n, color, icon }); }
        else c.categories.push({ id: uid(), name: n, color, icon });
      }, existing ? 'Rubrique mise à jour' : 'Rubrique ajoutée');
    };
    const del = sh.querySelector('[data-del]');
    if (del) del.onclick = () => {
      if (!confirm(`Supprimer la rubrique « ${existing.name} » ?`)) return;
      closeSheet();
      if (S.filter === existing.id) S.filter = 'all';
      mutate((c) => {
        c.categories = categoriesOf(c).filter((k) => k.id !== existing.id);
        (c.sources || []).forEach((s) => { if (s.category === existing.id) delete s.category; });
        (c.manual || []).forEach((m) => { if (m.category === existing.id) delete m.category; });
        for (const [k, v] of Object.entries(c.eventCategories || {})) if (v === existing.id) delete c.eventCategories[k];
      }, 'Rubrique supprimée');
    };
  });
}

/* ---------- Artistes suivis (sorties musicales) ---------- */
async function refreshMusic(artists) {
  S.syncing[MUSIC_SOURCE_ID] = true; render();
  try {
    const r = await musicReleases((u) => fetch(u), artists);
    const g = await readGist(S.token, S.gistId);
    const remote = g.remote || emptyRemote();
    remote.sources = remote.sources || {};
    remote.sources[MUSIC_SOURCE_ID] = { fetchedAt: new Date().toISOString(), calName: 'Sorties musique', error: r.error, events: r.events, via: 'app' };
    const cfg = { ...emptyConfig(), ...(g.config || {}) };
    await writeGist(S.token, S.gistId, { 'remote.json': remote, 'radar.ics': buildICS(cfg, remote), 'google.json': googlePayload(cfg, remote) });
    S.remote = remote; S.config = cfg; persist();
    return r.events.length;
  } finally { delete S.syncing[MUSIC_SOURCE_ID]; render(); }
}

function openArtistSearch() {
  openSheet(`<div class="sheet-head"><button data-close>Annuler</button><h3>Suivre un artiste</h3><span style="width:56px"></span></div>
    <label class="search">${ICON.search}<input name="q" type="search" placeholder="Nom de l'artiste (ex. Ninho)" autocomplete="off" enterkeyhint="search"></label>
    <div class="card" data-results style="margin-top:8px"></div>
    <p class="note" style="margin-top:8px">Données Apple Music (iTunes), France.</p>`, (sh) => {
    sh.querySelector('[data-close]').onclick = closeSheet;
    const q = sh.querySelector('[name="q"]'), box = sh.querySelector('[data-results]');
    let timer;
    q.oninput = () => {
      clearTimeout(timer);
      const term = q.value.trim();
      if (term.length < 2) { box.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        try {
          const list = await searchArtists((u) => fetch(u), term);
          if (q.value.trim() !== term) return;
          const followed = new Set((S.config.artists || []).map((a) => String(a.id)));
          box.innerHTML = list.length ? list.map((a) => `<button class="row" data-pick="${a.id}" data-pname="${esc(a.name)}" ${followed.has(String(a.id)) ? 'disabled' : ''}>
            ${a.latest?.art ? `<img class="cover" src="${esc(a.latest.art)}" alt="" loading="lazy">` : '<span class="cover"></span>'}
            <div class="grow"><div class="name">${esc(a.name)}</div>
              <div class="info">${a.latest ? `Dernière sortie : ${esc(a.latest.name)} (${esc(a.latest.date.slice(0, 4))})` : 'Aucune sortie'}</div>
              <div class="info">${a.count} sortie${a.count > 1 ? 's' : ''} · ${esc(a.genre)}${followed.has(String(a.id)) ? ' · déjà suivi' : ''}</div></div>
            <svg class="chev" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`).join('') : `<div class="row"><div class="grow"><div class="info">Aucun artiste trouvé.</div></div></div>`;
          box.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = async () => {
            const artist = { id: Number(b.dataset.pick), name: b.dataset.pname };
            closeSheet();
            if (S.tab !== 'sources') { S.tab = 'sources'; LS.set('tab', 'sources'); }
            await mutate((c) => {
              c.artists = [...(c.artists || []).filter((x) => x.id !== artist.id), artist];
              c.categories = categoriesOf(c).map((x) => ({ ...x }));
              if (!c.musicCategory) {
                const existing = c.categories.find((x) => /musi|rap/i.test(x.name));
                if (existing) c.musicCategory = existing.id;
                else { c.categories.push({ id: 'musique', name: 'Musique', color: '#0891B2', icon: 'musique' }); c.musicCategory = 'musique'; }
              }
            }, null);
            try { const n = await refreshMusic(S.config.artists); toast(`${artist.name} suivi ✓ · ${n} sortie${n > 1 ? 's' : ''} au total`); }
            catch (e) { toast(`${artist.name} suivi ; sorties récupérées à la prochaine synchro`, 4000); }
          }));
        } catch { box.innerHTML = `<div class="row"><div class="grow"><div class="info">Recherche impossible pour le moment.</div></div></div>`; }
      }, 300);
    };
    setTimeout(() => q.focus(), 300);
  });
}

function openArtist(a) {
  const evs = (S.remote.sources?.[MUSIC_SOURCE_ID]?.events || []).filter((e) => e.artistId === a.id);
  openPage(`<div class="sheet-head"><button data-close>Retour</button><h3>${esc(a.name)}</h3><span style="width:56px"></span></div>
    <div class="stack">
      <div class="section-title">Sorties à venir ou récentes</div>
      ${evs.length ? `<div class="card">${evs.map((e) => eventRow(e, Date.now(), true)).join('')}</div>` : `<p class="note">Aucune sortie annoncée pour le moment.</p>`}
      <div class="btns"><button class="btn danger" data-del>Ne plus suivre</button></div>
    </div>`, (sh) => {
    sh.querySelector('[data-close]').onclick = closeSheet;
    sh.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Ne plus suivre ${a.name} ?`)) return;
      closeSheet();
      await mutate((c) => { c.artists = (c.artists || []).filter((x) => x.id !== a.id); }, `${a.name} n'est plus suivi`);
      if ((S.config.artists || []).length) refreshMusic(S.config.artists).catch(() => {});
    };
  });
}

/* ================= Démarrage ================= */
render();
/** Au lancement (et au retour dans l'app après un moment) : agenda relu, puis calendriers liés relus, sans bruit. */
let lastAuto = 0;
async function autoSync() {
  if (!(S.token && S.gistId) || !S.syncToken || Date.now() - lastAuto < 10 * 6e4) return;
  lastAuto = Date.now();
  await load({ quiet: true });
  const ids = (S.config.sources || []).filter((x) => x.enabled !== false).map((x) => x.id);
  if (ids.length && !Object.keys(S.syncing).length) syncNow(ids, { silent: true });
}
load({ quiet: true }).then(autoSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!S.lastLoad || Date.now() - Date.parse(S.lastLoad) > 6e4) load({ quiet: true });
  autoSync();
});
setInterval(() => { if (document.visibilityState === 'visible' && (S.tab === 'agenda' || S.tab === 'home') && $('#sheet').hidden && document.activeElement?.id !== 'q') render(); }, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
