import base64
import json
import logging
import os
from typing import Any

import feedparser
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from google.cloud import pubsub_v1

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("regulatory-ingest")

app = FastAPI(title="European Regulatory Ingest Service")

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "your-project-id")
REGION = os.getenv("GOOGLE_CLOUD_LOCATION", "europe-west3")
PUBSUB_TOPIC = os.getenv("PUBSUB_TOPIC", "regulatory-events")

RSS_FEEDS = [
    "https://www.esma.europa.eu/rss.xml",
    "https://www.ecb.europa.eu/press/pr/date/html/rss.en.xml",
    "https://www.europarl.europa.eu/rss/en/news.xml",
]

publisher = pubsub_v1.PublisherClient()
topic_path = publisher.topic_path(PROJECT_ID, PUBSUB_TOPIC)


def fetch_regulatory_items(limit: int = 5) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for feed_url in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
        except Exception as exc:  # pragma: no cover - defensive path
            logger.warning("Unable to fetch feed %s: %s", feed_url, exc)
            continue

        for entry in feed.entries[:limit]:
            items.append(
                {
                    "id": entry.get("id", entry.get("link", feed_url)),
                    "title": getattr(entry, "title", "Untitled regulatory item"),
                    "summary": getattr(entry, "summary", "No summary available"),
                    "link": getattr(entry, "link", feed_url),
                    "source": feed.feed.get("title", "Unknown feed"),
                    "published": getattr(entry, "published", "unknown"),
                    "ingested_region": REGION,
                }
            )
    return items


def publish_items(items: list[dict[str, Any]]) -> int:
    published = 0
    for item in items:
        payload = json.dumps(item).encode("utf-8")
        publisher.publish(topic_path, data=payload, event_type="regulatory-news")
        published += 1
    return published


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "region": REGION}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "regulatory-ingest", "region": REGION}


@app.post("/ingest")
def ingest() -> JSONResponse:
    items = fetch_regulatory_items(limit=5)
    published = publish_items(items)
    return JSONResponse(
        status_code=200,
        content={
            "status": "published",
            "published": published,
            "region": REGION,
            "topic": PUBSUB_TOPIC,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
