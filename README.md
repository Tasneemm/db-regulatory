# European Regulatory Compliance and pKYC Monitoring

## Local development

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the ingest service:

```bash
python ingest.py
```

Run the processor service:

```bash
python processor.py
```

The services expose health endpoints at:

- http://localhost:8080/health
- http://localhost:8080/

For the processor service, publish a sample Pub/Sub message payload to the `/events` endpoint or call the endpoint directly with a JSON payload.

## Frontend web portal (KYC Risk Portal)

A lightweight frontend is included for demo and internal review. It provides a simple web portal that Deutsche Bank can use to review regulatory events and run KYC risk assessments against sample clients.

- **Pages included**:
	- Dashboard: overview and quick links
	- Events: call `/ingest` and submit sample events to `/events`
	- Clients: list of monitored clients (mock data)
	- Assessments: run sample assessments for mock clients
	- Adverse Media: view grounding/adverse-media output returned from `/events`
	- Admin: configure the API base URL

- **Files**: [frontend/index.html](frontend/index.html), [frontend/app.js](frontend/app.js), [frontend/styles.css](frontend/styles.css)

- **Run locally** (serve the `frontend` folder with a static server and run the Python services):

```bash
# from the repo root
python -m http.server --directory frontend 8000
# in separate terminals
pip install -r requirements.txt
python ingest.py
python processor.py
```

Open http://localhost:8000 in your browser. Use the Admin page to set the API base URL if the services run on a different host/port.

## Node.js server and authentication

A simple Node.js/Express proxy is provided to serve the frontend and add demo authentication. It protects API calls and proxies them to the `processor` service.

Files:
- `frontend-node/server.js` — Express server with `passport-local` authentication and `/api/*` proxy endpoints.

Run the Node.js server (requires Node 18+ recommended):

```bash
# from repo root
cd frontend-node
npm install
node server.js
```

The server defaults to `http://localhost:3000` and proxies to the processor at `http://localhost:8080`.
You can change the processor base with `PROCESSOR_BASE` environment variable and set a session secret with `SESSION_SECRET`.
You can also set the following environment variables for the encrypted mock store:

- `ENCRYPTION_KEY`: base64-encoded 32-byte key used to encrypt stored password hashes. If not provided, an ephemeral key is generated (demo only).
- `DEMO_PASSWORD`: override the demo user's password (default `password`).

Demo credentials (in-memory):
- username: `db_admin`
- password: `password`

Notes:
- This is a demo authentication layer. For Deutsche Bank production use, replace it with a proper enterprise IdP (OIDC/SAML) and secure session/cookie handling.
