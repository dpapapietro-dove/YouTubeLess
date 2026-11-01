// YouTubeLess: shows only the videos listed in videos.txt, in a player that cannot link out.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var picker = $('picker'), grid = $('grid'), tabs = $('tabs'), empty = $('empty');
  var playerView = $('player-view'), stage = $('stage'), shield = $('shield');
  var cover = $('cover'), coverText = $('cover-text');
  var coverPlay = $('cover-play'), coverBack = $('cover-back');
  var btnBack = $('btn-back'), btnPlay = $('btn-play'), btnMute = $('btn-mute'), btnFull = $('btn-full');
  var seek = $('seek'), timeNow = $('time-now'), timeTotal = $('time-total'), nowTitle = $('now-title');

  var data = { siteName: 'My Videos', categories: [] };
  var allowed = {};          // id -> video, the only ids we will ever play
  var activeTab = 0;         // 0 = All
  var player = null, apiReady = null, current = null;
  var facts = [];            // loaded from facts.json (built from facts.txt)
  var started = false;       // has the real video been started yet?
  var adSeen = false;        // did an ad play (or did he tap Skip) before the video?
  var loadStart = 0;         // when we asked YouTube for the video
  var viewFact = '';         // the fact chosen for this view
  var AD_GUESS_MS = 6000;    // ready later than this after loading means an ad played first
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

  // ---------- picker ----------
  function load() {
    return fetch('videos.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        data = d || data;
        data.categories = data.categories || [];
        allowed = {};
        data.categories.forEach(function (c) { (c.videos || []).forEach(function (v) { allowed[v.id] = v; }); });
        document.title = data.siteName;
        $('site-name').textContent = data.siteName;
        if (activeTab > data.categories.length) activeTab = 0;
        renderTabs();
        renderGrid();
      })
      .catch(function () {
        grid.innerHTML = '';
        empty.hidden = false;
        empty.textContent = 'Could not load the video list. Check the internet and try again.';
      });
  }

  // With a long list, skip the "All" tab and open on the first group, so the page stays quick.
  function showAll() {
    var n = 0;
    data.categories.forEach(function (c) { n += (c.videos || []).length; });
    return n <= 150;
  }

  function renderTabs() {
    if (!showAll() && activeTab === 0 && data.categories.length) activeTab = 1;
    tabs.innerHTML = '';
    if (data.categories.length < 2) return;
    var names = (showAll() ? ['All'] : ['']).concat(data.categories.map(function (c) { return c.name; }));
    names.forEach(function (name, i) {
      if (!name) return;
      var b = el('button', 'tab', name);
      b.setAttribute('aria-pressed', i === activeTab ? 'true' : 'false');
      b.addEventListener('click', function () { activeTab = i; renderTabs(); renderGrid(); });
      tabs.appendChild(b);
    });
  }

  function renderGrid() {
    grid.innerHTML = '';
    var list = [];
    if (!showAll() && activeTab === 0 && data.categories.length) activeTab = 1;
    if (activeTab === 0) data.categories.forEach(function (c) { list = list.concat(c.videos || []); });
    else list = data.categories[activeTab - 1].videos || [];
    empty.hidden = list.length > 0;
    if (!list.length) empty.textContent = 'No videos yet. Ask a grown-up to add some!';
    list.forEach(function (v) {
      var card = el('button', 'card');
      var img = el('img');
      img.src = thumb(v.id);
      img.alt = '';
      img.loading = 'lazy';
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
          showCover("Oops! This video can't play here.", false);
        }
      }
    });
  }

  // ---------- player view ----------
  function openVideo(id, push) {
    if (!allowed[id]) return;   // never play anything that is not on the list
    current = allowed[id];
    if (push) history.pushState({ v: id }, '', '#v=' + id);
    picker.hidden = true;
    playerView.hidden = false;
    nowTitle.textContent = current.title;
    document.title = current.title;
    started = false;
    adSeen = false;
    loadStart = Date.now();
    viewFact = nextFact();
    showWaiting(false);
    clearTimeout(fallbackTimer);
    // If YouTube never reports the video as ready, offer the button anyway after a while
    fallbackTimer = setTimeout(function () { if (!started) showWaiting(true); }, 45000);
    seek.value = 0;
    timeNow.textContent = '0:00';
    timeTotal.textContent = '0:00';
    window.scrollTo(0, 0);

    loadApi().then(function () {
      if (!current || current.id !== id) return;
      loadStart = Date.now();
      if (!player) player = makePlayer(id);
      else if (player.loadVideoById) { player.mute(); player.loadVideoById(id); }
    }).catch(function () {
      showCover("Can't reach YouTube right now. Check the internet and try again.", false);
    });
    startTicker();
    wakeControls();
  }

  function closeVideo(fromPop) {
    if (player && player.stopVideo) { try { player.stopVideo(); } catch (e) {} }
    current = null;
    clearTimeout(fallbackTimer);
    stopTicker();
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

  // The fact screen shown while an ad plays. The button appears only once the video is ready.
  // During an ad, open a see-through corner so he can tap YouTube's Skip button.
  function setAdWindow(on) { stage.classList.toggle('ad-window', on); }

  function showWaiting(ready) {
    setAdWindow(!ready);
    if (!viewFact) viewFact = nextFact();   // facts may have loaded after the video opened
    var fact = viewFact;
    $('fact-text').textContent = fact;
    $('fact').hidden = !fact;
    coverText.textContent = ready ? '' : 'Your video is coming up…';
    coverText.className = 'small';
    coverPlay.textContent = '▶ Continue to video';
    coverPlay.hidden = !ready;
    coverBack.hidden = false;
    cover.hidden = false;
    stage.classList.remove('idle');
  }

  function continueToVideo() {
    if (!player || !player.playVideo) return;
    started = true;
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
      if (!started && (adSeen || Date.now() - loadStart > AD_GUESS_MS)) {
        started = true;
        clearTimeout(fallbackTimer);
      }
      if (!started) {
        player.pauseVideo();
        player.mute();
        showWaiting(true);
        return;
      }
      if (wantSound) player.unMute();
      hideCover();
      btnPlay.textContent = '⏸';
      timeTotal.textContent = fmt(player.getDuration());
      wakeControls();
    } else if (e.data === S.PAUSED) {
      btnPlay.textContent = '▶';
      if (!started) return;   // we paused it ourselves to show the Continue button
      coverPlay.textContent = '▶ Keep watching';
      showCover('Paused', true);
    } else if (e.data === S.ENDED) {
      btnPlay.textContent = '▶';
      coverPlay.textContent = '↻ Watch again';
      showCover('All done! 🎉', true);   // hides YouTube's end screen
    } else if (e.data === S.UNSTARTED) {
      // an ad (or the video loading): keep it silent and hidden
      player.mute();
      if (!started) showWaiting(false);
      else { showCover('Your video will be right back…', false); setAdWindow(true); }
    } else if (e.data === S.CUED) {
      if (!started) showWaiting(true);
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
    }, 250);
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

  // A tap inside the Skip corner moves focus into YouTube's player, which blurs our page.
  window.addEventListener('blur', function () {
    setTimeout(function () {
      if (stage.classList.contains('ad-window') && document.activeElement &&
          document.activeElement.tagName === 'IFRAME') {
        adSeen = true;
      }
    }, 0);
  });

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
