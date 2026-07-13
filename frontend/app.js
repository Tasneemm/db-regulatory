const API_BASE = '/api';

const mockClients = [
  { client_id: 'eu-001', name: 'Apex Bank Europe', jurisdiction: 'DE', risk_tier: 'HIGH' },
  { client_id: 'eu-002', name: 'Northstar Wealth', jurisdiction: 'FR', risk_tier: 'MEDIUM' },
  { client_id: 'eu-003', name: 'Helio Insurance Group', jurisdiction: 'NL', risk_tier: 'HIGH' },
];

function navTo(route) {
  window.history.pushState({}, '', route);
  renderRoute(route);
}

function renderRoute(route) {
  const el = document.getElementById('app');
  switch (route) {
    case '/events':
      el.innerHTML = renderEventsPage();
      bindEventsPage();
      break;
    case '/clients':
      el.innerHTML = renderClientsPage();
      break;
    case '/assessments':
      el.innerHTML = renderAssessmentsPage();
      bindAssessmentsPage();
      break;
    case '/adverse':
      el.innerHTML = renderAdversePage();
      break;
    case '/admin':
      el.innerHTML = renderAdminPage();
      bindAdminPage();
      break;
    default:
      el.innerHTML = renderDashboard();
  }
}

function renderDashboard() {
  return `
    <h1>Dashboard</h1>
    <p class="lead">KYC Risk Portal — Deutsche Bank (demo)</p>
    <div class="row">
      <div class="col-md-6">
        <div class="card mb-3">
          <div class="card-body">
            <h5 class="card-title">Recent Events</h5>
            <p class="card-text">Fetch live regulatory events and run assessments.</p>
            <a href="#" class="btn btn-primary" data-route="/events">View Events</a>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card mb-3">
          <div class="card-body">
            <h5 class="card-title">Clients</h5>
            <p class="card-text">List of monitored clients and risk tiers.</p>
            <a href="#" class="btn btn-secondary" data-route="/clients">View Clients</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderEventsPage() {
  return `
    <h1>Events</h1>
    <p>Ingested regulatory events from RSS feeds.</p>
    <div class="mb-3">
      <button id="fetchEventsBtn" class="btn btn-primary">Fetch /ingest</button>
      <button id="runSampleAssessmentBtn" class="btn btn-success ms-2">Run sample assessment (post /events)</button>
    </div>
    <div id="eventsOutput"></div>
  `;
}

function bindEventsPage() {
  document.getElementById('fetchEventsBtn').addEventListener('click', async () => {
    const out = document.getElementById('eventsOutput');
    out.innerHTML = 'Calling /ingest...';
    try {
      const res = await fetch(`${API_BASE}/ingest`, { method: 'POST' });
      const json = await res.json();
      out.innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
    } catch (err) {
      out.innerHTML = `<div class="alert alert-danger">Error: ${err}</div>`;
    }
  });

  document.getElementById('runSampleAssessmentBtn').addEventListener('click', async () => {
    const out = document.getElementById('eventsOutput');
    out.innerHTML = 'Posting sample event to /events...';
    const sampleEvent = {
      title: 'European regulator issues AML guidance on crypto payments',
      summary: 'New guidance advises stricter controls on crypto-related payment flows.',
      source: 'ESMA',
      link: 'https://example.org/regulatory/aml-crypto',
    };

    try {
      const res = await fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleEvent),
      });
      const json = await res.json();
      out.innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
    } catch (err) {
      out.innerHTML = `<div class="alert alert-danger">Error: ${err}</div>`;
    }
  });
}

function renderClientsPage() {
  return `
    <h1>Clients</h1>
    <p>Monitored client profiles (mock data).</p>
    <div class="list-group">
      ${mockClients.map(c => `
        <a href="#" class="list-group-item list-group-item-action">
          <div class="d-flex w-100 justify-content-between">
            <h5 class="mb-1">${c.name}</h5>
            <small>${c.jurisdiction}</small>
          </div>
          <p class="mb-1">Risk tier: ${c.risk_tier}</p>
          <small>Client ID: ${c.client_id}</small>
        </a>
      `).join('')}
    </div>
  `;
}

function renderAssessmentsPage() {
  return `
    <h1>Assessments</h1>
    <p>Previous assessments (demo) and an option to re-run sample assessments.</p>
    <div class="mb-3">
      <button id="runAllBtn" class="btn btn-primary">Run sample assessment for all mock clients</button>
    </div>
    <div id="assessmentsOutput"></div>
  `;
}

function bindAssessmentsPage() {
  document.getElementById('runAllBtn').addEventListener('click', async () => {
    const out = document.getElementById('assessmentsOutput');
    out.innerHTML = 'Running assessments...';
    const sampleEvent = {
      title: 'Regulatory enforcement action against payments processor',
      summary: 'Enforcement for AML failures in payments processing in EU region.',
      source: 'ECB',
    };

    try {
      const res = await fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleEvent),
      });
      const json = await res.json();
      out.innerHTML = `<pre>${JSON.stringify(json, null, 2)}</pre>`;
    } catch (err) {
      out.innerHTML = `<div class="alert alert-danger">Error: ${err}</div>`;
    }
  });
}

function renderAdversePage() {
  return `
    <h1>Adverse Media</h1>
    <p>View grounding / adverse media summaries produced by the processor.</p>
    <div class="alert alert-secondary">This demo shows results returned by the `/events` call under `adverse_media`.</div>
    <div id="adverseOutput"></div>
  `;
}

function renderAdminPage() {
  const base = API_BASE;
  return `
    <h1>Admin / Settings</h1>
    <p>Configure API server location and quick actions.</p>
    <div class="mb-3">
      <label class="form-label">API Base URL</label>
      <input id="apiBaseInput" class="form-control" value="${base}">
      <div class="form-text">Set the ` + "API base URL (eg http://localhost:8080)" + ` and Save.</div>
    </div>
    <button id="saveApiBtn" class="btn btn-primary">Save</button>
  `;
}

function bindAdminPage() {
  document.getElementById('saveApiBtn').addEventListener('click', () => {
    const val = document.getElementById('apiBaseInput').value.trim();
    if (val) {
      localStorage.setItem('API_BASE', val);
      alert('Saved API base: ' + val + '. Reload the page to apply.');
    }
  });
}

// Link clicks
document.addEventListener('click', (ev) => {
  const route = ev.target.getAttribute && ev.target.getAttribute('data-route');
  if (route) {
    ev.preventDefault();
    navTo(route);
  }
});

// Navbar search
document.getElementById('searchBtn').addEventListener('click', () => {
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  if (!q) return;
  // Simple client search
  const matched = mockClients.filter(c => c.name.toLowerCase().includes(q) || c.client_id.toLowerCase().includes(q));
  const app = document.getElementById('app');
  if (matched.length) {
    app.innerHTML = `<h3>Search results</h3><pre>${JSON.stringify(matched, null, 2)}</pre>`;
  } else {
    app.innerHTML = `<div class="alert alert-warning">No clients matched. Try Events page to run assessments.</div>`;
  }
});

// Initial render
window.addEventListener('popstate', () => renderRoute(window.location.pathname));
renderRoute(window.location.pathname || '/');
