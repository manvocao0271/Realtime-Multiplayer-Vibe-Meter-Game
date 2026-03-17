// ============================================================
//  MAIN — render() dispatcher + socket event handlers
// ============================================================

// -- Socket Events -------------------------------------------
socket.on('connect', () => render());

socket.on('state', (s) => {
  currentState = s;
  render();
});

socket.on('err', (msg) => showToast(msg, 'error'));

// Live drag positions pushed to observers -- patch mini-dials in-place
socket.on('live-positions', (players) => {
  players.forEach(p => updateMiniDial(p.id, p.value, p.submitted));
});

// Targeted vote update — patches only the affected sp-item without a full re-render
socket.on('suggestion-votes', (data) => {
  // Keep currentState in sync so the next patchSidebar renders correct counts
  const sug = currentState?.phraseSuggestions?.find(s => s.id === data.suggestionId);
  if (sug) Object.assign(sug, {
    yesVotes: data.yesVotes, noVotes: data.noVotes,
    totalVoters: data.totalVoters, myVote: data.myVote,
  });

  const item = document.querySelector(`.sp-item[data-suggestion-id="${data.suggestionId}"]`);
  if (!item) return;

  const counts = item.querySelector('.sp-counts');
  if (counts) {
    counts.textContent = `• ✓ ${data.yesVotes} • ✗ ${data.noVotes} • voters ${data.totalVoters}`;
    counts.classList.remove('sp-counts-flash');
    // Force reflow so re-adding the class restarts the animation
    void counts.offsetWidth;
    counts.classList.add('sp-counts-flash');
  }

  item.querySelector('.sp-vote-btn.yes')?.classList.toggle('active', data.myVote === 'yes');
  item.querySelector('.sp-vote-btn.no')?.classList.toggle('active',  data.myVote === 'no');
});

socket.on('reset', () => {
  currentState = null;
  render();
});

socket.on('disconnect', () => {
  showToast('Disconnected from server.', 'error');
  render();
});

socket.on('connect_error', () => {
  // Keep UI usable even if the socket handshake is delayed/retried.
  render();
});

// -- Render Entry Point --------------------------------------
let _prevPhaseKey   = null;
let _prevSidebarKey = null;

function _onPhaseChange(prevKey) {
  if (!prevKey) return; // skip initial page load
  const s = currentState;
  if (!s) return;
  stopGuessCountdown();
  if (s.phase === 'game-over')          { playSound('gameover');   return; }
  if (s.roundPhase === 'guessing')      { playSound('reveal');     return; }
  if (s.phase === 'phrase-input')       { playSound('phaseStart'); return; }
  if (s.roundPhase === 'phrase-select') { playSound(prevKey?.startsWith('phrase-input') ? 'allPhrasesIn' : 'phaseStart'); return; }
}

function render() {
  const appWrapper = document.getElementById('app-wrapper');
  const app        = document.getElementById('app');
  const sidebar    = document.getElementById('leaderboard-sidebar');

  if (!currentState || !currentState.myName) {
    appWrapper.classList.remove('post-phrase-stage');
    appWrapper.classList.remove('with-sidebar');
    if (sidebar) sidebar.innerHTML = '';
    app.innerHTML = renderJoin();
    attachJoinListeners();
    return;
  }

  appWrapper.classList.toggle(
    'post-phrase-stage',
    currentState.phase === 'playing' || currentState.phase === 'game-over'
  );

  if (currentState.phase === 'playing') {
    appWrapper.classList.add('with-sidebar');
    const sKey = `${currentState.phase}:${currentState.roundPhase || ''}`;
    if (_prevSidebarKey !== sKey) {
      if (sidebar) sidebar.innerHTML = renderLeaderboard();
      attachSidebarListeners();
      _prevSidebarKey = sKey;
    } else {
      patchSidebar();
    }
  } else {
    appWrapper.classList.remove('with-sidebar');
    if (sidebar) sidebar.innerHTML = '';
    _prevSidebarKey = null;
  }

  const _phaseKey = `${currentState.phase}:${currentState.roundPhase || ''}`;
  if (_phaseKey !== _prevPhaseKey) {
    _onPhaseChange(_prevPhaseKey, _phaseKey);
    _prevPhaseKey = _phaseKey;
  }

  switch (currentState.phase) {
    case 'lobby': {
      const lobbyKey = `lobby:${currentState.isHost}`;
      if (lastRenderKey === lobbyKey) {
        patchLobby();
      } else {
        app.innerHTML = renderLobby();
        attachLobbyListeners();
        lastRenderKey = lobbyKey;
      }
      break;
    }
    case 'phrase-input': {
      if (currentState.isSpectator) {
        app.innerHTML = renderSpectator();
        attachSpectatorListeners();
        lastRenderKey = null;
        break;
      }
      // Key encodes the structural state -- only full-render on structural change.
      // Incremental updates (other players submitting) are patched in-place
      // so the input boxes are never destroyed while the user is typing.
      const key = `phrase-input:${currentState.hasSubmittedPhrase ? 'waiting' : 'form'}`;
      if (lastRenderKey === key) {
        patchPhraseInput();
      } else {
        app.innerHTML = renderPhraseInput();
        attachPhraseListeners();
      }
      lastRenderKey = key;
      break;
    }
    case 'playing': {
      // Avoid destroying mini-dial DOM while live positions are streaming in.
      const s = currentState;
      let playKey = null;
      if (s.roundPhase === 'vibe-writing' && !s.isVibeman && !s.isSpectator) {
        playKey = 'playing:guessing:pre';
      } else if (s.roundPhase === 'guessing') {
        playKey = (s.isVibeman || s.isSpectator)
          ? `playing:guessing:observer:${s.totalGuessers}`
          : `playing:guessing:${s.hasSubmittedGuess ? 'post' : 'pre'}`;
      } else if (s.roundPhase === 'round-results') {
        playKey = 'playing:round-results';
      }
      if (playKey && lastRenderKey === playKey) {
        if (s.roundPhase === 'guessing') {
          if (s.isVibeman || s.isSpectator) {
            patchVibeManWaiting();
          } else {
            app.querySelector('[data-screen="vibe-waiting"]')
              ? patchVibeWritingToGuessing()
              : patchGuesserGuessing();
          }
        } else if (s.roundPhase === 'round-results') {
          patchResults();
        }
        // vibe-writing: static screen, skip re-render
      } else {
        renderPlaying(app);
      }
      lastRenderKey = playKey;
      break;
    }
    case 'game-over': {
      const goKey = `game-over:${currentState.isHost}`;
      if (lastRenderKey !== goKey) {
        app.innerHTML = renderGameOver();
        attachGameOverListeners();
        lastRenderKey = goKey;
      }
      break;
    }
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div><p>Loading...</p></div>';
  }
}

// Initial paint: do not leave the static "Connecting..." placeholder on root URL.
render();

// -- Playing Phase Dispatcher --------------------------------
function renderPlaying(app) {
  const s = currentState;

  if (s.isSpectator) {
    switch (s.roundPhase) {
      case 'guessing':
        app.innerHTML = renderVibeManWaiting();
        startGuessCountdown();
        break;
      case 'round-results':
        app.innerHTML = renderResults();
        attachResultsListeners();
        startResultsCountdown();
        break;
      default:
        app.innerHTML = renderSpectator();
        attachSpectatorListeners();
        break;
    }
    return;
  }

  switch (s.roundPhase) {
    case 'phrase-select':
      app.innerHTML = s.isVibeman ? renderPhraseSelect() : renderWaitForPhraseSelect();
      if (s.isVibeman) attachPhraseSelectListeners();
      break;
    case 'vibe-writing':
      app.innerHTML = s.isVibeman ? renderVibeManWrite() : renderGuessing();
      if (s.isVibeman) attachStoryListeners();
      else attachGuessListeners();
      break;
    case 'guessing':
      app.innerHTML = s.isVibeman ? renderVibeManWaiting() : renderGuessing();
      if (!s.isVibeman) attachGuessListeners();
      else startGuessCountdown();
      break;
    case 'round-results':
      app.innerHTML = renderResults();
      attachResultsListeners();
      startResultsCountdown();
      break;
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div></div>';
  }
}
