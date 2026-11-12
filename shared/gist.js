// Accès au Gist secret qui contient les données de Radar.
// Fichiers : config.json (sources + événements manuels, écrit par l'app),
//            remote.json (événements des flux, écrit par la synchro),
//            radar.ics   (calendrier fusionné, écrit par les deux).

export const GIST_DESCRIPTION = 'Radar — données (ne pas supprimer)';
const API = 'https://api.github.com';

async function gh(token, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const msg = res.status === 401 ? 'Jeton GitHub refusé (expiré ou incorrect).'
      : res.status === 404 ? 'Gist introuvable avec ce jeton.'
      : `GitHub a répondu ${res.status}.`;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function fileContent(f) {
  if (!f) return null;
  if (!f.truncated) return f.content;
  const r = await fetch(f.raw_url, { cache: 'no-store' });
  return r.text();
}

export async function findGist(token) {
  for (let page = 1; page <= 10; page++) {
    const list = await gh(token, `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.description === GIST_DESCRIPTION);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return null;
}

export async function readGist(token, id) {
  const g = await gh(token, `/gists/${id}`);
  const [config, remote] = await Promise.all([fileContent(g.files['config.json']), fileContent(g.files['remote.json'])]);
  const ics = g.files['radar.ics'];
  return {
    id: g.id,
    owner: g.owner && g.owner.login,
    config: config ? JSON.parse(config) : null,
    remote: remote ? JSON.parse(remote) : null,
    icsRawUrl: g.owner ? `https://gist.githubusercontent.com/${g.owner.login}/${g.id}/raw/radar.ics` : (ics && ics.raw_url),
  };
}

export async function writeGist(token, id, files) {
  const payload = {};
  for (const [name, content] of Object.entries(files)) {
    payload[name] = { content: typeof content === 'string' ? content : JSON.stringify(content, null, 1) };
  }
  return gh(token, `/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files: payload }) });
}

export async function createGist(token, files) {
  const payload = {};
  for (const [name, content] of Object.entries(files)) {
    payload[name] = { content: typeof content === 'string' ? content : JSON.stringify(content, null, 1) };
  }
  return gh(token, '/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: payload }) });
}

/** Lance tout de suite la synchro GitHub Actions (jeton avec le droit « Actions : écriture » sur le dépôt). */
export const SYNC_REPO = 'pierrestang/radar';
export async function dispatchSync(token, repo = SYNC_REPO) {
  return gh(token, `/repos/${repo}/actions/workflows/sync.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
}
