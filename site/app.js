// YouTubeLess: shows only the videos listed in videos.txt, in a player that cannot link out.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var picker = $('picker'), grid = $('grid'), empty = $('empty');
  var playerView = $('player-view'), stage = $('stage'), shield = $('shield');
  var cover = $('cover'), coverText = $('cover-text');
  var coverPlay = $('cover-play'), coverBack = $('cover-back');
  var btnBack = $('btn-back'), btnPlay = $('btn-play'), btnMute = $('btn-mute'), btnFull = $('btn-full');
  var seek = $('seek'), timeNow = $('time-now'), timeTotal = $('time-total'), nowTitle = $('now-title');

  var data = { siteName: 'My Videos', categories: [] };
  var allowed = {};          // id -> video, the only ids we will ever play
  var player = null, apiReady = null, current = null;
  var facts = [];            // loaded from facts.json (built from facts.txt)
  var started = false;       // has the real video been started yet?
  var viewFact = '';         // the fact chosen for this view (with its [answer|wrong|wrong] quiz)
  var quizDone = false;      // has he answered this view's Fun Fact question?
  var videoReady = false;    // YouTube is ready to play the real video (any ad is over)
  var quizTimer = null;
  // Ads in the middle of a video: YouTube may keep saying PLAYING, so we watch for the video's
  // clock stopping, or its length changing (the ad's length), and cover + mute until it moves on.
  var midAd = false, lastT = -1, stillSince = 0, contentDur = 0, MIDAD_STILL_MS = 1500;
  var fallbackTimer = null;
  var wantSound = true;      // the Sound button; ads are always silenced regardless
  var ticker = null, idleTimer = null, seeking = false;

  // ---------- helpers ----------
  function thumb(id) { return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var ss = (sec < 10 ? '0' : '') + sec;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- picker: a rotating line-up of 10 ----------
  // All videos sit in one long queue, mixed across groups. The home screen shows
  // SHOW_COUNT of them. A shown video stays until he watches it; a watched video
  // goes to the back of the queue, so everything else gets shown before it again.
  var SHOW_COUNT = 10;
  var LINEUP_KEY = 'ytl-lineup', HISTORY_KEY = 'ytl-history';
  var lineup = { queue: [], shown: [] };
  var history_ = {};         // id -> { t, g, views, secs, dur, far, first, last }
  var groupOf = {};          // id -> group name

  function readJSON(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : dflt; }
    catch (e) { return dflt; }
  }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Round-robin across groups so any run of the queue has a bit of everything.
  function mixed(ids) {
    var byGroup = {}, order = [];
    ids.forEach(function (id) {
      var g = groupOf[id];
      if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
      byGroup[g].push(id);
    });
    order.forEach(function (g) { shuffle(byGroup[g]); });
    shuffle(order);
    var out = [], more = true;
    for (var r = 0; more; r++) {
      more = false;
      order.forEach(function (g) { if (r < byGroup[g].length) { out.push(byGroup[g][r]); more = true; } });
    }
    return out;
  }

  function syncLineup() {
    lineup = readJSON(LINEUP_KEY, { queue: [], shown: [] });
    history_ = readJSON(HISTORY_KEY, {});
    var queue = (lineup.queue || []).filter(function (id) { return allowed[id]; });
    var inQueue = {};
    queue.forEach(function (id) { inQueue[id] = true; });
    // Videos added to the list since last time go in front of anything already watched.
    var fresh = mixed(Object.keys(allowed).filter(function (id) { return !inQueue[id]; }));
    if (fresh.length) {
      var at = queue.length;
      for (var i = 0; i < queue.length; i++) { if (history_[queue[i]]) { at = i; break; } }
      queue = queue.slice(0, at).concat(fresh, queue.slice(at));
    }
    var shown = (lineup.shown || []).filter(function (id) { return allowed[id]; });
    var isShown = {};
    shown.forEach(function (id) { isShown[id] = true; });
    // Fill empty spots from the front of the queue, preferring groups not on screen yet.
    function fill(preferNew) {
      for (var i = 0; i < queue.length && shown.length < SHOW_COUNT; i++) {
        var id = queue[i];
        if (isShown[id]) continue;
        if (preferNew && shown.some(function (s) { return groupOf[s] === groupOf[id]; })) continue;
        shown.push(id); isShown[id] = true;
      }
    }
    fill(true); fill(false);
    // Remember when each group first appeared, so the 14-day clock has a fair start.
    var seen = lineup.seen || {};
    data.categories.forEach(function (c) { if (!seen[c.name]) seen[c.name] = Date.now(); });
    var must = lineup.must && allowed[lineup.must.id] ? lineup.must : null;
    lineup = { queue: queue, shown: shown, seen: seen, must: must };
    pickRequired();
    writeJSON(LINEUP_KEY, lineup);
  }

  // ---------- the 14-day rule ----------
  // If no video from a group has been watched all the way through for 14 days, home shows
  // just one video from that group until he watches it in full. Full = reached the end with
  // at least 90% of it actually played (so jumping to the end does not count).
  var OVERDUE_MS = 14 * 24 * 3600 * 1000, FULL_SHARE = 0.9;
  function lastFull(group) {
    var t = lineup.seen[group] || Date.now();
    Object.keys(history_).forEach(function (id) {
      var h = history_[id];
      if ((groupOf[id] || h.g) === group && h.fullAt && h.fullAt > t) t = h.fullAt;
    });
    return t;
  }
  function pickRequired() {
    if (lineup.must) { writeJSON(LINEUP_KEY, lineup); return; }
    var worst = null, worstT = Date.now() - OVERDUE_MS;
    data.categories.forEach(function (c) {
      var t = lastFull(c.name);
      if (t < worstT) { worst = c.name; worstT = t; }
    });
    if (worst) {
      // Next video of that group in the queue (one already on screen is fine too).
      for (var i = 0; i < lineup.queue.length; i++) {
        if (groupOf[lineup.queue[i]] === worst) { lineup.must = { id: lineup.queue[i], group: worst }; break; }
      }
    }
    writeJSON(LINEUP_KEY, lineup);
  }
  function finishedInFull(id) {
    var h = history_[id];
    if (!h) return;
    h.done = (h.done || 0) + 1;
    if (h.dur && h.viewSecs >= h.dur * FULL_SHARE) {
      h.full = (h.full || 0) + 1;
      h.fullAt = Date.now();
      if (lineup.must && lineup.must.id === id) { lineup.must = null; pickRequired(); }
    }
    writeJSON(HISTORY_KEY, history_);
  }

  // He started watching: take it off the screen and send it to the back of the queue.
  function markWatched(id) {
    lineup.shown = lineup.shown.filter(function (s) { return s !== id; });
    lineup.queue = lineup.queue.filter(function (s) { return s !== id; }).concat([id]);
    writeJSON(LINEUP_KEY, lineup);
    var h = history_[id] || { views: 0, secs: 0, far: 0, first: Date.now() };
    h.t = allowed[id].title; h.g = groupOf[id];
    h.views += 1; h.last = Date.now(); h.viewSecs = 0;
    history_[id] = h;
    writeJSON(HISTORY_KEY, history_);
  }
  var unsaved = 0;
  function addWatchTime(id, secs, pos, dur) {
    var h = history_[id];
    if (!h) return;
    h.secs = Math.round(((h.secs || 0) + secs) * 10) / 10;
    h.viewSecs = (h.viewSecs || 0) + secs;   // this viewing only
    if (pos > (h.far || 0)) h.far = Math.round(pos);
    if (dur) h.dur = Math.round(dur);
    unsaved += secs;
    if (unsaved >= 5) { unsaved = 0; writeJSON(HISTORY_KEY, history_); }
  }

  function load() {
    return fetch('videos.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        data = d || data;
        data.categories = data.categories || [];
        allowed = {}; groupOf = {};
        data.categories.forEach(function (c) {
          (c.videos || []).forEach(function (v) { allowed[v.id] = v; groupOf[v.id] = c.name; });
        });
        document.title = data.siteName;
        $('site-name').textContent = data.siteName;
        syncLineup();
        renderGrid();
      })
      .catch(function () {
        grid.innerHTML = '';
        empty.hidden = false;
        empty.textContent = 'Could not load the video list. Check the internet and try again.';
      });
  }

  function renderGrid() {
    grid.innerHTML = '';
    var must = lineup.must, note = $('must-note');
    grid.classList.toggle('single', !!must);
    if (note) note.hidden = !must;
    if (note && must) note.textContent = 'Time for some ' + must.group + '! Watch this whole video, then you can pick from everything again.';
    var list = (must ? [must.id] : lineup.shown).map(function (id) { return allowed[id]; });
    empty.hidden = list.length > 0;
    if (!list.length) empty.textContent = 'No videos yet. Ask a grown-up to add some!';
    list.forEach(function (v) {
      var card = el('button', 'card');
      var img = el('img');
      img.src = thumb(v.id);
      img.alt = '';
      img.draggable = false;
      img.onerror = function () { img.style.visibility = 'hidden'; };
      card.appendChild(img);
      card.appendChild(el('span', null, v.title));
      card.addEventListener('click', function () { openVideo(v.id, true); });
      grid.appendChild(card);
    });
  }

  // ---------- YouTube API ----------
  function loadApi() {
    if (apiReady) return apiReady;
    apiReady = new Promise(function (resolve, reject) {
      window.onYouTubeIframeAPIReady = resolve;
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return apiReady;
  }

  function makePlayer(id) {
    return new YT.Player('yt', {
      host: 'https://www.youtube-nocookie.com',   // privacy-enhanced mode
      videoId: id,
      playerVars: {
        autoplay: 1,
        controls: 0,          // we draw our own controls
        rel: 0,               // no suggestions from other channels
        fs: 0,                // our own full screen keeps the click shield in place
        disablekb: 1,
        iv_load_policy: 3,    // no annotations
        playsinline: 1,
        enablejsapi: 1,
        origin: location.origin
      },
      events: {
        onReady: function (e) {
          var f = e.target.getIframe();
          f.setAttribute('tabindex', '-1');
          e.target.mute();        // stay silent until the real video starts (ads play first)
          e.target.playVideo();
          updateMute();
        },
        onStateChange: onState,
        onError: function () {
          // If the required video won't play, swap in another from the same group.
          if (current && lineup.must && lineup.must.id === current.id) {
            var bad = current.id;
            lineup.queue = lineup.queue.filter(function (q) { return q !== bad; }).concat([bad]);
            lineup.must = null;
            pickRequired();
          }
          showCover("Oops! This video can't play here.", false);
        }
      }
    });
  }

  // ---------- player view ----------
  window.addEventListener('pagehide', function () { writeJSON(HISTORY_KEY, history_); sendLog(); });

  function openVideo(id, push) {
    if (!allowed[id]) return;   // never play anything that is not on the list
    if (lineup.must && lineup.must.id !== id) return;   // the required video comes first
    current = allowed[id];
    if (push) history.pushState({ v: id }, '', '#v=' + id);
    picker.hidden = true;
    playerView.hidden = false;
    nowTitle.textContent = current.title;
    document.title = current.title;
    started = false;
    quizDone = false;
    videoReady = false;
    midAd = false; lastT = -1; stillSince = 0; contentDur = 0;
    viewFact = nextFact();
    clearTimeout(quizTimer);
    quizRead(false);
    clearTimeout(fallbackTimer);
    // If YouTube never reports the video as ready, offer a button once the quiz is done
    fallbackTimer = setInterval(function () { if (!started && quizDone) { clearInterval(fallbackTimer); showContinue(); } }, 45000);
    seek.value = 0;
    timeNow.textContent = '0:00';
    timeTotal.textContent = '0:00';
    window.scrollTo(0, 0);

    loadApi().then(function () {
      if (!current || current.id !== id) return;
      if (!player) player = makePlayer(id);
      else if (player.loadVideoById) { player.mute(); player.loadVideoById(id); }
    }).catch(function () {
      showCover("Can't reach YouTube right now. Check the internet and try again.", false);
    });
    startTicker();
    wakeControls();
  }

  function closeVideo(fromPop) {
    sendLog();
    if (player && player.stopVideo) { try { player.stopVideo(); } catch (e) {} }
    current = null;
    clearTimeout(fallbackTimer);
    stopTicker();
    writeJSON(HISTORY_KEY, history_);
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    playerView.hidden = true;
    picker.hidden = false;
    document.title = data.siteName;
    if (!fromPop && location.hash) history.back();
    load();   // pick up any changes to the list
  }

  // ---------- daily fact ----------
  function loadFacts() {
    return fetch('facts.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (f) { if (Array.isArray(f)) facts = f; })
      .catch(function () {});
  }

  // A new fact for every video. A counter saved in this browser walks through the
  // list in steps of a large prime, which mixes the topics and still shows every
  // fact once before any repeats.
  function nextFact() {
    var n = facts.length;
    if (!n) return '';
    var k = null;
    try { k = parseInt(localStorage.getItem('ytl-fact-count'), 10); } catch (e) {}
    if (!(k >= 0)) k = Math.floor(Math.random() * n);
    try { localStorage.setItem('ytl-fact-count', String(k + 1)); } catch (e) {}
    var step = 7919;
    while (gcd(step, n) !== 1) step++;
    return facts[(k * step) % n];
  }
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  // ---------- Fun Fact quiz ----------
  // While the video loads (and any ad plays, muted and covered) he reads a fact. Then one
  // word disappears and he must tap the right one of three. Only then does the Skip corner
  // open (during an ad) or the video start (no ad, or the ad already ended). A wrong answer
  // shows the fact again. Facts mark the quiz word like [right|wrong|wrong].
  var QUIZ_RE = /\[([^\]|]+)\|([^\]|]+)\|([^\]]+)\]/;
  function plainFact(f) { return f.replace(QUIZ_RE, '$1'); }
  function setAdWindow(on) { stage.classList.toggle('ad-window', on); }
  function readMs(f) { return Math.min(14000, Math.max(5000, plainFact(f).split(/\s+/).length * 450)); }

  function showFactCover() {
    if (!viewFact) viewFact = nextFact();   // facts may have loaded after the video opened
    $('fact').hidden = !viewFact;
    coverPlay.hidden = true;
    coverBack.hidden = true;   // the Home button is in the top bar; keeps the Skip corner clear
    cover.hidden = false;
    stage.classList.remove('idle');
  }

  // Step 1: the whole fact, for long enough to read it.
  function quizRead(again) {
    clearTimeout(quizTimer);
    setAdWindow(false);
    showFactCover();
    $('quiz-choices').hidden = true;
    $('fact-text').textContent = plainFact(viewFact);
    coverText.className = 'small';
    if (!QUIZ_RE.test(viewFact)) { coverText.textContent = ''; quizRight(); return; }
    coverText.textContent = again ? 'Not quite! Read it again…' : 'Read it! A question is coming…';
    quizTimer = setTimeout(quizAsk, readMs(viewFact));
  }

  // Step 2: the fact with a blank, and three words to pick from.
  function quizAsk() {
    var m = QUIZ_RE.exec(viewFact);
    var blank = viewFact.replace(QUIZ_RE, '_____');
    $('fact-text').textContent = blank;
    coverText.textContent = 'Which word goes in the blank?';
    var box = $('quiz-choices');
    box.innerHTML = '';
    shuffle([m[1], m[2], m[3]]).forEach(function (word) {
      var b = el('button', 'big-btn quiz-btn', word);
      b.addEventListener('click', function () {
        if (word === m[1]) quizRight();
        else { b.classList.add('wrong'); box.style.pointerEvents = 'none';
          setTimeout(function () { box.style.pointerEvents = ''; quizRead(true); }, 700); }
      });
      box.appendChild(b);
    });
    box.hidden = false;
  }

  function quizRight() {
    clearTimeout(quizTimer);
    quizDone = true;
    $('quiz-choices').hidden = true;
    $('fact-text').textContent = plainFact(viewFact);
    if (videoReady) { continueToVideo(); return; }
    // An ad is probably still playing: now he may tap YouTube's Skip.
    coverText.textContent = QUIZ_RE.test(viewFact) ? '✓ Yes! Now tap Skip when it shows up.' : 'Your video is coming up…';
    setAdWindow(true);
  }

  // Shown only if YouTube never says it's ready (45 s after the quiz is done).
  function showContinue() {
    setAdWindow(false);
    showFactCover();
    coverText.textContent = '';
    coverPlay.textContent = '▶ Continue to video';
    coverPlay.hidden = false;
  }

  function beginWatching() {
    started = true;
    if (current) { markWatched(current.id); logView = { id: current.id, finished: false, sent: false }; }
  }

  // ---------- watch log (Google Form in Dev's account) ----------
  // One row per viewing, sent when he leaves the video (or the page). The form only takes
  // new rows; it can't be read from here. Empty LOG_FORM = logging off.
  var LOG_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSdEmRuFkhTUsRYBWr4lzgOh9hpeyDXqINFpn26le8Y_eXLo9w/formResponse';
  var LOG_FIELD = 'entry.637870952';
  var logView = null;
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function sendLog() {
    var v = logView;
    if (!v || v.sent) return;
    v.sent = true;
    var h = history_[v.id];
    if (!LOG_FORM || !h) return;
    var d = new Date();
    var line = [
      d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()),
      h.g, h.t, v.id,
      'watched ' + fmt(h.viewSecs) + ' of ' + fmt(h.dur || 0),
      'furthest ' + fmt(h.far || 0),
      v.finished ? 'finished' : 'not finished'
    ].join(' | ');
    var body = new URLSearchParams();
    body.set(LOG_FIELD, line);
    var ok = false;
    try { ok = navigator.sendBeacon && navigator.sendBeacon(LOG_FORM, body); } catch (e) {}
    if (!ok) { try { fetch(LOG_FORM, { method: 'POST', mode: 'no-cors', body: body, keepalive: true }); } catch (e) {} }
  }

  function continueToVideo() {
    if (!player || !player.playVideo) return;
    beginWatching();
    clearTimeout(fallbackTimer);
    showCover('Starting…', false);
    if (wantSound) player.unMute();   // the button press lets the browser play sound
    player.playVideo();
  }

  function showCover(text, canPlay) {
    setAdWindow(false);
    $('fact').hidden = true;
    coverText.className = '';
    coverText.textContent = text;
    coverPlay.hidden = !canPlay;
    coverBack.hidden = false;
    cover.hidden = false;
    stage.classList.remove('idle');
  }
  function hideCover() { cover.hidden = true; setAdWindow(false); }

  function onState(e) {
    var S = YT.PlayerState;
    if (e.data === S.PLAYING) {
      // YouTube only reports PLAYING for the real video, never during an ad.
      // After an ad (skipped or finished) the video just starts: one tap is enough.
      // With no ad, hold it on the fact screen until he presses Continue.
      // An ad never reports PLAYING, so this is the real video. It waits for the quiz.
      if (!started && quizDone) { beginWatching(); clearInterval(fallbackTimer); }
      if (!started) {
        videoReady = true;
        player.pauseVideo();
        player.mute();
        return;
      }
      btnPlay.textContent = '⏸';
      if (midAd) return;   // the ticker lifts the cover once the video's clock moves again
      if (wantSound) player.unMute();
      hideCover();
      timeTotal.textContent = fmt(player.getDuration());
      wakeControls();
    } else if (e.data === S.PAUSED) {
      btnPlay.textContent = '▶';
      if (!started) return;   // we paused it ourselves to show the Continue button
      coverPlay.textContent = '▶ Keep watching';
      showCover('Paused', true);
    } else if (e.data === S.ENDED) {
      btnPlay.textContent = '▶';
      if (started && current) {   // he reached the very end
        finishedInFull(current.id);
        var hh = history_[current.id];
        if (logView && hh && hh.dur && hh.viewSecs >= hh.dur * FULL_SHARE) logView.finished = true;
        sendLog();
      }
      coverPlay.textContent = '↻ Watch again';
      showCover('All done! 🎉', true);   // hides YouTube's end screen
    } else if (e.data === S.UNSTARTED) {
      // an ad (or the video loading): keep it silent and hidden
      player.mute();
      if (!started) return;   // the quiz screen stays up
      else if (!midAd) startMidAd();
    } else if (e.data === S.CUED) {
      if (!started) { videoReady = true; if (quizDone) showContinue(); }
      else { coverPlay.textContent = '▶ Play'; showCover(current ? current.title : '', true); }
    }
  }

  function togglePlay() {
    if (!player || !player.getPlayerState) return;
    if (!started) { if (!coverPlay.hidden) continueToVideo(); return; }
    var st = player.getPlayerState();
    if (st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING) player.pauseVideo();
    else if (st === YT.PlayerState.ENDED) { player.seekTo(0, true); player.playVideo(); }
    else player.playVideo();
  }

  function updateMute() { btnMute.textContent = wantSound ? '🔊' : '🔇'; }

  function startTicker() {
    stopTicker();
    ticker = setInterval(function () {
      if (!player || !player.getCurrentTime || seeking) return;
      var d = player.getDuration() || 0, t = player.getCurrentTime() || 0;
      timeNow.textContent = fmt(t);
      if (d) { timeTotal.textContent = fmt(d); seek.value = Math.round((t / d) * 1000); }
      if (started && current && player.getPlayerState) {
        var st = player.getPlayerState(), P = YT.PlayerState;
        var running = st === P.PLAYING || st === P.BUFFERING || st === P.UNSTARTED;
        var moved = Math.abs(t - lastT) > 0.05;
        if (!contentDur && d && moved && !midAd) contentDur = d;
        var otherLength = contentDur && d && Math.abs(d - contentDur) > 1;
        if (running && !moved) { if (!stillSince) stillSince = Date.now(); }
        else stillSince = 0;
        if (!midAd && running && (otherLength || (stillSince && Date.now() - stillSince > MIDAD_STILL_MS))) startMidAd();
        else if (midAd && moved && !otherLength && st === P.PLAYING) endMidAd();
        if (st === P.PLAYING && moved && !midAd) addWatchTime(current.id, 0.25, t, contentDur || d);
        lastT = t;
      }
    }, 250);
  }
  function startMidAd() {
    midAd = true;
    player.mute();
    showCover('Your video will be right back…', false);
    setAdWindow(true);   // he can still tap Skip in the corner
  }
  function endMidAd() {
    midAd = false;
    stillSince = 0;
    if (wantSound) player.unMute();
    hideCover();
    wakeControls();
  }
  function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }

  function wakeControls() {
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (cover.hidden) stage.classList.add('idle');
    }, 3000);
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
  }

  // ---------- wiring ----------
  shield.addEventListener('click', function () { togglePlay(); wakeControls(); });
  shield.addEventListener('dblclick', toggleFull);
  stage.addEventListener('mousemove', wakeControls);
  stage.addEventListener('touchstart', wakeControls, { passive: true });
  btnPlay.addEventListener('click', togglePlay);
  coverPlay.addEventListener('click', togglePlay);
  btnBack.addEventListener('click', function () { closeVideo(false); });
  $('home-btn').addEventListener('click', function () { closeVideo(false); });
  coverBack.addEventListener('click', function () { closeVideo(false); });
  btnFull.addEventListener('click', toggleFull);
  btnMute.addEventListener('click', function () {
    if (!player || !player.mute) return;
    wantSound = !wantSound;
    if (wantSound && player.getPlayerState() === YT.PlayerState.PLAYING) player.unMute(); else player.mute();
    updateMute();
  });
  seek.addEventListener('input', function () { seeking = true; });
  seek.addEventListener('change', function () {
    if (player && player.getDuration) player.seekTo((seek.value / 1000) * player.getDuration(), true);
    seeking = false;
  });

  document.addEventListener('keydown', function (e) {
    if (playerView.hidden) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); wakeControls(); }
    else if (e.key === 'f') toggleFull();
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });

  window.addEventListener('popstate', function () {
    var m = /#v=([A-Za-z0-9_-]{11})/.exec(location.hash);
    if (m && allowed[m[1]]) openVideo(m[1], false);
    else if (!playerView.hidden) closeVideo(true);
  });

  loadFacts();
  load().then(function () {
    var m = /#v=([A-Za-z0-9_-]{11})/.exec(location.hash);
    if (m && allowed[m[1]]) openVideo(m[1], false);
    else if (location.hash) history.replaceState(null, '', location.pathname);
  });
})();
