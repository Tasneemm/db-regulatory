import base64
import json
import logging
import os
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("regulatory-processor")

app = FastAPI(title="European Regulatory pKYC Processor")

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "your-project-id")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "europe-west3")
os.environ.setdefault("GOOGLE_GENAI_USE_ENTERPRISE", "True")

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "your-project-id")
REGION = os.getenv("GOOGLE_CLOUD_LOCATION", "europe-west3")

try:
    client = genai.Client()
except Exception as exc:  # pragma: no cover - runtime guard
    logger.warning("Vertex AI client initialization failed: %s", exc)
    client = None


class RiskAssessment(BaseModel):
    client_id: str
    client_name: str
    regulatory_match: bool
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    summary: str
    recommended_action: str
    evidence: list[str] = Field(default_factory=list)


class MockBigQueryWrapper:
    def __init__(self) -> None:
        self.clients = [
            {
                "client_id": "eu-001",
                "name": "Apex Bank Europe",
                "jurisdiction": "DE",
                "countries": ["DE", "FR", "NL"],
                "regulated_entities": ["Banking", "Payments"],
                "risk_tier": "HIGH",
                "kyc_status": "ACTIVE",
                "keywords": ["banking", "payments", "regulatory", "sanctions"],
            },
            {
                "client_id": "eu-002",
                "name": "Northstar Wealth",
                "jurisdiction": "FR",
                "countries": ["FR", "ES", "IT"],
                "regulated_entities": ["Wealth Management", "Asset Management"],
                "risk_tier": "MEDIUM",
                "kyc_status": "ACTIVE",
                "keywords": ["asset management", "wealth", "aml"],
            },
            {
                "client_id": "eu-003",
                "name": "Helio Insurance Group",
                "jurisdiction": "NL",
                "countries": ["NL", "BE", "DE"],
                "regulated_entities": ["Insurance", "Claims"],
                "risk_tier": "HIGH",
                "kyc_status": "ACTIVE",
                "keywords": ["insurance", "claims", "solvency"],
            },
        ]

    def list_active_clients(self) -> list[dict[str, Any]]:
        return [client for client in self.clients if client["kyc_status"] == "ACTIVE"]

    def find_relevant_clients(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        event_text = " ".join(
            [
                event.get("title", ""),
                event.get("summary", ""),
                event.get("source", ""),
            ]
        ).lower()
        matches: list[dict[str, Any]] = []
        for client_record in self.list_active_clients():
            if any(keyword.lower() in event_text for keyword in client_record.get("keywords", [])):
                matches.append(client_record)
        if not matches:
            matches = self.list_active_clients()
        return matches


mock_bq = MockBigQueryWrapper()


def build_risk_prompt(event: dict[str, Any], client_record: dict[str, Any]) -> str:
    return (
        "You are a European regulatory compliance analyst. "
        f"Assess whether the regulatory or news item below materially impacts client {client_record['name']} "
        f"in jurisdiction {client_record['jurisdiction']}. "
        "Return a concise structured JSON object with client_id, client_name, regulatory_match, risk_level, "
        "summary, recommended_action, and evidence.\n\n"
        f"Event title: {event.get('title', '')}\n"
        f"Event summary: {event.get('summary', '')}\n"
        f"Source: {event.get('source', '')}\n"
        f"Client regulated entities: {', '.join(client_record.get('regulated_entities', []))}\n"
        "Focus on EU AML, sanctions, cybersecurity, market abuse, and prudential regulation obligations."
    )


def build_fallback_assessment(event: dict[str, Any], client_record: dict[str, Any], reason: str) -> RiskAssessment:
    event_text = " ".join([event.get("title", ""), event.get("summary", ""), event.get("source", "")]).lower()
    regulatory_match = any(term in event_text for term in ["regulatory", "aml", "sanctions", "guidance", "enforcement", "cyber", "prudential", "compliance"])
    risk_level = "HIGH" if regulatory_match and client_record.get("risk_tier") == "HIGH" else "MEDIUM"
    return RiskAssessment(
        client_id=client_record.get("client_id", "unknown"),
        client_name=client_record.get("name", "Unknown client"),
        regulatory_match=regulatory_match,
        risk_level=risk_level,
        summary=f"Fallback assessment due to model unavailability: {reason}",
        recommended_action="Manually review the event and verify the compliance signal with the local team.",
        evidence=[f"Model unavailable: {reason}"],
    )


def run_structured_assessment(event: dict[str, Any], client_record: dict[str, Any]) -> RiskAssessment:
    if client is None:
        return build_fallback_assessment(event, client_record, "Vertex AI client unavailable")

    models_to_try = ["gemini-2.5-pro", "gemini-2.0-flash-001"]
    last_error = None

    for model_name in models_to_try:
        try:
            prompt = build_risk_prompt(event, client_record)
            config = types.GenerateContentConfig(
                response_schema=RiskAssessment,
                response_mime_type="application/json",
                temperature=0,
            )
            result = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )
            parsed = getattr(result, "parsed", None)
            if parsed is not None:
                return parsed
            if getattr(result, "text", None):
                return RiskAssessment.model_validate_json(result.text)
        except Exception as exc:  # pragma: no cover - runtime guard
            last_error = exc
            logger.warning("Structured assessment failed with %s: %s", model_name, exc)

    return build_fallback_assessment(event, client_record, str(last_error or "No structured response returned"))


def run_adverse_media_check(client_record: dict[str, Any], event: dict[str, Any]) -> str:
    if client is None:
        return "Vertex AI grounding unavailable; manual adverse media review required."

    models_to_try = ["gemini-2.5-flash", "gemini-2.0-flash-001"]
    last_error = None

    for model_name in models_to_try:
        try:
            search_prompt = (
                f"Gather recent adverse media or enforcement signals for {client_record['name']} in relation to "
                f"{event.get('title', '')}. Provide a short summary with factual references only."
            )
            config = types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0,
            )
            result = client.models.generate_content(
                model=model_name,
                contents=search_prompt,
                config=config,
            )
            return getattr(result, "text", "No grounding results returned")
        except Exception as exc:  # pragma: no cover - runtime guard
            last_error = exc
            logger.warning("Grounding failed with %s: %s", model_name, exc)

    return f"Grounding unavailable: {last_error or 'No grounding response returned'}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "region": REGION, "project": PROJECT_ID}


@app.post("/events")
async def process_event(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception as exc:  # pragma: no cover - defensive path
        logger.warning("Invalid payload: %s", exc)
        return JSONResponse(status_code=400, content={"status": "invalid-payload"})

    if "message" in payload and "data" in payload["message"]:
        raw_payload = base64.b64decode(payload["message"]["data"]).decode("utf-8")
        event = json.loads(raw_payload)
    else:
        event = payload

    relevant_clients = mock_bq.find_relevant_clients(event)
    assessments: list[dict[str, Any]] = []

    for client_record in relevant_clients:
        assessment = run_structured_assessment(event, client_record)
        adverse_media = run_adverse_media_check(client_record, event)
        assessments.append(
            {
                "client_id": assessment.client_id,
                "client_name": assessment.client_name,
                "regulatory_match": assessment.regulatory_match,
                "risk_level": assessment.risk_level,
                "summary": assessment.summary,
                "recommended_action": assessment.recommended_action,
                "evidence": assessment.evidence,
                "adverse_media": adverse_media,
            }
        )

    return JSONResponse(status_code=200, content={"status": "processed", "region": REGION, "assessments": assessments})


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "regulatory-processor", "region": REGION}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
