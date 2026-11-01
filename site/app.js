// YouTubeLess: shows only the videos listed in videos.txt, in a player that cannot link out.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var picker = $('picker'), grid = $('grid'), tabs = $('tabs'), empty = $('empty');
  var playerView = $('player-view'), stage = $('stage'), shield = $('shield');
  var cover = $('cover'), coverImg = $('cover-img'), coverText = $('cover-text');
  var coverPlay = $('cover-play'), coverBack = $('cover-back');
  var btnBack = $('btn-back'), btnPlay = $('btn-play'), btnMute = $('btn-mute'), btnFull = $('btn-full');
  var seek = $('seek'), timeNow = $('time-now'), timeTotal = $('time-total'), nowTitle = $('now-title');

  var data = { siteName: 'My Videos', categories: [] };
  var allowed = {};          // id -> video, the only ids we will ever play
  var activeTab = 0;         // 0 = All
  var player = null, apiReady = null, current = null;
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

  function renderTabs() {
    tabs.innerHTML = '';
    if (data.categories.length < 2) return;
    var names = ['All'].concat(data.categories.map(function (c) { return c.name; }));
    names.forEach(function (name, i) {
      var b = el('button', 'tab', name);
      b.setAttribute('aria-pressed', i === activeTab ? 'true' : 'false');
      b.addEventListener('click', function () { activeTab = i; renderTabs(); renderGrid(); });
      tabs.appendChild(b);
    });
  }

  function renderGrid() {
    grid.innerHTML = '';
    var list = [];
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
    coverImg.style.visibility = '';
    coverImg.onerror = function () { coverImg.style.visibility = 'hidden'; };
    coverImg.src = thumb(id);
    coverPlay.textContent = '▶ Play';
    showCover('Your video is starting…', true);
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
    if (player && player.stopVideo) { try { player.stopVideo(); } catch (e) {} }
    current = null;
    stopTicker();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    playerView.hidden = true;
    picker.hidden = false;
    document.title = data.siteName;
    if (!fromPop && location.hash) history.back();
    load();   // pick up any changes to the list
  }

  function showCover(text, canPlay) {
    coverText.textContent = text;
    coverPlay.hidden = !canPlay;
    cover.hidden = false;
    stage.classList.remove('idle');
  }
  function hideCover() { cover.hidden = true; }

  function onState(e) {
    var S = YT.PlayerState;
    if (e.data === S.PLAYING) {
      // YouTube only reports PLAYING for the real video, never during an ad
      if (wantSound) player.unMute();
      hideCover();
      btnPlay.textContent = '⏸';
      timeTotal.textContent = fmt(player.getDuration());
      wakeControls();
    } else if (e.data === S.PAUSED) {
      btnPlay.textContent = '▶';
      coverPlay.textContent = '▶ Keep watching';
      showCover('Paused', true);
    } else if (e.data === S.ENDED) {
      btnPlay.textContent = '▶';
      coverPlay.textContent = '↻ Watch again';
      showCover('All done! 🎉', true);   // hides YouTube's end screen
    } else if (e.data === S.UNSTARTED) {
      // an ad (or the video loading): keep it silent and hidden
      player.mute();
      coverPlay.textContent = '▶ Play';
      showCover('Your video is starting…', true);
    } else if (e.data === S.CUED) {
      coverPlay.textContent = '▶ Play';
      showCover(current ? current.title : '', true);
    }
  }

  function togglePlay() {
    if (!player || !player.getPlayerState) return;
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

  load().then(function () {
    var m = /#v=([A-Za-z0-9_-]{11})/.exec(location.hash);
    if (m && allowed[m[1]]) openVideo(m[1], false);
    else if (location.hash) history.replaceState(null, '', location.pathname);
  });
})();
