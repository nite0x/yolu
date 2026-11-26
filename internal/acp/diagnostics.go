package acp

type DiagnosticCheck struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Advice  string `json:"advice,omitempty"`
}

type Diagnostics struct {
	Platform    string            `json:"platform"`
	User        string            `json:"user"`
	CLIPath     string            `json:"cli_path"`
	Candidates  []string          `json:"candidates"`
	Version     string            `json:"version,omitempty"`
	AgentName   string            `json:"agent_name,omitempty"`
	CheckedAt   string            `json:"checked_at"`
	Status      string            `json:"status"`
	Checks      []DiagnosticCheck `json:"checks"`
	AuthMethods []AuthMethod      `json:"auth_methods,omitempty"`
}
