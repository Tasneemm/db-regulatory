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
