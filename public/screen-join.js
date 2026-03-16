// ============================================================
//  SCREEN: Join
// ============================================================

function renderJoin() {
  if (!roomCode) {
    return `
      <div class="screen-shell screen-shell-centered fade-in">
        <div class="screen-shell-inner screen-shell-inner-compact">
          <div class="phase-hero screen-hero-tight">
            <h2>Create or Join a Lobby</h2>
            <p>Start a new room or enter a 4-letter code from a friend.</p>
          </div>

          <div class="card join-card" id="home-card">
            <button class="btn btn-primary btn-full btn-lg" id="create-room-btn">
              Create Lobby
            </button>

            <div class="divider" style="margin:1rem 0;"></div>

            <div class="form-group">
              <label for="room-code-input">Paste Lobby Code</label>
              <input type="text" id="room-code-input" placeholder="ABCD" maxlength="4"
                     autocomplete="off" autocorrect="off" spellcheck="false" />
            </div>
            <button class="btn btn-secondary btn-full" id="join-room-btn" style="margin-top:0.75rem;">
              Join Lobby
            </button>
          </div>
        </div>
      </div>
    `;
  }

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
          <h2>Join Lobby</h2>
          <p>Enter your name to play or spectate in this room.</p>
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
  if (!roomCode) {
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');
    const codeInput = document.getElementById('room-code-input');
    if (!createBtn || !joinBtn || !codeInput) return;

    codeInput.focus();

    createBtn.addEventListener('click', () => {
      createBtn.setAttribute('disabled', 'true');
      createBtn.textContent = 'Creating...';
      socket.emit('create-room', (resp) => {
        const code = (resp && typeof resp.code === 'string') ? resp.code.toUpperCase() : '';
        if (/^[A-Z]{4}$/.test(code)) {
          window.location.assign(`/${code}`);
          return;
        }
        createBtn.removeAttribute('disabled');
        createBtn.textContent = 'Create Lobby';
        showToast('Could not create room. Try again.', 'error');
      });
    });

    const joinRoom = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) {
        return showToast('Enter a valid 4-letter code (A-Z).', 'error');
      }
      window.location.assign(`/${code}`);
    };

    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    });
    joinBtn.addEventListener('click', joinRoom);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
    return;
  }

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
