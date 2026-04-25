import asyncio
import threading
import uvicorn
from main import app
from agents.agentverse_agent import physio_agent


def run_fastapi():
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    api_thread = threading.Thread(target=run_fastapi, daemon=True)
    api_thread.start()

    physio_agent.run()
