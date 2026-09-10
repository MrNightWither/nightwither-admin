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
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
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
$('addStreamBtn').addEventListener('click', async () => {
  const day = $('streamDay').value;
  const time = $('streamTime').value;
  const game = $('streamGame').value.trim();
  if (!DAYS.includes(day) || !/^\d{2}:\d{2}$/.test(time) || !game) {
    showStatus('streamStatus', 'Bitte Tag, Uhrzeit und Spiel ausfüllen.', 'error');
    return;
  }
  try {
    await db.collection('streamingplan').add({
      day: day,
      time: time,
      game: game.slice(0, 80),
      platform: $('streamPlatform').value.trim().slice(0, 40),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showStatus('streamStatus', '✓ Stream hinzugefügt', 'success');
    $('streamGame').value = '';
    $('streamPlatform').value = '';
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
    const streams = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    streams.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
    if (!streams.length) { list.replaceChildren(emptyNote('Kein Streaming Plan')); return; }
    list.replaceChildren(...streams.map((s) =>
      buildItem(String(s.day || '') + ' • ' + String(s.time || ''),
                String(s.game || '') + ' • ' + String(s.platform || ''),
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

// ---------- Live Status ----------
async function setLiveStatus(isLive) {
  try {
    await db.collection('status').doc('twitch').set({
      isLive: isLive,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'admin'
    });
    showStatus('liveStatus', isLive ? '✓ 🔴 LIVE' : '✓ ⚪ OFFLINE', 'success');
  } catch (err) {
    console.error(err);
    showStatus('liveStatus', '✗ ' + friendlyError(err), 'error');
  }
}
$('liveOnBtn').addEventListener('click', () => setLiveStatus(true));
$('liveOffBtn').addEventListener('click', () => setLiveStatus(false));

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
