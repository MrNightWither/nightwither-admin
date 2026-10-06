'use strict';

// Die Firebase Config ist NICHT geheim. Geschützt wird alles über Login + Firestore Regeln.
const firebaseConfig = {
  apiKey: "AIzaSyCGZTtokmCpu9CTDRWOi5HHO4CGO-BZgGU",
  authDomain: "adminpannel-f0aab.firebaseapp.com",
  projectId: "adminpannel-f0aab",
  storageBucket: "adminpannel-f0aab.firebasestorage.app",
  messagingSenderId: "373454919812",
  appId: "1:373454919812:web:281bd757fb982bb24f4ad1"
};

// Deine UID aus Firebase Authentication. Nur für die Anzeige,
// die echte Sperre sitzt in den Firestore Regeln.
const ADMIN_UID = "6DlcOUvr9qhNWgWWRtnrIQriQoi2";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const $ = (id) => document.getElementById(id);
const EVENT_TYPES = ['tournament', 'verlosung', 'community', 'stream', 'challenge', 'sonstiges'];

// ---------- Anmeldung ----------
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});

const provider = new firebase.auth.GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

$('googleLoginBtn').addEventListener('click', async () => {
  $('loginError').textContent = '';
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked') {
      $('loginError').textContent = 'Popup wurde blockiert. Bitte Popups für diese Seite erlauben.';
    } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      console.error(err);
      $('loginError').textContent = 'Anmeldung fehlgeschlagen.';
    }
  }
});

$('logoutBtn').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged((user) => {
  if (user && user.uid === ADMIN_UID) {
    $('loginScreen').style.display = 'none';
    $('adminPanel').style.display = 'block';
    loadEvents();
    loadStreams();
    loadStats();
    loadPartners();
    loadSecretsState();
    liveStandLaden();
  } else {
    if (user) {
      const uid = user.uid;
      auth.signOut();
      // Die UID ist nicht geheim. Sie wird angezeigt, damit du sie beim ersten Google Login eintragen kannst.
      $('loginError').textContent = 'Kein Zugriff. UID: ' + uid;
    }
    $('adminPanel').style.display = 'none';
    $('loginScreen').style.display = 'flex';
    $('eventsList').replaceChildren();
    $('streamList').replaceChildren();
    $('partnerList').replaceChildren();
  }
});

// ---------- Hilfsfunktionen ----------
function showStatus(elementId, message, type) {
  const el = $(elementId);
  el.textContent = message;
  el.className = 'status-message ' + type;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function emptyNote(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

// Baut einen Listeneintrag nur mit textContent. Dadurch kann kein eingeschleuster Code ausgeführt werden.
function buildItem(titleText, metaText, onDelete) {
  const item = document.createElement('div');
  item.className = 'item';

  const info = document.createElement('div');
  info.className = 'item-info';
  const h4 = document.createElement('h4');
  h4.textContent = titleText;
  const p = document.createElement('p');
  p.textContent = metaText;
  info.append(h4, p);

  const btn = document.createElement('button');
  btn.className = 'delete-btn';
  btn.type = 'button';
  btn.textContent = 'Löschen';
  btn.addEventListener('click', onDelete);

  item.append(info, btn);
  return item;
}

function friendlyError(err) {
  return err && err.code === 'permission-denied' ? 'Keine Berechtigung.' : 'Speichern fehlgeschlagen.';
}

// ---------- Events ----------
$('addEventBtn').addEventListener('click', async () => {
  const title = $('eventTitle').value.trim();
  const type = $('eventType').value;
  const dateRaw = $('eventDate').value;
  if (!title || !dateRaw || !EVENT_TYPES.includes(type)) {
    showStatus('eventStatus', 'Bitte Titel, Typ und Datum ausfüllen.', 'error');
    return;
  }
  try {
    await db.collection('events').add({
      title: title.slice(0, 120),
      type: type,
      eventDate: new Date(dateRaw).toISOString(),
      prizePool: $('eventPrize').value.trim().slice(0, 120),
      description: $('eventDesc').value.trim().slice(0, 2000),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showStatus('eventStatus', '✓ Event erstellt', 'success');
    $('eventTitle').value = '';
    $('eventPrize').value = '';
    $('eventDesc').value = '';
    loadEvents();
  } catch (err) {
    console.error(err);
    showStatus('eventStatus', '✗ ' + friendlyError(err), 'error');
  }
});

async function loadEvents() {
  const list = $('eventsList');
  try {
    const snap = await db.collection('events').get();
    if (snap.empty) { list.replaceChildren(emptyNote('Keine Events')); return; }
    list.replaceChildren(...snap.docs.map((doc) => {
      const d = doc.data();
      const date = d.eventDate ? new Date(d.eventDate).toLocaleDateString('de-DE') : '';
      return buildItem(String(d.title || ''), String(d.type || '') + ' • ' + date, () => deleteDoc('events', doc.id, loadEvents));
    }));
  } catch (err) {
    console.error(err);
    list.replaceChildren(emptyNote('Events konnten nicht geladen werden.'));
  }
}

// ---------- Streaming Plan ----------
// Ein Stream gilt 6 Stunden nach Beginn als vorbei
const STREAM_KEEP_MS = 6 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatStreamDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'Ohne Datum';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' • ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Streamplan: Spiel + Plattform zum Antippen ----------
// Standard-Spiele + alles, was schon im Plan steht + eigene (in diesem Browser gespeichert).
const STANDARD_SPIELE = ['Warzone', 'The Coffin of Andy&Laylay', 'Find the Needle', 'Just Chatting'];
const PLATTFORMEN = ['Twitch', 'Kick', 'YouTube', 'TikTok'];
const EIGENE_SPIELE_KEY = 'nwu-admin-eigene-spiele';
let gewaehltesSpiel = '';
let gewaehltePlattformen = ['Twitch'];
let spieleAusPlan = [];

function eigeneSpiele() {
  try { return JSON.parse(localStorage.getItem(EIGENE_SPIELE_KEY) || '[]').filter((s) => typeof s === 'string'); } catch { return []; }
}
function eigeneSpieleSpeichern(liste) {
  try { localStorage.setItem(EIGENE_SPIELE_KEY, JSON.stringify(liste.slice(0, 40))); } catch { /* privater Modus – dann nur für jetzt */ }
}
function alleSpiele() {
  const gesehen = new Set(), liste = [];
  [...STANDARD_SPIELE, ...spieleAusPlan, ...eigeneSpiele()].forEach((s) => {
    const k = s.trim().toLowerCase();
    if (k && !gesehen.has(k)) { gesehen.add(k); liste.push(s.trim()); }
  });
  return liste;
}
function chip(text, an, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (an ? ' an' : '');
  b.textContent = text;
  b.setAttribute('aria-pressed', an ? 'true' : 'false');
  b.addEventListener('click', onClick);
  return b;
}
function spielWahlZeigen() {
  const eigene = eigeneSpiele().map((s) => s.toLowerCase());
  const plus = chip('+ Weiteres', false, () => { $('spielNeu').classList.toggle('hidden'); $('spielNeuText').focus(); });
  plus.classList.add('plus');
  $('spielWahl').replaceChildren(...alleSpiele().map((s) => {
    const b = chip(s, s === gewaehltesSpiel, () => { gewaehltesSpiel = s; spielWahlZeigen(); });
    if (eigene.includes(s.toLowerCase()) && !STANDARD_SPIELE.includes(s)) {
      const x = document.createElement('span');
      x.className = 'weg';
      x.textContent = '×';
      x.title = 'Aus der Liste entfernen';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        eigeneSpieleSpeichern(eigeneSpiele().filter((n) => n.toLowerCase() !== s.toLowerCase()));
        if (gewaehltesSpiel === s) gewaehltesSpiel = '';
        spielWahlZeigen();
      });
      b.appendChild(x);
    }
    return b;
  }), plus);
}
function plattformWahlZeigen() {
  $('plattformWahl').replaceChildren(...PLATTFORMEN.map((p) => chip(p, gewaehltePlattformen.includes(p), () => {
    gewaehltePlattformen = gewaehltePlattformen.includes(p)
      ? gewaehltePlattformen.filter((x) => x !== p)
      : PLATTFORMEN.filter((x) => x === p || gewaehltePlattformen.includes(x));
    plattformWahlZeigen();
  })));
}
function spielHinzufuegen() {
  const neu = $('spielNeuText').value.trim().slice(0, 80);
  if (!neu) return;
  if (!alleSpiele().some((s) => s.toLowerCase() === neu.toLowerCase())) eigeneSpieleSpeichern([...eigeneSpiele(), neu]);
  gewaehltesSpiel = alleSpiele().find((s) => s.toLowerCase() === neu.toLowerCase()) || neu;
  $('spielNeuText').value = '';
  $('spielNeu').classList.add('hidden');
  spielWahlZeigen();
}
$('spielNeuOk').addEventListener('click', spielHinzufuegen);
$('spielNeuText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); spielHinzufuegen(); } });
spielWahlZeigen();
plattformWahlZeigen();

$('addStreamBtn').addEventListener('click', async () => {
  const raw = $('streamDate').value;
  const game = gewaehltesSpiel.trim();
  const start = new Date(raw);
  const repeat = Math.min(8, Math.max(1, parseInt($('streamRepeat').value, 10) || 1));
  if (!raw || isNaN(start) || !game) {
    showStatus('streamStatus', 'Bitte Datum, Uhrzeit und ein Spiel auswählen.', 'error');
    return;
  }
  if (start.getTime() + STREAM_KEEP_MS < Date.now()) {
    showStatus('streamStatus', 'Das Datum liegt in der Vergangenheit.', 'error');
    return;
  }
  try {
    const batch = db.batch();
    for (let i = 0; i < repeat; i++) {
      // Wöchentlich wiederholen, Uhrzeit bleibt auch bei Zeitumstellung gleich
      const d = new Date(start);
      d.setDate(d.getDate() + i * 7);
      batch.set(db.collection('streamingplan').doc(), {
        streamDate: d.toISOString(),
        game: game.slice(0, 80),
        platform: gewaehltePlattformen.join(' / ').slice(0, 40),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    showStatus('streamStatus', repeat > 1 ? `✓ ${repeat} Streams geplant` : '✓ Stream geplant', 'success');
    gewaehltesSpiel = '';
    spielWahlZeigen();
    $('streamRepeat').value = '1';
    loadStreams();
  } catch (err) {
    console.error(err);
    showStatus('streamStatus', '✗ ' + friendlyError(err), 'error');
  }
});

async function loadStreams() {
  const list = $('streamList');
  try {
    const snap = await db.collection('streamingplan').get();
    const now = Date.now();
    const upcoming = [];
    const expired = [];

    snap.docs.forEach((doc) => {
      const s = { id: doc.id, ...doc.data() };
      const t = new Date(s.streamDate).getTime();
      if (!isNaN(t) && t + STREAM_KEEP_MS < now) expired.push(doc.ref);
      else upcoming.push(s);
    });

    // Vergangene Streams automatisch löschen
    if (expired.length) {
      const batch = db.batch();
      expired.slice(0, 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }

    // Spiele aus dem Plan in die Auswahl übernehmen
    spieleAusPlan = upcoming.map((s) => String(s.game || '').trim()).filter(Boolean);
    spielWahlZeigen();

    // Nächster Stream oben, alte Einträge ohne Datum ganz unten
    upcoming.sort((a, b) => {
      const ta = new Date(a.streamDate).getTime();
      const tb = new Date(b.streamDate).getTime();
      return (isNaN(ta) ? Infinity : ta) - (isNaN(tb) ? Infinity : tb);
    });

    if (!upcoming.length) { list.replaceChildren(emptyNote('Keine Streams geplant')); return; }
    list.replaceChildren(...upcoming.map((s) =>
      buildItem(s.streamDate ? formatStreamDate(s.streamDate) : 'Alter Eintrag ohne Datum (' + String(s.day || '') + ')',
                String(s.game || '') + (s.platform ? ' • ' + s.platform : ''),
                () => deleteDoc('streamingplan', s.id, loadStreams))
    ));
  } catch (err) {
    console.error(err);
    list.replaceChildren(emptyNote('Streaming Plan konnte nicht geladen werden.'));
  }
}

// ---------- Löschen ----------
async function deleteDoc(collection, id, reload) {
  if (!confirm('Wirklich löschen?')) return;
  try {
    await db.collection(collection).doc(id).delete();
    reload();
  } catch (err) {
    console.error(err);
    alert(friendlyError(err));
  }
}

// ---------- Live je Plattform ----------
// Automatisch: Streamer.bot meldet dem Worker, wo gerade live ist (GET /live → plattformen).
// Notfall: eigener Schalter je Plattform in Firestore status/plattformen (gilt im Worker höchstens 8 Std.).
const LIVE_URL = 'https://nwu-anmeldung.nwu-brand.workers.dev/live';
const PLATTFORM_NAMEN = { twitch: '🟣 Twitch', kick: '🟢 Kick', youtube: '▶️ YouTube', tiktok: '🎵 TikTok' };
let notfallStand = { twitch: false, kick: false, youtube: false, tiktok: false };

async function liveStandLaden() {
  const liste = $('plattformListe');
  if (!liste) return;
  let auto = {};
  try {
    const res = await fetch(LIVE_URL, { cache: 'no-store', credentials: 'omit' });
    if (res.ok) auto = (await res.json()).plattformen || {};
  } catch (e) { /* Worker nicht erreichbar: nur Notfall-Stand zeigen */ }
  try {
    const doc = await db.collection('status').doc('plattformen').get();
    if (doc.exists) {
      const d = doc.data();
      const zeit = d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : 0;
      const frisch = Date.now() - zeit < 8 * 3600000;
      Object.keys(notfallStand).forEach((p) => { notfallStand[p] = frisch && d[p] === true; });
    }
  } catch (e) { console.error(e); }
  liste.innerHTML = '';
  Object.keys(PLATTFORM_NAMEN).forEach((p) => {
    const zeile = document.createElement('div');
    zeile.className = 'plattform-zeile' + (auto[p] ? ' ist-live' : '');
    const name = document.createElement('span');
    name.className = 'plattform-name';
    name.textContent = PLATTFORM_NAMEN[p];
    const status = document.createElement('span');
    status.className = 'plattform-auto';
    status.innerHTML = auto[p] ? '<b>● live</b>' + (notfallStand[p] ? ' (Notfall)' : '') : 'offline';
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'submit-btn ' + (notfallStand[p] ? 'btn-notfall-an' : 'btn-offline');
    knopf.textContent = notfallStand[p] ? 'Notfall: AN' : 'Notfall: aus';
    knopf.addEventListener('click', () => notfallSetzen({ ...notfallStand, [p]: !notfallStand[p] }));
    zeile.append(name, status, knopf);
    liste.appendChild(zeile);
  });
}

async function notfallSetzen(neu) {
  try {
    await db.collection('status').doc('plattformen').set({
      twitch: neu.twitch === true, kick: neu.kick === true, youtube: neu.youtube === true, tiktok: neu.tiktok === true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'admin'
    });
    notfallStand = neu;
    showStatus('liveStatus', '✓ Gespeichert – Webseiten zeigen es innerhalb von 1 Minute', 'success');
    setTimeout(liveStandLaden, 1500);
  } catch (err) {
    console.error(err);
    showStatus('liveStatus', '✗ ' + friendlyError(err), 'error');
  }
}
$('notfallAllesAusBtn').addEventListener('click', () => notfallSetzen({ twitch: false, kick: false, youtube: false, tiktok: false }));
$('liveNeuLadenBtn').addEventListener('click', liveStandLaden);
document.querySelectorAll('.tab[data-tab="livestatus"]').forEach((t) => t.addEventListener('click', liveStandLaden));

// ---------- Geheime Rabattcodes ----------
// Schaltet die beiden versteckten Codes auf der Linkseite. Die Linkseite liest
// status/secrets.active oeffentlich. Fehlt das Dokument, bleiben die Codes aktiv,
// damit ein nie angelegtes Dokument das Feature nicht stillschweigend abschaltet.
async function loadSecretsState() {
  const el = $('secretsCurrent');
  try {
    const doc = await db.collection('status').doc('secrets').get();
    if (!doc.exists) {
      el.textContent = 'Aktuell: aktiv (noch nie umgeschaltet)';
      return;
    }
    el.textContent = doc.data().active === false ? 'Aktuell: aus' : 'Aktuell: aktiv';
  } catch (err) {
    console.error(err);
    el.textContent = 'Status konnte nicht geladen werden.';
  }
}

async function setSecrets(active) {
  try {
    await db.collection('status').doc('secrets').set({
      active: active,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'admin'
    });
    showStatus('secretsStatus', active ? '✓ Secrets aktiv' : '✓ Secrets aus', 'success');
    loadSecretsState();
  } catch (err) {
    console.error(err);
    showStatus('secretsStatus', '✗ ' + friendlyError(err), 'error');
  }
}
$('secretsOnBtn').addEventListener('click', () => setSecrets(true));
$('secretsOffBtn').addEventListener('click', () => setSecrets(false));

// ---------- Kooperation: Reichweite ----------
const STAT_FIELDS = { tiktok: 'statTiktok', twitch: 'statTwitch', youtube: 'statYoutube', instagram: 'statInstagram' };

async function loadStats() {
  try {
    const doc = await db.collection('stats').doc('social').get();
    const d = doc.exists ? doc.data() : {};
    for (const [key, id] of Object.entries(STAT_FIELDS)) $(id).value = d[key] || '';
  } catch (err) {
    console.error(err);
  }
}

$('saveStatsBtn').addEventListener('click', async () => {
  const data = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  for (const [key, id] of Object.entries(STAT_FIELDS)) data[key] = $(id).value.trim().slice(0, 12);
  try {
    await db.collection('stats').doc('social').set(data);
    showStatus('statsStatus', '✓ Zahlen gespeichert', 'success');
  } catch (err) {
    console.error(err);
    showStatus('statsStatus', '✗ ' + friendlyError(err), 'error');
  }
});

// ---------- Kooperation: Partner ----------
function httpsOrEmpty(value) {
  const v = value.trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href.slice(0, 300) : null;
  } catch (e) {
    return null;
  }
}

$('addPartnerBtn').addEventListener('click', async () => {
  const name = $('partnerName').value.trim();
  const url = httpsOrEmpty($('partnerUrl').value);
  const logo = httpsOrEmpty($('partnerLogo').value);
  if (!name) { showStatus('partnerStatus', 'Bitte einen Namen eintragen.', 'error'); return; }
  if (url === null || logo === null) { showStatus('partnerStatus', 'Links müssen mit https:// beginnen.', 'error'); return; }
  try {
    await db.collection('partners').add({
      name: name.slice(0, 80),
      category: $('partnerCategory').value.trim().slice(0, 60),
      url: url,
      logo: logo,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showStatus('partnerStatus', '✓ Partner hinzugefügt', 'success');
    ['partnerName', 'partnerCategory', 'partnerUrl', 'partnerLogo'].forEach((id) => { $(id).value = ''; });
    loadPartners();
  } catch (err) {
    console.error(err);
    showStatus('partnerStatus', '✗ ' + friendlyError(err), 'error');
  }
});

async function loadPartners() {
  const list = $('partnerList');
  try {
    const snap = await db.collection('partners').get();
    if (snap.empty) { list.replaceChildren(emptyNote('Noch keine Partner')); return; }
    list.replaceChildren(...snap.docs.map((doc) => {
      const d = doc.data();
      return buildItem(String(d.name || ''), String(d.category || '') + (d.url ? ' • ' + d.url : ''), () => deleteDoc('partners', doc.id, loadPartners));
    }));
  } catch (err) {
    console.error(err);
    list.replaceChildren(emptyNote('Partner konnten nicht geladen werden.'));
  }
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
    $(tab.dataset.tab).classList.add('active');
    tab.classList.add('active');
  });
});
