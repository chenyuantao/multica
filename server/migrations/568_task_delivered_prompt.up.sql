-- The first user prompt a daemon handed to the agent for this run.
-- Kept off agent_task_queue so task reads do not carry the body.
-- No foreign key: task teardown deletes the row explicitly.
CREATE TABLE IF NOT EXISTS task_delivered_prompt (
    task_id UUID PRIMARY KEY,
    prompt TEXT NOT NULL,
    truncated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
