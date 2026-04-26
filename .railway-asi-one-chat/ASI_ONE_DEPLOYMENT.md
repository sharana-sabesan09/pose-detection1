# ASI:One / Agentverse Deployment

This path is designed to avoid interfering with the existing backend service.

## What stays unchanged

- `run_agent.py`
- `agents/agentverse_agent.py`
- `agents/bureau.py`
- `railway.toml`

The ACP agent uses its own runner:

- `run_asi_one_chat_agent.py`

## Safe deployment shape

Deploy the ACP agent as a separate service or process.

Recommended approach on Railway:

1. Keep the current backend service unchanged.
2. Create a second service from the same repo and the same `backend/` root.
3. Set the start command to:

```bash
uv run python run_asi_one_chat_agent.py
```

4. Point the ACP agent at the same production database and API keys as the backend.
5. Give the ACP agent its own public URL.
6. Set `ASI_ONE_AGENT_ENDPOINT` to the public submit endpoint:

```text
https://<your-domain>/submit
```

## Environment variables

Existing backend variables still apply:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `CHROMA_PERSIST_DIR`
- `DEV_MODE`

ACP-specific variables:

- `ASI_ONE_AGENT_SEED`
- `ASI_ONE_AGENT_NAME`
- `ASI_ONE_AGENT_HANDLE`
- `ASI_ONE_AGENT_PORT`
- `ASI_ONE_AGENT_ENDPOINT`
- `ASI_ONE_AGENT_USE_MAILBOX=false`

## Agentverse registration

After the ACP runner is live and reachable:

1. Open Agentverse.
2. Go to `Agents`.
3. Choose `Launch an Agent`.
4. Choose `Connect Agent`.
5. Choose `Chat Protocol`.
6. Enter the agent name and the public endpoint.
7. Add focused keywords such as `physiotherapy`, `rehab`, `injury recovery`, `progress tracking`.
8. Complete the registration flow and evaluate the agent.

## ASI:One UI usage

From the Agentverse dashboard, click `Chat with Agent`.

That opens the ASI:One UI for this agent.

Suggested prompts:

```text
/latest_report patient_id=patient-123
```

```text
/progress patient_id=patient-123
```

```text
/advice patient_id=patient-123 question="Can I increase squat depth this week?"
```
