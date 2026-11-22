/* DONKO TRADE HUB : site en lecture seule.
   - Seul réseau vers le VPS : GET sur l'API officielle, jeton dans l'en-tête Authorization.
   - Taux de change : taux de référence BCE (Frankfurter), GET, sans clé.
   - Aucun bouton d'ordre, aucun réglage du robot modifiable ici.
   - Données de l'API insérées en texte brut (textContent), jamais en HTML. */
(function () {
  "use strict";

  /* ===== À RENSEIGNER AVANT MISE EN LIGNE ===== */
  var ALLOWED_API_ORIGIN = "https://api.REMPLACER-PAR-TON-DOMAINE.tld";
  var REFERRAL_URL = "";   // liens simples : aucun parrainage sur ce site
  /* =========================================== */

  var T = window.SYNTIX_I18N;
  var LOCALE = { fr: "fr-FR", en: "en-GB", de: "de-DE" };
  var FLAG = { fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪" };
  var KEY = { lang: "thub_lang", theme: "thub_theme", ccy: "thub_ccy", rate: "thub_rate_eur",
              rateDate: "thub_rate_date", url: "thub_api_url", token: "thub_api_token",
              seen: "thub_seen_events", favs: "thub_favs", priv: "thub_private",
              lock: "thub_lock", hiddenAt: "thub_hidden_at" };
  var ROBOT_KEY = "thub_robot";
  var POLL_MS = 30000;
  var XOF_PER_EUR = 655.957;
  var RATE_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR";
  var DEFAULT_INDICES = ["FX Vol 20", "FX Vol 40", "FX Vol 60", "FX Vol 80", "FX Vol 99",
                         "SFX Vol 20", "SFX Vol 40", "SFX Vol 60", "SFX Vol 80", "SFX Vol 99",
                         "PainX 1200", "PainX 400", "PainX 600", "PainX 800", "PainX 999",
                         "GainX 1200", "GainX 400", "GainX 600", "GainX 800", "GainX 999"];
  var DEFAULT_FAVS = DEFAULT_INDICES.slice(10);   // les 10 PainX et GainX
  var LOCK_MINUTES = [1, 5, 10, 15, 20, 30, 60];

  var state = { robot: "SYNTIX", lang: "fr", theme: "dark", ccy: "USD", rateEur: 0.92, rateDate: null,
                timer: null, firstLoad: true, cal: null, range: null, deferred: null };
  var cache = null;

  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function unstore(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
  function t(key) { return (T[state.lang] && T[state.lang][key]) || T.fr[key] || key; }
  function fill(str, vars) { return String(str).replace(/\{(\w+)\}/g, function (_, k) { return vars[k]; }); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v, d) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Number(v).toLocaleString(LOCALE[state.lang], { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function dateStr(iso) {
    var d = new Date(iso);
    return isNaN(d) ? String(iso || "—") : d.toLocaleString(LOCALE[state.lang], { dateStyle: "short", timeStyle: "short" });
  }
  function dayKey(d) { return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }

  /* ---------- Devise et montants ---------- */
  function usdTo(amountUsd) {
    var eur = amountUsd * state.rateEur;
    if (state.ccy === "EUR") return eur;
    if (state.ccy === "XOF" || state.ccy === "XAF") return eur * XOF_PER_EUR;
    return amountUsd;
  }
  function money(amountUsd) {
    var value = usdTo(amountUsd || 0);
    var digits = (state.ccy === "XOF" || state.ccy === "XAF") ? 0 : 2;
    try {
      return new Intl.NumberFormat(LOCALE[state.lang], { style: "currency", currency: state.ccy,
        minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    } catch (e) { return value.toFixed(digits) + " " + state.ccy; }
  }

  /* ---------- Taux de change automatique (BCE) ---------- */
  function refreshRate(force) {
    var last = load(KEY.rateDate);
    var fresh = last && (Date.now() - new Date(last).getTime()) < 24 * 3600 * 1000;
    if (fresh && !force) { renderRateInfo(); return Promise.resolve(); }
    return fetch(RATE_URL, { cache: "no-store", credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error("rate"); return r.json(); })
      .then(function (j) {
        var v = Number(j.rates && j.rates.EUR);
        if (!(v > 0)) throw new Error("rate");
        state.rateEur = v; state.rateDate = j.date;
        store(KEY.rate, String(v)); store(KEY.rateDate, String(j.date));
      })
      .catch(function () { /* hors ligne : on garde le dernier taux connu */ })
      .then(function () { renderRateInfo(); if (cache) renderAll(); });
  }
  function renderRateInfo() {
    var el = $("rate-info");
    if (state.rateDate) el.textContent = fill(t("rate_ok"), { r: num(state.rateEur, 4), d: state.rateDate });
    else el.textContent = fill(t("rate_fallback"), { r: num(state.rateEur, 4) });
  }

  /* ---------- Traductions, thème, devise ---------- */
  function applyTranslations() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
    $("btn-lang").textContent = FLAG[state.lang];
    ["fr", "en", "de"].forEach(function (l) {
      $("lg-" + l).classList.toggle("active", l === state.lang);
    });
    renderRateInfo();
    updatePrivacyBtn();
    if (cache) renderAll();
    renderIndices();
    renderCalendar();
  }
  function setLang(lg) {
    if (!T[lg]) return;
    state.lang = lg; store(KEY.lang, lg);
    applyTranslations();
  }
  function setTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    store(KEY.theme, state.theme);
    $("th-dark").classList.toggle("active", state.theme === "dark");
    $("th-light").classList.toggle("active", state.theme === "light");
    $("btn-theme").textContent = state.theme === "dark" ? "☀" : "🌙";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "light" ? "#fbf7ec" : "#07080b");
  }
  function setCcy(c) {
    state.ccy = c; store(KEY.ccy, c);
    document.querySelectorAll("[data-ccy]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-ccy") === c); });
    if (cache) renderAll();
  }

  /* ---------- Confidentialité : masquer les montants ---------- */
  function setPrivate(on) {
    document.body.classList.toggle("private", on);
    store(KEY.priv, on ? "1" : "0");
    updatePrivacyBtn();
  }
  function updatePrivacyBtn() {
    var on = document.body.classList.contains("private");
    var b = $("btn-privacy");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    var label = t(on ? "acc_show" : "acc_hide");
    b.setAttribute("aria-label", label); b.title = label;
  }

  /* ---------- Verrouillage : code numérique ou schéma (haché, jamais en clair) ---------- */
  function hex(buf) { return Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }
  function randomSalt() { var a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }
  function hashSecret(secret, salt) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + secret)).then(hex);
  }
  function validPin(pin) { return /^[0-9]{4,8}$/.test(pin); }
  function lockConfig() { try { return JSON.parse(load(KEY.lock) || "null"); } catch (e) { return null; } }
  function lockOn() { var c = lockConfig(); return !!(c && c.hash); }
  function lockType() { var c = lockConfig(); return (c && c.type) || "pin"; }
  function lockSeconds() {
    var c = lockConfig();
    if (!c) return 300;
    if (c.seconds) return Number(c.seconds);
    if (c.minutes) return Number(c.minutes) * 60;
    return 300;
  }
  function saveLock(type, secret, seconds) {
    var salt = randomSalt();
    return hashSecret(secret, salt).then(function (h) {
      store(KEY.lock, JSON.stringify({ type: type, salt: salt, hash: h, seconds: seconds }));
    });
  }
  function showLock(on) {
    $("lock").classList.toggle("hidden", !on);
    document.body.classList.toggle("locked", on);
    var pat = lockType() === "pattern";
    $("lock-pin-wrap").classList.toggle("hidden", pat);
    $("lock-pattern").classList.toggle("hidden", !pat);
    $("lock-text").textContent = t(pat ? "lock_pattern_text" : "lock_text");
    $("lock-msg").textContent = "";
    if (on && !pat) { $("lock-input").value = ""; setTimeout(function () { $("lock-input").focus(); }, 50); }
  }
  function lockNow() { if (lockOn()) showLock(true); }
  function unlockWith(secret) {
    var c = lockConfig();
    if (!c) { showLock(false); return Promise.resolve(true); }
    return hashSecret(secret, c.salt).then(function (h) {
      if (h === c.hash) { showLock(false); return true; }
      $("lock-msg").textContent = t(c.type === "pattern" ? "pattern_wrong" : "lock_wrong");
      return false;
    });
  }

  /* Grille 3 x 3 : points numérotés 0 à 8, tracé au doigt ou à la souris. */
  function buildPattern(container) {
    container.textContent = "";
    for (var i = 0; i < 9; i++) {
      var d = document.createElement("div");
      d.className = "pn"; d.setAttribute("data-i", String(i));
      container.appendChild(d);
    }
  }
  function patternDraw(container, onDone) {
    var seq = [], drawing = false;
    function clearAll() { seq = []; container.querySelectorAll(".pn").forEach(function (d) { d.classList.remove("on"); }); }
    function add(x, y) {
      var el = document.elementFromPoint(x, y);
      if (el && el.classList && el.classList.contains("pn")) {
        var i = Number(el.getAttribute("data-i"));
        if (seq.indexOf(i) === -1) { seq.push(i); el.classList.add("on"); }
      }
    }
    container.addEventListener("pointerdown", function (e) {
      e.preventDefault(); clearAll(); drawing = true;
      try { container.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      add(e.clientX, e.clientY);
    });
    container.addEventListener("pointermove", function (e) { if (drawing) add(e.clientX, e.clientY); });
    container.addEventListener("pointerup", function () {
      if (!drawing) return;
      drawing = false;
      var s = seq.slice();
      setTimeout(function () { clearAll(); onDone(s.join("-"), s.length); }, 150);
    });
    container.addEventListener("pointercancel", function () { drawing = false; clearAll(); });
  }

  var pat = { mode: null, first: null };
  function secMsg(text) { $("sec-msg").textContent = text; }
  function patHint(text) { $("pat-hint").textContent = text; }
  function patOnDraw(seq, len) {
    if (len < 4) { patHint(t("pattern_short")); return; }
    var cfg = lockConfig();
    if (pat.mode === "verify-disable") {
      hashSecret(seq, cfg.salt).then(function (h) {
        if (h !== cfg.hash) { secMsg(t("pattern_wrong")); return; }
        unstore(KEY.lock); pat.mode = null; secMsg(t("pattern_disabled"));
      });
      return;
    }
    if (pat.mode === "verify-change") {
      hashSecret(seq, cfg.salt).then(function (h) {
        if (h !== cfg.hash) { secMsg(t("pattern_wrong")); return; }
        pat.mode = "new"; patHint(t("pattern_draw_new"));
      });
      return;
    }
    if (pat.mode === "new") { pat.first = seq; pat.mode = "again"; patHint(t("pattern_draw_again")); return; }
    if (pat.mode === "again") {
      if (seq !== pat.first) { pat.mode = null; pat.first = null; patHint(t("pattern_hint")); secMsg(t("pattern_mismatch")); return; }
      var wasOn = lockOn();
      saveLock("pattern", seq, lockSeconds()).then(function () {
        pat.mode = null; pat.first = null; patHint(t("pattern_hint"));
        secMsg(t(wasOn ? "pattern_changed" : "pattern_saved"));
      });
    }
  }

  function applyModeUI() {
    var isPat = $("lock-mode").value === "pattern";
    $("sec-pin").classList.toggle("hidden", isPat);
    $("sec-pattern").classList.toggle("hidden", !isPat);
  }

  function initSecurity() {
    buildPattern($("pattern-setup")); buildPattern($("lock-pattern"));
    patternDraw($("pattern-setup"), patOnDraw);
    patternDraw($("lock-pattern"), function (seq, len) { if (len >= 4) unlockWith(seq); else $("lock-msg").textContent = t("pattern_short"); });
    $("lock-mode").value = lockType();
    applyModeUI();
    $("lock-mode").addEventListener("change", applyModeUI);
    $("lock-after").value = String(lockSeconds());
    $("lock-after").addEventListener("change", function (e) {
      var cfg = lockConfig(); if (!cfg) return;
      cfg.seconds = Number(e.target.value); delete cfg.minutes; store(KEY.lock, JSON.stringify(cfg));
    });

    /* Code numérique */
    $("pin-set").addEventListener("click", function () {
      var pin = $("pin-new").value.trim();
      if (!validPin(pin)) { secMsg(t("sec_invalid")); return; }
      saveLock("pin", pin, Number($("lock-after").value)).then(function () { $("pin-new").value = ""; secMsg(t("sec_ok")); });
    });
    $("pin-change").addEventListener("click", function () {
      var cur = $("pin-old").value.trim(), pin = $("pin-new").value.trim();
      var cfg = lockConfig();
      if (!cfg) { secMsg(t("sec_need_current")); return; }
      if (!validPin(pin)) { secMsg(t("sec_invalid")); return; }
      hashSecret(cur, cfg.salt).then(function (h) {
        if (h !== cfg.hash) { secMsg(t("sec_bad")); return; }
        return saveLock("pin", pin, cfg.seconds || lockSeconds()).then(function () {
          $("pin-old").value = ""; $("pin-new").value = ""; secMsg(t("sec_changed"));
        });
      });
    });
    $("pin-disable").addEventListener("click", function () {
      var cur = $("pin-old").value.trim(), cfg = lockConfig();
      if (!cfg) { secMsg(t("sec_need_current")); return; }
      hashSecret(cur, cfg.salt).then(function (h) {
        if (h !== cfg.hash) { secMsg(t("sec_bad")); return; }
        unstore(KEY.lock); $("pin-old").value = ""; secMsg(t("sec_disabled"));
      });
    });

    /* Schéma */
    $("pat-set").addEventListener("click", function () {
      if (lockOn()) { secMsg(t("sec_need_current")); return; }
      pat.mode = "new"; patHint(t("pattern_draw_new")); secMsg("");
    });
    $("pat-change").addEventListener("click", function () {
      if (!lockOn()) { secMsg(t("sec_need_current")); return; }
      pat.mode = "verify-change"; patHint(t("pattern_draw_current")); secMsg("");
    });
    $("pat-disable").addEventListener("click", function () {
      if (!lockOn()) { secMsg(t("sec_need_current")); return; }
      pat.mode = "verify-disable"; patHint(t("pattern_draw_current")); secMsg("");
    });

    $("lock-go").addEventListener("click", function () { unlockWith($("lock-input").value.trim()); });
    $("lock-input").addEventListener("keydown", function (e) { if (e.key === "Enter") unlockWith($("lock-input").value.trim()); });

    /* Verrouillage automatique : après être resté hors de l'application plus longtemps que le délai */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { store(KEY.hiddenAt, String(Date.now())); return; }
      var at = Number(load(KEY.hiddenAt) || 0);
      unstore(KEY.hiddenAt);
      if (lockOn() && at && Date.now() - at >= lockSeconds() * 1000) lockNow();
    });
    if (lockOn()) showLock(true);
  }

  /* ---------- Réseau : GET uniquement ---------- */
  function apiConfigured() { return ALLOWED_API_ORIGIN.indexOf("REMPLACER") === -1; }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return ""; } }
  function cfg() {
    var stored = (load(KEY.url) || "").replace(/\/+$/, "");
    var ok = apiConfigured() && originOf(stored) === ALLOWED_API_ORIGIN;
    return { url: ok ? stored : "", token: load(KEY.token) || "" };
  }
  function apiGet(path) {
    var c = cfg();
    if (!c.url || !c.token) return Promise.reject(new Error("not_configured"));
    return fetch(c.url + path, { method: "GET", headers: { "Authorization": "Bearer " + c.token },
      cache: "no-store", credentials: "omit" }).then(function (r) {
      if (r.status === 401) throw new Error("unauthorized");
      if (!r.ok) throw new Error("http_" + r.status);
      return r.json();
    });
  }

  /* ---------- Robots : onglets, logo, cartes ---------- */
  function robotById(id) {
    var list = window.DONKO_ROBOTS || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }
  function selectRobot(id) {
    state.robot = robotById(id).id;
    store(ROBOT_KEY, state.robot);
    renderRobotHeader();
    cache = null;
    $("open-body").textContent = "";
    fillBody("open-body", [], 5, "open_none");
    refresh();
  }
  function rt(r, key) {
    var v = r[key];
    if (v && typeof v === "object") return v[state.lang] || v.fr || "";
    return v || "";
  }
  function renderRobotHeader() {
    var r = robotById(state.robot);
    $("acc-img").setAttribute("src", r.image);
    $("acc-img").setAttribute("alt", r.name);
    $("robot-title").textContent = r.name + " · " + rt(r, "market");
    renderIndices();
    document.querySelectorAll("#robot-tabs [data-robot]").forEach(function (b) {
      var on = b.getAttribute("data-robot") === state.robot;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  function renderRobotTabs() {
    var box = $("robot-tabs"); box.textContent = "";
    (window.DONKO_ROBOTS || []).forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "robot-tab"; b.setAttribute("role", "tab");
      b.setAttribute("data-robot", r.id); b.textContent = r.name.replace("DONKO ", "");
      b.addEventListener("click", function () { selectRobot(r.id); });
      box.appendChild(b);
    });
    renderRobotHeader();
  }
  function renderRobotsGrid() {
    var box = $("robots-grid"); if (!box) return; box.textContent = "";
    (window.DONKO_ROBOTS || []).forEach(function (r) {
      var card = document.createElement("article"); card.className = "robot-card card";
      var img = document.createElement("img"); img.src = r.image; img.alt = r.name; img.loading = "lazy";
      var h = document.createElement("h3"); h.textContent = r.name;
      var m = document.createElement("p"); m.className = "small muted"; m.textContent = rt(r, "market") + " · " + rt(r, "brokerScope");
      var st = document.createElement("p"); st.className = "small robot-status"; st.textContent = rt(r, "status");
      var story = document.createElement("p"); story.textContent = r.story;
      var how = document.createElement("h4"); how.textContent = "Fonctionnement";
      var ul = document.createElement("ul"); r.how.forEach(function (x) { var li = document.createElement("li"); li.textContent = x; ul.appendChild(li); });
      var lim = document.createElement("h4"); lim.textContent = "Limites";
      var ul2 = document.createElement("ul"); r.limits.forEach(function (x) { var li = document.createElement("li"); li.textContent = x; ul2.appendChild(li); });
      var bn = document.createElement("p"); bn.className = "small muted"; bn.textContent = r.brokerNote;
      var go = document.createElement("button"); go.type = "button"; go.className = "btn ghost"; go.textContent = "Voir son tableau de bord";
      go.addEventListener("click", function () { selectRobot(r.id); location.hash = "#tableau"; });
      card.appendChild(img); card.appendChild(h); card.appendChild(m); card.appendChild(st);
      card.appendChild(story); card.appendChild(how); card.appendChild(ul); card.appendChild(lim); card.appendChild(ul2);
      card.appendChild(bn); card.appendChild(go); box.appendChild(card);
    });
  }

  /* ---------- Rendu ---------- */
  function setConn(kind, text) {
    var pill = $("conn-pill");
    pill.className = "pill" + (kind === "ok" ? " ok" : kind === "bad" ? " bad" : "");
    pill.textContent = text;
  }
  function cell(text, cls) { var td = document.createElement("td"); td.textContent = text; if (cls) td.className = cls; return td; }
  function fillBody(bodyId, rows, colspan, emptyKey) {
    var body = $(bodyId); body.textContent = "";
    if (!rows.length) {
      var tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = colspan; td.className = "muted"; td.textContent = t(emptyKey);
      tr.appendChild(td); body.appendChild(tr); return;
    }
    rows.forEach(function (r) { var tr = document.createElement("tr"); r.forEach(function (c) { tr.appendChild(c); }); body.appendChild(tr); });
  }

  function renderAccount(accounts) {
    var a = accounts && accounts[0];
    $("acc-none").hidden = !!a;
    if (!a) {
      ["acc-broker", "acc-server", "acc-login", "acc-balance", "acc-equity"].forEach(function (id) { $(id).textContent = "—"; });
      $("acc-mode").textContent = "—"; $("acc-mode").className = "mode-badge";
      return;
    }
    var mode = a.mode === "DEMO" ? "demo" : a.mode === "REEL" ? "real" : "other";
    $("acc-broker").textContent = a.broker || "—";
    $("acc-server").textContent = a.server || "—";
    $("acc-login").textContent = a.login_masked || "—";
    $("acc-mode").textContent = t("acc_mode_" + mode);
    $("acc-mode").className = "mode-badge " + mode;
    $("acc-balance").textContent = money(a.balance_usd);
    var eqUsd = a.balance > 0 ? a.equity * (a.balance_usd / a.balance) : a.equity;
    $("acc-equity").textContent = money(eqUsd);
  }

  function renderKpis(stats) {
    $("k-trades").textContent = num(stats.trades);
    $("k-net").textContent = stats.net_total == null ? "—" : money(stats.net_total);
    $("k-wr").textContent = stats.win_rate_pct == null ? "—" : num(stats.win_rate_pct, 1) + " %";
    $("k-pf").textContent = stats.profit_factor == null ? "—" : num(stats.profit_factor, 2);
    $("k-dd").textContent = stats.max_drawdown == null ? "—" : money(stats.max_drawdown);
  }
  function renderOpen(list) {
    fillBody("open-body", list.map(function (p) {
      return [cell(dateStr(p.time)), cell(p.market || "—"), cell(p.side || "—"), cell(num(p.volume, 2)), cell(p.sl == null ? "—" : num(p.sl, 5))];
    }), 5, "open_none");
    $("k-open").textContent = num(list.length);
  }
  function inRange(e) {
    if (!state.range) return true;
    var d = new Date(e.time); if (isNaN(d)) return false;
    var k = dayKey(d);
    return k >= state.range.a && k <= state.range.b;
  }
  function renderJournal(events) {
    var rows = events.filter(inRange).slice(0, 50).map(function (e) {
      var isClose = e.event === "CLOSE";
      var net = isClose && e.net != null ? money(e.net) : "—";
      return [cell(dateStr(e.time)), cell(t(isClose ? "ev_close" : "ev_open")), cell(e.market || "—"),
              cell(e.side || "—"), cell(num(e.volume, 2)), cell(net, isClose && e.net != null ? (e.net >= 0 ? "ok" : "bad") : "")];
    });
    fillBody("journal-body", rows, 6, "journal_none");
  }
  function renderCurve(events) {
    var box = $("curve");
    var closes = events.filter(function (e) { return e.event === "CLOSE" && e.net != null; })
      .sort(function (x, y) { return String(x.time).localeCompare(String(y.time)); });
    box.textContent = "";
    if (!closes.length) { box.textContent = t("curve_none"); return; }
    var pts = [0], acc = 0;
    closes.forEach(function (e) { acc += Number(e.net); pts.push(acc); });
    var W = 600, H = 220, P = 24;
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    var span = (hi - lo) || 1;
    function x(i) { return P + i * (W - 2 * P) / Math.max(pts.length - 1, 1); }
    function y(v) { return H - P - ((v - lo) / span) * (H - 2 * P); }
    var d = pts.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var zero = y(0).toFixed(1), last = pts[pts.length - 1];
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(t("curve_title")) + '">' +
      '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + zero + '" y2="' + zero + '" stroke="currentColor" opacity=".25" stroke-dasharray="4 4"/>' +
      '<path d="' + d + '" fill="none" stroke="' + (last >= 0 ? "#2fb170" : "#e0574c") + '" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    var val = document.createElement("div");
    val.className = "kpi-value sens " + (last >= 0 ? "ok" : "bad");
    val.textContent = money(last);
    box.appendChild(val);
  }
  function renderAgenda(events) {
    var box = $("agenda-list"); box.textContent = "";
    var list = events.filter(inRange);
    if (!list.length) { box.textContent = t("agenda_none"); return; }
    var days = {};
    list.forEach(function (e) {
      var d = new Date(e.time); if (isNaN(d)) return;
      var k = dayKey(d);
      days[k] = days[k] || { opened: 0, closed: 0, net: 0 };
      if (e.event === "CLOSE") { days[k].closed += 1; days[k].net += Number(e.net || 0); } else { days[k].opened += 1; }
    });
    Object.keys(days).sort().reverse().forEach(function (k) {
      var r = days[k], card = document.createElement("div"); card.className = "agenda-day";
      var h = document.createElement("h3"); h.textContent = k;
      var p = document.createElement("div"); p.className = "small sens";
      p.textContent = num(r.opened) + " " + t("day_opened") + " · " + num(r.closed) + " " + t("day_closed") + " · " + money(r.net);
      card.appendChild(h); card.appendChild(p); box.appendChild(card);
    });
  }

  /* ---------- Calendrier replié : choisir une période, par saisie ou sur le calendrier ---------- */
  function activityDays() {
    var m = {};
    if (cache) cache.events.forEach(function (e) { var d = new Date(e.time); if (!isNaN(d)) m[dayKey(d)] = 1; });
    return m;
  }
  function renderCalendar() {
    if (!state.cal) { var now = new Date(); state.cal = { y: now.getUTCFullYear(), m: now.getUTCMonth() }; }
    var c = state.cal, grid = $("cal-grid");
    var first = new Date(Date.UTC(c.y, c.m, 1));
    $("cal-month").textContent = new Intl.DateTimeFormat(LOCALE[state.lang], { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
    var days = activityDays();
    grid.textContent = "";
    var labels = Array.from({ length: 7 }, function (_, i) {
      return new Intl.DateTimeFormat(LOCALE[state.lang], { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i)));
    });
    labels.forEach(function (l) { var s = document.createElement("div"); s.className = "cal-wd"; s.textContent = l; grid.appendChild(s); });
    var offset = (first.getUTCDay() + 6) % 7;
    for (var i = 0; i < offset; i++) { var e = document.createElement("div"); e.className = "cal-blank"; grid.appendChild(e); }
    var n = new Date(Date.UTC(c.y, c.m + 1, 0)).getUTCDate();
    var sel = state.range;
    for (var dd = 1; dd <= n; dd++) {
      var key = c.y + "-" + String(c.m + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
      var b = document.createElement("button");
      b.type = "button"; b.className = "cal-day"; b.textContent = String(dd); b.setAttribute("data-key", key);
      if (days[key]) b.classList.add("has");
      if (sel && key >= sel.a && key <= sel.b) b.classList.add("in");
      if (sel && (key === sel.a || key === sel.b)) b.classList.add("edge");
      b.addEventListener("click", function (ev) { pickDay(ev.currentTarget.getAttribute("data-key")); });
      grid.appendChild(b);
    }
    $("cal-from").value = sel ? sel.a : "";
    $("cal-to").value = sel ? sel.b : "";
    var r = $("cal-range");
    if (!sel) r.textContent = t("cal_range_none");
    else if (sel.a === sel.b) r.textContent = t("cal_range_one") + " · " + sel.a;
    else r.textContent = fill(t("cal_range"), { a: sel.a, b: sel.b });
  }
  function applyRange(a, b) {
    state.range = (a && b) ? { a: a < b ? a : b, b: a < b ? b : a } : null;
    if (state.range) { var p = state.range.a.split("-"); state.cal = { y: Number(p[0]), m: Number(p[1]) - 1 }; }
    renderCalendar();
    if (cache) { renderAgenda(cache.events); renderJournal(cache.events); }
  }
  var pending = null;
  function pickDay(key) {
    if (!pending) { pending = key; applyRange(key, key); }
    else { var first = pending; pending = null; applyRange(first, key); }
  }
  function validIso(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00Z")); }
  function initCalendar() {
    $("cal-open").addEventListener("click", function () {
      var hidden = $("cal-panel").classList.toggle("hidden");
      $("cal-open").setAttribute("aria-expanded", String(!hidden));
    });
    $("cal-close").addEventListener("click", function () {
      $("cal-panel").classList.add("hidden"); $("cal-open").setAttribute("aria-expanded", "false");
    });
    $("cal-prev").addEventListener("click", function () { var c = state.cal; c.m -= 1; if (c.m < 0) { c.m = 11; c.y -= 1; } renderCalendar(); });
    $("cal-next").addEventListener("click", function () { var c = state.cal; c.m += 1; if (c.m > 11) { c.m = 0; c.y += 1; } renderCalendar(); });
    $("cal-from").addEventListener("change", function (e) {
      var v = e.target.value; if (!validIso(v)) return;
      applyRange(v, state.range ? state.range.b : v);
    });
    $("cal-to").addEventListener("change", function (e) {
      var v = e.target.value; if (!validIso(v)) return;
      applyRange(state.range ? state.range.a : v, v);
    });
    $("cal-reset").addEventListener("click", function () { pending = null; applyRange(null, null); });
  }

  /* ---------- Menus de réglages : Affichage et Sécurité ---------- */
  function initMenus() {
    function toggle(btnId, panelId) {
      $(btnId).addEventListener("click", function () {
        var hidden = $(panelId).classList.toggle("hidden");
        $(btnId).setAttribute("aria-expanded", String(!hidden));
      });
    }
    toggle("open-display", "panel-display");
    toggle("open-security", "panel-security");
  }

  /* ---------- Backtest publié (fichier backtest.json à la racine du site) ---------- */
  function renderBacktest(data) {
    var box = $("bt-box"); box.textContent = "";
    var meta = document.createElement("p"); meta.className = "small muted";
    var parts = [];
    if (data.period) parts.push(t("bt_period") + " : " + data.period);
    if (data.generated) parts.push(t("bt_generated") + " " + data.generated);
    meta.textContent = parts.join(" · ");
    box.appendChild(meta);
    var wrap = document.createElement("div"); wrap.className = "table-wrap";
    var table = document.createElement("table");
    var head = document.createElement("thead"), hr = document.createElement("tr");
    ["bt_col_index", "bt_col_trades", "bt_col_win", "bt_col_pf", "bt_col_dd", "bt_col_net"].forEach(function (k) {
      var th = document.createElement("th"); th.textContent = t(k); hr.appendChild(th);
    });
    head.appendChild(hr); table.appendChild(head);
    var body = document.createElement("tbody");
    (data.rows || []).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(cell(String(r.index || "—")));
      tr.appendChild(cell(num(r.trades)));
      tr.appendChild(cell(r.win_rate == null ? "—" : num(r.win_rate, 1) + " %"));
      tr.appendChild(cell(r.profit_factor == null ? "—" : num(r.profit_factor, 2)));
      tr.appendChild(cell(r.max_drawdown == null ? "—" : money(r.max_drawdown)));
      tr.appendChild(cell(r.net == null ? "—" : money(r.net), Number(r.net) >= 0 ? "ok" : "bad"));
      body.appendChild(tr);
    });
    table.appendChild(body); wrap.appendChild(table); box.appendChild(wrap);
    var disc = document.createElement("p"); disc.className = "small muted"; disc.style.marginTop = "8px";
    disc.textContent = t("bt_disclaimer"); box.appendChild(disc);
  }
  function initBacktest() {
    fetch("backtest.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("absent"); return r.json(); })
      .then(renderBacktest)
      .catch(function () { /* aucun backtest publié : le message par défaut reste affiché */ });
  }

  /* ---------- Actifs du robot choisi et favoris (propres à chaque robot) ---------- */
  function favKey(id) { return KEY.favs + ":" + (id || state.robot); }
  function favs() {
    var r = robotById(state.robot);
    var raw = load(favKey());
    if (raw === null) return (r.defaultFavs || []).slice();
    try { var v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function toggleFav(name) {
    var list = favs(), i = list.indexOf(name);
    if (i === -1) list.push(name); else list.splice(i, 1);
    store(favKey(), JSON.stringify(list));
    renderIndices();
  }
  function indexRow(name) {
    var on = favs().indexOf(name) !== -1;
    var row = document.createElement("div"); row.className = "index-chip";
    var label = document.createElement("span"); label.textContent = name;
    var star = document.createElement("button");
    star.type = "button"; star.className = "star" + (on ? " on" : ""); star.textContent = on ? "★" : "☆";
    star.setAttribute("aria-label", t(on ? "fav_remove" : "fav_add"));
    star.addEventListener("click", function () { toggleFav(name); });
    row.appendChild(label); row.appendChild(star); return row;
  }
  function renderIndices() {
    var r = robotById(state.robot);
    var d = $("defaults"), f = $("favs");
    if (!d || !f) return;
    d.textContent = "";
    (r.assets || []).forEach(function (n) { d.appendChild(indexRow(n)); });
    f.textContent = "";
    var list = favs();
    if (!list.length) f.textContent = t("favs_none");
    else list.forEach(function (n) { f.appendChild(indexRow(n)); });
    var fam = $("fam-block");
    if (fam) fam.classList.toggle("hidden", r.id !== "SYNTIX");
    var note = $("defaults-note");
    if (note) note.textContent = rt(r, "assetsNote");
  }

  /* ---------- Alertes ---------- */
  function pushAlert(text) {
    var list = $("alerts-list"), li = document.createElement("li");
    li.textContent = text;
    var first = list.querySelector("li");
    if (first && first.classList.contains("muted")) list.textContent = "";
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 60) list.removeChild(list.lastChild);
  }
  function detectNew(events) {
    var seen = {};
    try { seen = JSON.parse(load(KEY.seen) || "{}"); } catch (e) { seen = {}; }
    var fresh = [];
    events.forEach(function (e) {
      var key = (e.time || "") + "|" + (e.event || "") + "|" + (e.ticket || "");
      if (!seen[key]) { seen[key] = 1; fresh.push(e); }
    });
    var keys = Object.keys(seen);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(function (k) { delete seen[k]; });
    store(KEY.seen, JSON.stringify(seen));
    if (state.firstLoad) return;
    fresh.forEach(function (e) {
      if (e.event === "CLOSE") pushAlert(dateStr(e.time) + " · " + t("ev_close") + " · " + (e.market || "") + " · " + money(e.net || 0));
      else pushAlert(dateStr(e.time) + " · " + t("ev_open") + " · " + (e.side || "") + " " + (e.market || "") + " · " + num(e.volume, 2));
    });
  }

  /* ---------- Réglages de risque : lecture seule, modifiés dans la configuration du robot ---------- */
  function renderRisk(risk, accounts) {
    var box = $("risk-body"); if (!box) return;
    box.textContent = "";
    var a = accounts && accounts[0];
    var rows = [
      [t("risk_per_trade"), risk.risk_per_trade_pct == null ? "—" : num(risk.risk_per_trade_pct, 2) + " %"],
      [t("risk_total"), risk.max_total_open == null ? "—" : num(risk.max_total_open) + " " + t("risk_positions")],
      [t("risk_trades_day"), risk.max_trades_per_day == null ? "—" : num(risk.max_trades_per_day)],
      [t("risk_loss_day"), risk.daily_loss_pct == null ? "—" : num(risk.daily_loss_pct, 1) + " %"],
      [t("risk_cooldown"), risk.cooldown_after_loss_s == null ? "—" : num(risk.cooldown_after_loss_s / 60, 0) + " min"],
      [t("risk_margin_min"), risk.margin_min_pct == null ? "—" : num(risk.margin_min_pct, 0) + " %"],
      [t("risk_margin_now"), a && a.margin_level ? num(a.margin_level, 0) + " %" : "—"],
      [t("risk_mode"), risk.live === true ? t("risk_live") : risk.live === false ? t("risk_sim") : "—"],
    ];
    var table = document.createElement("table"), body = document.createElement("tbody");
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(cell(r[0])); tr.appendChild(cell(r[1], "sens"));
      body.appendChild(tr);
    });
    table.appendChild(body); box.appendChild(table);
  }

  /* ---------- Rendu global ---------- */
  function renderAll() {
    if (!cache) return;
    renderKpis(cache.stats);
    renderOpen(cache.open);
    renderAccount(cache.accounts);
    renderRisk(cache.risk, cache.accounts);
    renderCurve(cache.events);
    renderAgenda(cache.events);
    renderJournal(cache.events);
    renderCalendar();
  }

  /* ---------- Cycle de rafraîchissement ---------- */
  function refresh() {
    var c = cfg();
    if (!c.url || !c.token) {
      setConn("", apiConfigured() ? t("status_unknown") : t("api_not_configured"));
      $("updated").textContent = t("never");
      return Promise.resolve();
    }
    return Promise.all([
      apiGet("/api/robots/" + state.robot + "/stats"),
      apiGet("/api/robots/" + state.robot + "/open"),
      apiGet("/api/robots/" + state.robot + "/journal?limit=200"),
      apiGet("/api/robots/" + state.robot + "/account").catch(function () { return { accounts: [] }; }),
    ]).then(function (res) {
      cache = { stats: res[0].statistics, open: res[1].open || [], events: res[2].events || [], accounts: res[3].accounts || [], risk: res[3].risk || {} };
      setConn("ok", t("status_connected"));
      renderAll();
      detectNew(cache.events);
      state.firstLoad = false;
      $("updated").textContent = new Date().toLocaleTimeString(LOCALE[state.lang]);
    }).catch(function (err) {
      if (!/^(unauthorized|not_configured|http_)/.test(err.message || "")) console.error("Rendu SYNTIX :", err);
      var msg = { unauthorized: t("err_unauth"), not_configured: t("err_not_configured") }[err.message] || t("err_offline");
      setConn("bad", t("status_disconnected"));
      $("settings-msg").textContent = msg;
    });
  }
  function startPolling() { if (state.timer) clearInterval(state.timer); state.timer = setInterval(refresh, POLL_MS); }

  /* ---------- Navigation : haut et barre du bas ---------- */
  function initNav() {
    var nav = $("main-nav");
    $("btn-nav").addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      $("btn-nav").setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); $("btn-nav").setAttribute("aria-expanded", "false"); });
    });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          document.querySelectorAll("[data-nav]").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-nav") === en.target.id); });
        });
      }, { rootMargin: "-40% 0px -55% 0px" });
      document.querySelectorAll("main section[id]").forEach(function (s) { io.observe(s); });
    }
  }
  function openConnectionIfRequested() {
    if (window.location.hash === "#connexion") $("connexion").classList.add("open");
  }

  /* ---------- Réglages de connexion API ---------- */
  function initConnection() {
    $("api-url").value = load(KEY.url) || "";
    $("btn-save").addEventListener("click", function () {
      var url = $("api-url").value.trim(), token = $("api-token").value.trim();
      if (!apiConfigured()) { $("settings-msg").textContent = t("api_not_configured"); return; }
      if (!/^https:\/\//.test(url)) { $("settings-msg").textContent = t("settings_https"); return; }
      if (originOf(url) !== ALLOWED_API_ORIGIN) { $("settings-msg").textContent = t("api_origin_refused"); return; }
      if (token.length < 32) { $("settings-msg").textContent = t("settings_token_short"); return; }
      store(KEY.url, url); store(KEY.token, token);
      $("api-token").value = "";
      $("settings-msg").textContent = t("settings_saved");
      refresh(); startPolling();
    });
    $("btn-forget").addEventListener("click", function () {
      unstore(KEY.url); unstore(KEY.token);
      $("api-url").value = ""; $("api-token").value = ""; $("settings-msg").textContent = "";
      setConn("", t("status_unknown"));
    });
    var rl = $("referral-link");
    if (REFERRAL_URL && rl) { rl.href = REFERRAL_URL; $("referral").classList.remove("hidden"); }
  }

  /* ---------- En-tête et réglages d'affichage ---------- */
  function initDisplay() {
    $("btn-theme").addEventListener("click", function () { setTheme(state.theme === "dark" ? "light" : "dark"); });
    $("th-dark").addEventListener("click", function () { setTheme("dark"); });
    $("th-light").addEventListener("click", function () { setTheme("light"); });
    $("btn-lang").addEventListener("click", function () {
      var order = ["fr", "en", "de"]; setLang(order[(order.indexOf(state.lang) + 1) % order.length]);
    });
    ["fr", "en", "de"].forEach(function (l) { $("lg-" + l).addEventListener("click", function () { setLang(l); }); });
    document.querySelectorAll("[data-ccy]").forEach(function (b) {
      b.addEventListener("click", function () { setCcy(b.getAttribute("data-ccy")); });
    });
    $("btn-privacy").addEventListener("click", function () { setPrivate(!document.body.classList.contains("private")); });
    var installBtn = $("btn-install");
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); state.deferred = e; installBtn.style.display = "inline-flex"; });
    installBtn.addEventListener("click", function () {
      if (!state.deferred) return; state.deferred.prompt(); state.deferred = null; installBtn.style.display = "none";
    });
  }

  /* ---------- Démarrage ---------- */
  function init() {
    state.lang = load(KEY.lang) || "fr";
    if (!T[state.lang]) state.lang = "fr";
    state.theme = load(KEY.theme) === "light" ? "light" : "dark";
    state.ccy = load(KEY.ccy) || "USD";
    var r = parseFloat(load(KEY.rate)); if (isFinite(r) && r > 0) state.rateEur = r;
    state.rateDate = load(KEY.rateDate);
    if (load(KEY.priv) === "1") document.body.classList.add("private");

    setTheme(state.theme);
    setCcy(state.ccy);
    applyTranslations();
    state.robot = robotById(load(ROBOT_KEY) || "SYNTIX").id;
    renderRobotTabs(); renderRobotsGrid();
    initDisplay(); initNav(); initConnection(); initSecurity(); initCalendar(); initMenus(); initBacktest();
    $("open-risk").addEventListener("click", function () {
      var hidden = $("panel-risk").classList.toggle("hidden");
      $("open-risk").setAttribute("aria-expanded", String(!hidden));
    });
    openConnectionIfRequested();
    window.addEventListener("hashchange", openConnectionIfRequested);
    refresh(); startPolling();
    refreshRate(false);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !lockOn()) refresh(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  document.addEventListener("DOMContentLoaded", init);
})();
