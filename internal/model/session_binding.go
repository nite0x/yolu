package model

const (
	SessionBindingPrimary    = "primary"
	SessionBindingAdditional = "additional"
	SessionBindingRead       = "read"
	SessionBindingWrite      = "write"
)

// SessionProjectBinding records a conversation's selected directory and requested
// access. The runtime supplies its current branch, status and configuration error
// when presenting the binding.
type SessionProjectBinding struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	ProjectID string `json:"project_id,omitempty"`
	Directory string `json:"directory"`
	Branch    string `json:"branch,omitempty"`
	Role      string `json:"role"`
	Access    string `json:"access"`
	Status    string `json:"status,omitempty"`
	Error     string `json:"error,omitempty"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}
