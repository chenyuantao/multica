package imind

import _ "embed"

// AgentInstructions is distributed by the backend through scoped file-share operations.
// Keep it synchronized with the note codec and file-share rules.
//
//go:embed agent-instructions.md
var AgentInstructions string
