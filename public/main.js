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

// Live drag positions pushed only to the Vibe Man -- patch mini-dials in-place
socket.on('live-positions', (players) => {
  players.forEach(p => updateMiniDial(p.id, p.value, p.submitted));
});

socket.on('reset', () => {
  currentState = null;
  render();
});

socket.on('disconnect', () => {
  showToast('Disconnected from server.', 'error');
});

// -- Render Entry Point --------------------------------------
function render() {
  const appWrapper = document.getElementById('app-wrapper');
  const app        = document.getElementById('app');
  const meta       = document.getElementById('header-meta');

  if (!currentState || !currentState.myName) {
    meta.innerHTML = '';
    appWrapper.classList.remove('with-sidebar');
    app.innerHTML = renderJoin();
    attachJoinListeners();
    return;
  }

  if (currentState.phase === 'playing') {
    appWrapper.classList.add('with-sidebar');
    document.getElementById('leaderboard-sidebar').innerHTML = renderLeaderboard();
  } else {
    appWrapper.classList.remove('with-sidebar');
  }

  meta.innerHTML = `
    <span class="player-badge">${esc(currentState.myName)}</span>
    ${currentState.isSpectator ? '<span class="badge badge-yellow" style="font-size:0.75rem;">Spectating</span>' : ''}
  `;

  switch (currentState.phase) {
    case 'lobby':
      lastRenderKey = null;
      app.innerHTML = renderLobby();
      attachLobbyListeners();
      break;
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
      if (!s.isSpectator) {
        if (s.roundPhase === 'vibe-writing' && !s.isVibeman) {
          playKey = 'playing:vibe-writing';
        } else if (s.roundPhase === 'guessing') {
          playKey = s.isVibeman
            ? `playing:guessing:vibe-man:${s.totalGuessers}`
            : `playing:guessing:${s.hasSubmittedGuess ? 'post' : 'pre'}`;
        }
      }
      if (playKey && lastRenderKey === playKey) {
        if (s.roundPhase === 'guessing') {
          s.isVibeman ? patchVibeManWaiting() : patchGuesserGuessing();
        }
        // vibe-writing: static screen, skip re-render
      } else {
        renderPlaying(app);
      }
      lastRenderKey = playKey;
      break;
    }
    case 'game-over':
      lastRenderKey = null;
      app.innerHTML = renderGameOver();
      attachGameOverListeners();
      break;
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div><p>Loading...</p></div>';
  }
}

// -- Playing Phase Dispatcher --------------------------------
function renderPlaying(app) {
  const s = currentState;

  if (s.isSpectator) {
    app.innerHTML = renderSpectator();
    attachSpectatorListeners();
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
      break;
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div></div>';
  }
}
