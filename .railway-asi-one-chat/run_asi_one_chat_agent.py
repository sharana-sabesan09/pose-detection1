import os
import threading

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from agents.asi_one_chat_agent import sentinel_asi_one_agent

PUBLIC_PORT = int(os.environ.get("PORT", "8080"))
INTERNAL_AGENT_PORT = int(os.environ.get("ASI_ONE_AGENT_PORT", "8001"))
INTERNAL_AGENT_BASE = f"http://127.0.0.1:{INTERNAL_AGENT_PORT}"
PROXY_METHODS = ["GET", "POST", "HEAD", "OPTIONS"]
HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

app = FastAPI(title="Sentinel ASI:One Gateway")


async def _proxy_to_agent(request: Request, path: str) -> Response:
    body = await request.body()
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "content-length"}
    }

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        upstream = await client.request(
            request.method,
            f"{INTERNAL_AGENT_BASE}{path}",
            headers=headers,
            content=body,
        )

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


@app.api_route("/health", methods=["GET"])
async def gateway_health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            upstream = await client.get(f"{INTERNAL_AGENT_BASE}/agent_info")
        if upstream.status_code == 200:
            return JSONResponse({"status": "ok"})
    except httpx.HTTPError:
        pass
    return JSONResponse({"status": "starting"}, status_code=503)


@app.api_route("/agent_info", methods=["GET"])
async def gateway_agent_info(request: Request):
    proxied = await _proxy_to_agent(request, "/agent_info")
    if proxied.status_code != 200:
        return proxied

    try:
        payload = await request.app.state.httpx_decoder(proxied.body)
    except Exception:
        return proxied

    payload["port"] = PUBLIC_PORT
    return JSONResponse(payload, status_code=200)


@app.api_route("/", methods=PROXY_METHODS)
async def gateway_root(request: Request):
    return await _proxy_to_agent(request, "/submit")


@app.api_route("/{path:path}", methods=PROXY_METHODS)
async def gateway_passthrough(path: str, request: Request):
    return await _proxy_to_agent(request, f"/{path}")


async def _decode_json_bytes(body: bytes) -> dict:
    import json

    return json.loads(body.decode("utf-8"))


app.state.httpx_decoder = _decode_json_bytes


def run_gateway():
    uvicorn.run(app, host="0.0.0.0", port=PUBLIC_PORT, log_level="warning")


if __name__ == "__main__":
    gateway_thread = threading.Thread(target=run_gateway, daemon=True)
    gateway_thread.start()
    sentinel_asi_one_agent.run()
