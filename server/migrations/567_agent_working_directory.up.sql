-- Per-agent working directory. An absolute path on the machine of the agent's
-- runtime; the daemon runs the agent in place there when the task's project
-- has no local_directory resource for that daemon. NULL keeps the default
-- daemon-managed task workdir.
ALTER TABLE agent ADD COLUMN working_directory TEXT;
