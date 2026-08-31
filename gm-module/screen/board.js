// Player-side board renderer. The server's /state is already filtered: hidden
// tokens and GM fields never reach this page. Rendering is a wholesale rebuild
// on every state change (same philosophy as the sheet app) except while a drag
// is in progress.

const boardEl = document.getElementById('board');
const fogCanvas = document.getElementById('fog');
const wrap = document.getElementById('board-wrap');

const FACTION = { pc: 'var(--pc)', ally: 'var(--ally)', enemy: 'var(--enemy)', neutral: 'var(--neutral)' };

let state = null;
let lastRaw = '';
let cellPx = 40;
let dragging = null;
let showAuras = true;
try { showAuras = localStorage.getItem('showAuras') !== '0'; } catch { /* private mode */ }

async function poll() {
  if (dragging) return;
  try {
    const res = await fetch('/state');
    const raw = await res.text();
    if (raw === lastRaw) return;
    lastRaw = raw;
    state = JSON.parse(raw);
    render();
  } catch { /* server restarting; try again next tick */ }
}

function computeCell() {
  const { w, h } = state.map;
  const availW = wrap.clientWidth - 24;
  const availH = wrap.clientHeight - 24;
  cellPx = Math.max(18, Math.floor(Math.min(availW / w, availH / h)));
}

function render() {
  if (!state) return;
  computeCell();
  const { w, h, name } = state.map;

  document.getElementById('map-name').textContent = name ?? 'Untitled map';
  document.getElementById('round').textContent = state.initiative ? `Round ${state.initiative.round}` : '';

  const initEl = document.getElementById('initiative');
  initEl.replaceChildren();
  if (state.initiative) {
    const byId = Object.fromEntries(state.tokens.map(t => [t.id, t]));
    for (const id of state.initiative.order) {
      const chip = document.createElement('span');
      chip.className = 'init-entry' + (id === state.initiative.activeId ? ' active' : '');
      chip.textContent = byId[id]?.name ?? id;
      initEl.append(chip);
    }
  }

  boardEl.style.width = `${w * cellPx}px`;
  boardEl.style.height = `${h * cellPx}px`;
  boardEl.style.backgroundSize = `${cellPx}px ${cellPx}px`;

  boardEl.querySelectorAll('.wall, .token, .aura').forEach(el => el.remove());

  if (showAuras) {
    for (const tok of state.tokens) {
      for (const aura of tok.auras ?? []) {
        const cells = (aura.radius ?? 0) / 5;          // radius is in feet, 5 ft per cell
        if (cells <= 0) continue;
        const tokCells = tok.size ?? 1;
        const cx = (tok.x + tokCells / 2) * cellPx;    // centre of the token
        const cy = (tok.y + tokCells / 2) * cellPx;
        const r = (cells + tokCells / 2) * cellPx;     // radius measured from the token edge
        const div = document.createElement('div');
        div.className = 'aura';
        div.style.left = `${cx - r}px`;
        div.style.top = `${cy - r}px`;
        div.style.width = `${r * 2}px`;
        div.style.height = `${r * 2}px`;
        const c = aura.color ?? tok.color ?? FACTION[tok.faction] ?? FACTION.neutral;
        div.style.borderColor = c;
        div.style.background = `color-mix(in srgb, ${c} 12%, transparent)`;
        div.title = aura.label ?? '';
        if (aura.label) {
          const lab = document.createElement('span');
          lab.textContent = aura.label;
          lab.style.color = c;
          div.append(lab);
        }
        boardEl.append(div);
      }
    }
  }

  for (const cell of state.terrain) {
    if (cell.t !== 'wall') continue;
    const div = document.createElement('div');
    div.className = 'wall';
    div.style.left = `${cell.x * cellPx}px`;
    div.style.top = `${cell.y * cellPx}px`;
    div.style.width = `${cellPx}px`;
    div.style.height = `${cellPx}px`;
    boardEl.append(div);
  }

  for (const tok of state.tokens) boardEl.append(makeToken(tok));

  drawFog();
}

function makeToken(tok) {
  const size = (tok.size ?? 1) * cellPx;
  const div = document.createElement('div');
  div.className = 'token';
  div.style.left = `${tok.x * cellPx}px`;
  div.style.top = `${tok.y * cellPx}px`;
  div.style.width = `${size}px`;
  div.style.height = `${size}px`;
  div.style.background = tok.color ?? FACTION[tok.faction] ?? FACTION.neutral;
  div.style.fontSize = `${Math.max(10, size * 0.32)}px`;
  div.title = tok.name;

  const initials = document.createElement('span');
  initials.textContent = (tok.name ?? '?').split(/\s+/).map(p => p[0]).join('').slice(0, 3).toUpperCase();
  div.append(initials);

  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = tok.name;
  div.append(label);

  if (Array.isArray(tok.hp)) {
    const [cur, max] = tok.hp;
    const frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    const bar = document.createElement('span');
    bar.className = 'hp';
    const fill = document.createElement('i');
    fill.style.width = `${frac * 100}%`;
    if (frac <= 1 / 3) fill.className = 'dire';
    else if (frac <= 2 / 3) fill.className = 'hurt';
    bar.append(fill);
    div.append(bar);
  }

  div.addEventListener('pointerdown', ev => startDrag(ev, tok, div));
  return div;
}

function startDrag(ev, tok, div) {
  ev.preventDefault();
  div.setPointerCapture(ev.pointerId);
  div.classList.add('dragging');
  const rect = div.getBoundingClientRect();
  dragging = { tok, div, dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };

  const onMove = e => {
    const host = boardEl.getBoundingClientRect();
    dragging.div.style.left = `${e.clientX - host.left - dragging.dx}px`;
    dragging.div.style.top = `${e.clientY - host.top - dragging.dy}px`;
  };
  const onUp = async e => {
    div.removeEventListener('pointermove', onMove);
    div.removeEventListener('pointerup', onUp);
    div.classList.remove('dragging');
    const host = boardEl.getBoundingClientRect();
    const size = tok.size ?? 1;
    const x = Math.max(0, Math.min(state.map.w - size, Math.round((e.clientX - host.left - dragging.dx) / cellPx)));
    const y = Math.max(0, Math.min(state.map.h - size, Math.round((e.clientY - host.top - dragging.dy) / cellPx)));
    dragging = null;
    await fetch('/move', { method: 'POST', body: JSON.stringify({ id: tok.id, x, y }) });
    lastRaw = '';
    poll();
  };
  div.addEventListener('pointermove', onMove);
  div.addEventListener('pointerup', onUp);
}

function drawFog() {
  const { w, h } = state.map;
  fogCanvas.width = w * cellPx;
  fogCanvas.height = h * cellPx;
  const ctx = fogCanvas.getContext('2d');
  ctx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  if (!state.fog?.enabled) return;
  ctx.fillStyle = 'rgba(5, 6, 8, 0.93)';
  ctx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
  for (const [x, y, rw, rh] of state.fog.revealed ?? []) {
    ctx.clearRect(x * cellPx, y * cellPx, rw * cellPx, rh * cellPx);
  }
}

const auraBtn = document.getElementById('toggle-auras');
auraBtn.classList.toggle('on', showAuras);
auraBtn.addEventListener('click', () => {
  showAuras = !showAuras;
  auraBtn.classList.toggle('on', showAuras);
  try { localStorage.setItem('showAuras', showAuras ? '1' : '0'); } catch { /* private mode */ }
  if (state) render();
});

document.getElementById('next-turn').addEventListener('click', async () => {
  await fetch('/initiative/next', { method: 'POST' });
  lastRaw = '';
  poll();
});

window.addEventListener('resize', () => { if (state) render(); });
poll();
setInterval(poll, 1200);
