// Margins demo — replica of the Claude product demo behavior.
// Streaming reveal, entity panel slide-out, view switching, chips,
// file-tree folder collapse, and per-file preview rendering.

// -------- streaming demo ----------
const upload    = document.getElementById('upload');
const demoBtn   = document.getElementById('demoBtn');
const streaming = document.getElementById('streaming');
const lines     = document.getElementById('streamLines');
const statusEl  = document.getElementById('streamStatus');
const actions   = document.getElementById('streamActions');
const wall      = document.getElementById('wall');
const activityEmpty = document.getElementById('activity-empty');

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iconClass(type = '') {
  const clean = String(type).toLowerCase();
  if (clean.includes('pdf')) return 'pdf';
  if (clean.includes('email') || clean.includes('eml')) return 'eml';
  if (clean.includes('voice') || clean.includes('audio')) return 'aud';
  return 'txt';
}

function renderActivityCard(item) {
  const tags = (item.tags || []).filter(Boolean).slice(0, 6);
  const status = item.statusLabel || (item.isPending ? 'Pending review' : 'Filed source');
  const action = item.actionLabel && item.fileName ? `
    <button class="card-action" type="button" data-source-action="process" data-source-file="${htmlEscape(item.fileName)}" ${item.actionDisabled ? 'disabled' : ''}>
      ${htmlEscape(item.actionLabel)}
    </button>
  ` : '';

  return `
    <div class="card ${item.isFresh ? 'fresh' : ''}" data-entity="${htmlEscape(item.primaryEntity || item.title || '')}">
      <div class="card-top">
        <span class="source-icon ${iconClass(item.typeLabel)}">${htmlEscape(item.typeLabel || 'TXT')}</span>
        <div class="card-title">${htmlEscape(item.title || 'Untitled source')}</div>
        <div class="card-date">${htmlEscape(item.timestamp || 'filed')}</div>
      </div>
      <div class="card-summary">${htmlEscape(item.summary || 'Margins is preparing this source for review.')}</div>
      ${tags.length ? `
        <div class="card-pills">
          ${tags.map(tag => `<span class="pill">${htmlEscape(tag)}</span>`).join('')}
        </div>
      ` : ''}
      <div class="card-foot">
        <span class="stat">${htmlEscape(status)}</span>
      </div>
      ${action}
    </div>
  `;
}

function renderActivity(payload = {}) {
  if (!wall) return;
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    wall.innerHTML = '';
    if (activityEmpty) activityEmpty.removeAttribute('hidden');
    return;
  }
  if (activityEmpty) activityEmpty.setAttribute('hidden', '');
  wall.innerHTML = items.map(renderActivityCard).join('');
  bindActivityCards(wall);
}

globalThis.__marginsDemo = { renderActivity };

if (globalThis.__marginsActivityPayload) {
  renderActivity(globalThis.__marginsActivityPayload);
} else {
  renderActivity({ items: [] });
}

const steps = [
  { html: 'Reading PDF — 12 pages, ~3,200 words', delay: 350 },
  { html: 'Detected 6 entities · 4 already in your brain', delay: 600 },
  { html: 'Created <span class="stream-pill">Centric WM Pilot Agreement</span> as a new source', delay: 700 },
  { html: 'Updated <span class="stream-pill">Ellis Rutili</span> · added pilot terms ($125/seat, 60–90d)', delay: 700 },
  { html: 'Updated <span class="stream-pill">Briefly</span> · pilot scope locked, brief-only, no action-routing promises', delay: 700 },
  { html: 'Linked to <span class="stream-pill">Centric WM</span> (12 prior mentions) and <span class="stream-pill">Briefly Wealth LLC</span>', delay: 800 },
  { html: 'Discovered: this contradicts your 4/28 draft. The new agreement removed the action-item language.', delay: 900, insight: true },
  { html: 'Filed source page · 5 entity updates · 1 contradiction flagged for review', delay: 600, final: true }
];

let running = false;

function startDemo() {
  if (running) return;
  if (!upload || !streaming || !lines || !statusEl || !actions) return;
  running = true;
  upload.setAttribute('hidden', '');
  streaming.removeAttribute('hidden');
  lines.innerHTML = '';
  actions.setAttribute('hidden', '');
  statusEl.innerHTML = '<span class="dot"></span> Reading';

  let cum = 0;
  steps.forEach((step, i) => {
    cum += step.delay;
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'stream-line' + (step.insight ? ' insight' : '') + (step.final ? ' final' : '');
      el.style.animationDelay = '0s';
      el.innerHTML = `<span class="check">✓</span><span>${step.html}</span>`;
      lines.appendChild(el);
      if (i === steps.length - 1) {
        statusEl.innerHTML = 'Done';
        statusEl.style.color = 'var(--good)';
        setTimeout(showActions, 350);
      }
    }, cum);
  });
}

function showActions() {
  if (!actions) return;
  actions.removeAttribute('hidden');
  actions.style.animation = 'demo-line-in 380ms var(--ease) forwards';
}

function landCard() {
  if (!streaming || !upload || !wall) return;
  streaming.style.transition = 'opacity 220ms ease, transform 220ms ease';
  streaming.style.opacity = '0';
  streaming.style.transform = 'translateY(-6px)';
  setTimeout(() => {
    streaming.setAttribute('hidden', '');
    streaming.style.opacity = '';
    streaming.style.transform = '';
    upload.removeAttribute('hidden');

    const newCard = document.createElement('div');
    newCard.className = 'card fresh';
    newCard.innerHTML = `
      <div class="card-top">
        <span class="source-icon pdf">PDF</span>
        <div class="card-title">briefly-centric-pilot-agreement-v3.pdf</div>
        <div class="card-date">just now</div>
      </div>
      <div class="card-summary">Pilot scope locked: brief-only, 60–90 days, $125/seat, Ellis + 1–2 advisors. Action-item routing language removed vs. 4/28 draft.</div>
      <div class="card-pills">
        <span class="pill">Centric WM</span>
        <span class="pill">Ellis Rutili</span>
        <span class="pill">Briefly</span>
        <span class="pill">pilot agreement</span>
      </div>
      <div class="card-foot">
        <span class="stat"><strong>5</strong> entities updated · <span style="color:var(--accent);font-weight:600;">1 flagged</span></span>
      </div>`;
    wall.insertBefore(newCard, wall.firstChild);
    bindActivityCards(newCard);
    newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => newCard.classList.remove('fresh'), 1400);
    running = false;
  }, 240);
}

if (demoBtn) demoBtn.addEventListener('click', (e) => { e.stopPropagation(); startDemo(); });
if (upload) upload.addEventListener('click', startDemo);

if (actions) {
  actions.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'entity') {
      landCard();
      setTimeout(() => openEntity('Centric WM', 'company'), 600);
    } else {
      landCard();
    }
  });
}

// -------- entity panel ----------
const panel       = document.getElementById('entityPanel');
const scrim       = document.getElementById('scrim');
const entityName  = document.getElementById('entityName');
const entityClose = document.getElementById('entityClose');

function openEntity(name) {
  if (!panel || !scrim || !entityName) return;
  entityName.textContent = name || 'Bob Casey';
  panel.classList.add('open');
  scrim.classList.add('show');
}
function closeEntity() {
  if (!panel || !scrim) return;
  panel.classList.remove('open');
  scrim.classList.remove('show');
}
if (entityClose) entityClose.addEventListener('click', closeEntity);
if (scrim) scrim.addEventListener('click', closeEntity);

function bindActivityCards(root = document) {
  root.querySelectorAll?.('.demo-shell .card, .card').forEach(card => {
    if (card.dataset.activityBound === 'true') return;
    card.dataset.activityBound = 'true';
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, input, label, select, textarea, a')) return;
      const slug = card.dataset.entity;
      const fromSlug = slug ? slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') : '';
      openEntity(fromSlug || card.querySelector('.card-title')?.textContent.trim() || 'Bob Casey');
    });
  });
  root.querySelectorAll?.('.demo-shell .pill, .pill').forEach(item => {
    if (item.dataset.activityBound === 'true') return;
    item.dataset.activityBound = 'true';
    item.addEventListener('click', (event) => {
      if (item.matches('[data-source-action]')) return;
      event.stopPropagation();
      openEntity(item.textContent.replace(/\s+\d+$/, '').trim());
    });
  });
}
bindActivityCards(document);

// discovery banner click
const discovery = document.querySelector('.demo-shell .discovery');
if (discovery) discovery.addEventListener('click', () => openEntity('Bob Casey'));

// -------- connect-vault gate ----------
const appShell = document.querySelector('.app.demo-shell');
const gateCreateBtn = document.getElementById('gate-create-btn');
const gateOpenBtn = document.getElementById('gate-open-btn');
const sidebarCreateBtn = document.getElementById('create-vault-btn');
const sidebarOpenBtn = document.getElementById('open-vault-btn');
const vaultStatusEl = document.getElementById('vault-status');

function setNoVault(noVault) {
  if (!appShell) return;
  appShell.classList.toggle('no-vault', !!noVault);
}
// boot: vault unconnected until app.js says otherwise
setNoVault(true);

if (gateCreateBtn && sidebarCreateBtn) {
  gateCreateBtn.addEventListener('click', () => sidebarCreateBtn.click());
}
if (gateOpenBtn && sidebarOpenBtn) {
  gateOpenBtn.addEventListener('click', () => sidebarOpenBtn.click());
}

document.addEventListener('margins:vault-connected', () => setNoVault(false));
document.addEventListener('margins:vault-disconnected', () => setNoVault(true));

// vault-status text changes (e.g., remembered handle restored before module load) — fall back to text watch
if (vaultStatusEl) {
  const observer = new MutationObserver(() => {
    const txt = vaultStatusEl.textContent.trim();
    if (txt && !/^no vault/i.test(txt)) setNoVault(false);
  });
  observer.observe(vaultStatusEl, { childList: true, characterData: true, subtree: true });
  // initial state check in case app.js already set status
  const txt = vaultStatusEl.textContent.trim();
  if (txt && !/^no vault/i.test(txt)) setNoVault(false);
}

// -------- view switching ----------
const views = document.querySelectorAll('.demo-shell .view:not(.utility-view)');
const navLinks = document.querySelectorAll('.demo-shell .nav.demo-nav a[data-view-target]');
function switchView(name) {
  views.forEach(v => {
    if (v.dataset.view === name) v.removeAttribute('hidden');
    else v.setAttribute('hidden', '');
  });
  navLinks.forEach(a => {
    a.classList.toggle('active', a.dataset.viewTarget === name);
  });
  const active = document.querySelector(`.demo-shell .view[data-view="${name}"]`);
  if (active) {
    active.style.animation = 'none';
    void active.offsetWidth;
    active.style.animation = '';
  }
  const main = document.querySelector('.demo-shell .main');
  if (main) main.scrollTop = 0;
}
navLinks.forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(a.dataset.viewTarget);
  });
});

// -------- entity card / row click → entity panel ----------
document.querySelectorAll('.demo-shell .pinned-card, .demo-shell .entity-row').forEach(el => {
  el.addEventListener('click', () => openEntity(el.dataset.name || 'Bob Casey'));
});

// -------- chips ----------
document.querySelectorAll('.demo-shell .chips').forEach(group => {
  group.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

// -------- file tree ----------
document.querySelectorAll('.demo-shell .tree-folder[data-folder]').forEach(folder => {
  folder.addEventListener('click', () => folder.classList.toggle('collapsed'));
});

// -------- file previews ----------
const previews = {
  bob: {
    breadcrumb: 'entities / people / <span class="current">bob-casey.md</span>',
    title: 'Bob Casey',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">entity</span>
<span class="fk">bucket:</span> <span class="fv">people</span>
<span class="fk">summary:</span> <span class="fv">Founder, Riviera (Chicago). Booth professor. Stay-in-touch closeout 5/3.</span>
<span class="fk">tags:</span> <span class="fv">[person, riviera, advisor, sbm-legacy]</span>
<span class="fk">created:</span> <span class="fv">2026-02-14</span>
<span class="fk">updated:</span> <span class="fv">2026-05-03</span>
<span class="fk">priority:</span> <span class="fv">pinned</span>
<span class="fk">firm:</span> <span class="fv">Riviera</span>
<span class="fk">role:</span> <span class="fv">Founder</span>
<span class="fk">last_contact:</span> <span class="fv">2026-05-03</span>
<span class="fk">next_move:</span> <span class="fv">Casual quarterly check-in</span>
<span class="fc">---</span>`,
    body: `<h2>Snapshot</h2>
<ul>
  <li><strong>Status:</strong> Riviera closed-out 5/3. Stay-in-touch relationship; not waiting on anything.</li>
  <li><strong>Last interaction:</strong> Email 5/3 — acknowledged gracious decline.</li>
  <li><strong>Next move:</strong> No action. Quarterly check-in cadence.</li>
  <li><strong>Watch:</strong> Don't surface Margins until equity terms resolved (now resolved; rule retained for safety).</li>
</ul>
<h2>Source Log</h2>
<ul>
  <li><span class="wikilink">2026-05-03-bob-casey-closeout</span> — Bob acknowledged gracious decline</li>
  <li><span class="wikilink">2026-05-02-bob-casey-decline-draft</span> — Connor drafted reply</li>
  <li><span class="wikilink">2026-05-01-bob-casey-call-notes</span> — Bob slowed down (8w–8mo)</li>
  <li><span class="wikilink">2026-04-12-bob-founding-team-offer</span> — original offer framing</li>
</ul>
<h2>Connected Entities</h2>
<ul>
  <li><span class="wikilink">Riviera</span> · <span class="wikilink">Mark Loh</span> · <span class="wikilink">UChicago Booth</span> · <span class="wikilink">SBM</span> · <span class="wikilink">MS 401(k)</span></li>
</ul>`
  },
  briefly: {
    breadcrumb: 'entities / briefly / <span class="current">briefly.md</span>',
    title: 'Briefly',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">project</span>
<span class="fk">bucket:</span> <span class="fv">briefly</span>
<span class="fk">summary:</span> <span class="fv">AI meeting prep tool for wealth advisors. Maintenance cadence; Centric pilot in flight.</span>
<span class="fk">tags:</span> <span class="fv">[project, briefly, ria, vertical]</span>
<span class="fk">created:</span> <span class="fv">2024-11-12</span>
<span class="fk">updated:</span> <span class="fv">2026-05-05</span>
<span class="fk">priority:</span> <span class="fv">pinned</span>
<span class="fk">status:</span> <span class="fv">active</span>
<span class="fc">---</span>`,
    body: `<h2>Snapshot</h2>
<ul>
  <li><strong>Phase:</strong> Maintenance cadence. Margins is now the lead build.</li>
  <li><strong>Pilot #1:</strong> Centric WM, $125/seat, 60–90 days, brief-only scope.</li>
  <li><strong>Three branches:</strong> portfolio compare, email→CRM, meeting prep. Branch #2 most aligned with core obsession.</li>
  <li><strong>Pricing anchor:</strong> Affinity ($2K/user/yr), not Wealthbox/Jump.</li>
</ul>
<h2>Open Threads</h2>
<ul>
  <li>Centric pilot agreement v3 — draft 5/3, send this week</li>
  <li>Customization build-order — Centric-first vs multi-tenant from day one (undecided)</li>
  <li>Booth-deferral fork — multiple pilots → defer; no traction → attend Sep 2026</li>
</ul>
<h2>Recent Sources</h2>
<ul>
  <li><span class="wikilink">2026-04-30-ellis-centric-visit</span></li>
  <li><span class="wikilink">2026-04-28-affinity-pricing-teardown</span></li>
  <li><span class="wikilink">2026-04-25-competitive-landscape-q1</span></li>
</ul>`
  },
  ellis: {
    breadcrumb: 'entities / briefly / <span class="current">ellis-rutili.md</span>',
    title: 'Ellis Rutili',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">entity</span>
<span class="fk">bucket:</span> <span class="fv">briefly</span>
<span class="fk">summary:</span> <span class="fv">Champion at Centric WM (operations). Real buyer is Virgil Rutili (founder, uncle).</span>
<span class="fk">firm:</span> <span class="fv">Centric WM</span>
<span class="fk">role:</span> <span class="fv">Operations</span>
<span class="fk">last_contact:</span> <span class="fv">2026-04-30</span>
<span class="fk">next_move:</span> <span class="fv">Send pilot agreement v3</span>
<span class="fc">---</span>`,
    body: `<h2>Snapshot</h2>
<ul>
  <li><strong>Role:</strong> Champion at Centric WM. Not the buyer — Virgil Rutili (founder, uncle) is.</li>
  <li><strong>Pilot ask #1:</strong> Action-item routing (deferred to post-pilot per scope decision).</li>
  <li><strong>Tooling:</strong> Centric uses Orion for portfolio reporting (confirmed 4/30).</li>
  <li><strong>Watch:</strong> Don't break champion framing — let Virgil sit one level above.</li>
</ul>`
  },
  centric: {
    breadcrumb: 'entities / briefly / <span class="current">centric-wm.md</span>',
    title: 'Centric WM',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">entity</span>
<span class="fk">bucket:</span> <span class="fv">briefly</span>
<span class="fk">summary:</span> <span class="fv">Pilot #1 partner. Champion: Ellis. Buyer: Virgil. Reporting: Orion.</span>
<span class="fc">---</span>`,
    body: `<h2>Snapshot</h2>
<ul>
  <li><strong>Pilot terms:</strong> $125/seat, 60–90 days, Ellis + 1–2 advisors.</li>
  <li><strong>Scope:</strong> Brief-only. No action-routing promises.</li>
  <li><strong>Reporting stack:</strong> Orion. v1 reporting back-door for Briefly's structured custodial data.</li>
</ul>`
  },
  margins: {
    breadcrumb: 'entities / ideas / <span class="current">margins-v2.md</span>',
    title: 'Margins v2',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">project</span>
<span class="fk">bucket:</span> <span class="fv">ideas</span>
<span class="fk">summary:</span> <span class="fv">Lead build. Student-first hero. Supabase cloud. Four-screen architecture.</span>
<span class="fc">---</span>`,
    body: `<h2>Architecture</h2>
<ul>
  <li><strong>Pipe + manual.</strong> Margins is the ingestion + propagation engine. The reader is pluggable.</li>
  <li><strong>Four screens:</strong> Activity (home), Chat, Entities, Files.</li>
  <li><strong>No graph view.</strong> Graph stays in the data layer; render lightly via "related entities" panels.</li>
  <li><strong>No vault browser as a primary surface.</strong> Replaced with entity-centric navigation.</li>
</ul>
<h2>Hero loop</h2>
<ul>
  <li>Drop a file (cinematic focus) → watch the work happen (streaming reveal) → land in front of a beautiful artifact (the receipt card) → forward action (entity or chat) → leave → come back tomorrow because Margins kept finding things while you were gone.</li>
</ul>`
  },
  'src-walk': {
    breadcrumb: 'sources / <span class="current">2026-05-04-walk-margins-thinking.md</span>',
    title: '5/4 walk — afternoon thinking on Margins',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">source</span>
<span class="fk">event_date:</span> <span class="fv">2026-05-04</span>
<span class="fk">bucket:</span> <span class="fv">ideas</span>
<span class="fc">---</span>`,
    body: `<h2>Takeaways</h2>
<ul>
  <li>Margins = architecture. Briefly = vertical product on top.</li>
  <li>Margins web app needs to ship its own reader since most users won't run Obsidian.</li>
  <li>Confirmed cut: graph view. Confirmed cut: vault file browser as primary UI.</li>
</ul>`
  },
  'src-bob': {
    breadcrumb: 'sources / <span class="current">2026-05-03-bob-casey-closeout.md</span>',
    title: 'Bob Casey — re: Riviera follow-up',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">source</span>
<span class="fk">event_date:</span> <span class="fv">2026-05-03</span>
<span class="fk">bucket:</span> <span class="fv">people</span>
<span class="fc">---</span>`,
    body: `<h2>Summary</h2>
<ul>
  <li>Bob acknowledged the gracious decline. Stay-in-touch closeout, no equity terms pending.</li>
  <li>MS 401(k) rollover unblocked. Path C (in-plan Roth conversion in 2026 low-income year) leading.</li>
</ul>`
  },
  'src-ellis': {
    breadcrumb: 'sources / <span class="current">2026-04-30-ellis-centric-visit.md</span>',
    title: 'Ellis 4/30 Centric WM visit transcript',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">source</span>
<span class="fk">event_date:</span> <span class="fv">2026-04-30</span>
<span class="fk">bucket:</span> <span class="fv">briefly</span>
<span class="fc">---</span>`,
    body: `<h2>Takeaways</h2>
<ul>
  <li>Ellis named action-item routing as the #1 pilot ask.</li>
  <li>Centric uses Orion for portfolio reporting.</li>
  <li>Pilot scope: Ellis + 1–2 advisors at $125/seat, 60–90 days.</li>
</ul>`
  },
  'src-affinity': {
    breadcrumb: 'sources / <span class="current">2026-04-28-affinity-pricing-teardown.md</span>',
    title: 'Affinity pricing teardown',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">source</span>
<span class="fk">event_date:</span> <span class="fv">2026-04-28</span>
<span class="fk">bucket:</span> <span class="fv">compete</span>
<span class="fc">---</span>`,
    body: `<h2>Numbers</h2>
<ul>
  <li>$2K/user/year. 1,700 customers.</li>
  <li>Relationship graph + email/calendar ingest for VC/PE/IB.</li>
  <li>Pricing anchor: Briefly should land near Affinity, not Wealthbox/Jump.</li>
</ul>`
  },
  ihor: {
    breadcrumb: 'entities / briefly / <span class="current">ihor-romanchuk.md</span>',
    title: 'Ihor Romanchuk',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">entity</span>
<span class="fk">summary:</span> <span class="fv">Most pivotal collaborator. Engagement minimal until pilot revenue.</span>
<span class="fc">---</span>`,
    body: `<h2>Snapshot</h2><ul><li><strong>Status:</strong> Freeze active. Reactivate when pilot revenue arrives.</li></ul>`
  },
  mark: {
    breadcrumb: 'entities / people / <span class="current">mark-loh.md</span>',
    title: 'Mark Loh',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">entity</span>
<span class="fk">summary:</span> <span class="fv">Sales/product advisor. Travel-services PE rollups. Don't position as wealth-tech expert.</span>
<span class="fc">---</span>`,
    body: `<h2>Diagnostic Questions</h2><ul><li>What does success look like in 6 months / 1 year?</li><li>Raise breakdown.</li><li>Hiring slate + role intent.</li></ul>`
  },
  matt: {
    breadcrumb: 'entities / people / <span class="current">matt-gullotta.md</span>',
    title: 'Matt Gullotta',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">entity</span>
<span class="fk">summary:</span> <span class="fv">Real estate developer. Wants Obsidian + AI second brain. Margins persona #1.</span>
<span class="fc">---</span>`,
    body: `<h2>Setup</h2><ul><li>Big notes file + ongoing PDFs/notes. Wants graph + auto-connections.</li><li>Setup guide HTML at outbound/2026-04-27.</li></ul>`
  },
  'daily-today': {
    breadcrumb: 'daily / <span class="current">2026-05-05.md</span>',
    title: 'Tuesday, May 5',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">log</span>
<span class="fk">event_date:</span> <span class="fv">2026-05-05</span>
<span class="fc">---</span>`,
    body: `<h2>Activity</h2><ul><li>Strategic conversation: Margins reader architecture confirmed (4 screens, no graph, no vault browser) #margins</li><li>Built HTML demo of Margins UX [[CON-XX]] #margins</li></ul><h2>Linear</h2><ul><li><strong>Moved today:</strong> Margins demo build</li></ul><h2>Reflection</h2><ul><li><em>(written in evening check-in)</em></li></ul>`
  },
  'daily-yest': {
    breadcrumb: 'daily / <span class="current">2026-05-04.md</span>',
    title: 'Monday, May 4',
    fm: `<span class="fc">---</span>
<span class="fk">type:</span> <span class="fv">log</span>
<span class="fk">event_date:</span> <span class="fv">2026-05-04</span>
<span class="fc">---</span>`,
    body: `<h2>Activity</h2><ul><li>Margins v2 architecture: student-first, Supabase cloud, ingestion-as-iteration #margins</li><li>Branch map filed at queries/2026-05-04 #margins</li></ul>`
  }
};

function renderPreview(key) {
  const p = previews[key] || previews.bob;
  const target = document.getElementById('filePreview');
  if (!target) return;
  target.innerHTML = `
    <div class="preview-breadcrumb">${p.breadcrumb}</div>
    <h1 class="preview-title">${p.title}</h1>
    <div class="preview-fm">${p.fm}</div>
    <div class="preview-body">${p.body}</div>
  `;
}

document.querySelectorAll('.demo-shell .tree-file').forEach(f => {
  f.addEventListener('click', () => {
    document.querySelectorAll('.demo-shell .tree-file').forEach(x => x.classList.remove('active'));
    f.classList.add('active');
    renderPreview(f.dataset.file);
  });
});

// initial preview
renderPreview('bob');

// -------- settings drawer ----------
const settingsOpenBtn  = document.getElementById('settings-open-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsDrawer   = document.getElementById('settings-drawer');
const settingsScrim    = document.getElementById('settings-scrim');

function openSettings() {
  if (settingsDrawer) {
    settingsDrawer.classList.add('open');
    settingsDrawer.setAttribute('aria-hidden', 'false');
  }
  if (settingsScrim) settingsScrim.classList.add('show');
}
function closeSettings() {
  if (settingsDrawer) {
    settingsDrawer.classList.remove('open');
    settingsDrawer.setAttribute('aria-hidden', 'true');
  }
  if (settingsScrim) settingsScrim.classList.remove('show');
}
if (settingsOpenBtn) settingsOpenBtn.addEventListener('click', openSettings);
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);
if (settingsScrim) settingsScrim.addEventListener('click', closeSettings);
