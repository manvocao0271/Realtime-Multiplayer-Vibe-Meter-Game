// ============================================================
//  SCREEN: Join
// ============================================================

function renderJoin() {
  const gameInProgress = currentState && currentState.phase !== 'lobby' && !currentState.myName;
  const hasDisconnected = currentState?.players?.some(p => p.disconnected);
  const prefilledName = myName.trim().toLowerCase();
  const isRejoin = hasDisconnected && prefilledName &&
    currentState.players.some(p => p.disconnected && p.name.toLowerCase() === prefilledName);
  const btnLabel = isRejoin ? 'Rejoin Session' : gameInProgress ? 'Join as Spectator' : 'Join Game';

  return `
    <div class="screen-shell screen-shell-centered fade-in">
      <div class="screen-shell-inner screen-shell-inner-compact">
        <div class="phase-hero screen-hero-tight">
          <span class="emoji-big">&#127919;</span>
          <h1 class="gradient-text">Vibe Meter</h1>
          <p>The party game where vibes speak louder than words.</p>
        </div>

        <div class="card join-card" id="join-card">
          ${gameInProgress ? `
            <div class="callout ${isRejoin ? 'callout-success' : 'callout-warning'}" style="margin-bottom:1rem;" id="join-callout">
              ${ isRejoin
                ? '<div class="callout-title">Welcome back!</div><p>Rejoin with your saved score.</p>'
                : '<div class="callout-title">Game in progress</div><p>You will spectate and submit a phrase to join on the next round.</p>'
              }
            </div>
          ` : ''}
          <div class="form-group">
            <label for="name-input">Your Name</label>
            <input type="text" id="name-input" placeholder="Enter your name..." maxlength="10"
                   value="${esc(myName)}" autocomplete="off" autocorrect="off" spellcheck="false" />
          </div>
          <button class="btn btn-primary btn-full btn-lg" id="join-btn" style="margin-top:1rem;">
            ${btnLabel}
          </button>
          <p style="font-size:0.8rem;margin-top:0.75rem;text-align:center;">
            The <strong>first person</strong> to join becomes the host.
          </p>
        </div>
      </div>
    </div>
  `;
}

function attachJoinListeners() {
  const input = document.getElementById('name-input');
  const btn   = document.getElementById('join-btn');
  if (!input || !btn) return;

  input.focus();

  const gameInProgress = currentState && currentState.phase !== 'lobby';

  function updateJoinUI() {
    const name = input.value.trim().toLowerCase();
    const rejoining = !!(gameInProgress &&
      currentState?.players?.some(p => p.disconnected && p.name.toLowerCase() === name));
    btn.textContent = rejoining ? 'Rejoin Session' : gameInProgress ? 'Join as Spectator' : 'Join Game';
    const callout = document.getElementById('join-callout');
    if (callout) {
      if (rejoining) {
        callout.className = 'callout callout-success';
        callout.innerHTML = '<div class="callout-title">Welcome back!</div><p>Rejoin with your saved score.</p>';
      } else {
        callout.className = 'callout callout-warning';
        callout.innerHTML = '<div class="callout-title">Game in progress</div><p>You will spectate and submit a phrase to join on the next round.</p>';
      }
    }
  }

  input.addEventListener('input', updateJoinUI);

  const submit = () => {
    const name = input.value.trim();
    if (!name) return showToast('Please enter your name.', 'error');
    myName = name;
    localStorage.setItem('vibeMeterName', myName);
    socket.emit('join', { name });
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
