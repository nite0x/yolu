package model

const (
	ProviderCodex      = "codex"
	ProviderAgy        = "agy"
	ProviderCodexCloud = "codex-cloud"
)

func NormalizeProvider(provider string) string {
	switch provider {
	case "", ProviderCodex:
		return ProviderCodex
	case ProviderAgy:
		return ProviderAgy
	default:
		return provider
	}
}

func SupportedProvider(provider string) bool {
	return provider == "" || provider == ProviderCodex || provider == ProviderAgy
}

type ProviderCapabilities struct {
	Steer                      bool `json:"steer"`
	Fork                       bool `json:"fork"`
	Handoff                    bool `json:"handoff"`
	RateLimits                 bool `json:"rate_limits"`
	Voice                      bool `json:"voice"`
	MultipleDirectories        bool `json:"multiple_directories"`
	DynamicDirectoryAccess     bool `json:"dynamic_directory_access"`
	NativePermissionRequests   bool `json:"native_permission_requests"`
	ActivityEvents             bool `json:"activity_events"`
	EnforceReadOnlyDirectories bool `json:"enforce_read_only_directories"`
}

func CapabilitiesForProvider(provider string) ProviderCapabilities {
	if NormalizeProvider(provider) != ProviderCodex {
		return ProviderCapabilities{ActivityEvents: true}
	}
	return ProviderCapabilities{Steer: true, Fork: true, Handoff: true, RateLimits: true, Voice: true, MultipleDirectories: true, DynamicDirectoryAccess: true, NativePermissionRequests: true, ActivityEvents: true, EnforceReadOnlyDirectories: true}
}

// Session is an environment-local index of a coding agent conversation.
// Each runtime environment already has its own Store, so IDs and paths never
// cross environments.
type Session struct {
	Pinned                bool     `json:"pinned"`
	Archived              bool     `json:"archived"`
	ID                    string   `json:"id"`
	Provider              string   `json:"provider,omitempty"`
	CloudEnvironment      string   `json:"cloud_environment,omitempty"`
	Permission            string   `json:"permission,omitempty"`
	Name                  string   `json:"name"`
	TitleSource           string   `json:"title_source,omitempty"`
	TitleChangedAt        int64    `json:"-"`
	Cwd                   string   `json:"cwd"`
	CreatedAt             int64    `json:"created_at"`
	UpdatedAt             int64    `json:"updated_at"`
	Source                string   `json:"source"`
	LastSyncedAt          int64    `json:"last_synced_at"`
	AdditionalDirectories []string `json:"additional_directories,omitempty"`
	ProjectDirectories    []string `json:"project_directories,omitempty"`
	Available             bool     `json:"available"`
	Error                 string   `json:"error,omitempty"`
	ChatStatus            string   `json:"chat_status,omitempty"`
	CompletedRun          string   `json:"completed_run,omitempty"`
}
