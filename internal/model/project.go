package model

type Project struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Path            string     `json:"path"`
	CommonDir       string     `json:"common_dir"`
	Folder          string     `json:"folder"`
	CreatedAt       string     `json:"created_at"`
	HasMaster       bool       `json:"has_master"`
	Error           string     `json:"error,omitempty"`
	Worktrees       []Worktree `json:"worktrees"`
	StatusUpdatedAt string     `json:"status_updated_at,omitempty"`
	Refreshing      bool       `json:"refreshing"`
}
type Worktree struct {
	Path             string           `json:"path"`
	Branch           string           `json:"branch"`
	Head             string           `json:"head"`
	Bare             bool             `json:"bare"`
	Detached         bool             `json:"detached"`
	Locked           bool             `json:"locked"`
	Prunable         bool             `json:"prunable"`
	Missing          bool             `json:"missing"`
	Dirty            int              `json:"dirty"`
	Changes          *WorktreeChanges `json:"changes,omitempty"`
	Ahead            int              `json:"ahead"`
	Behind           int              `json:"behind"`
	CompareAvailable bool             `json:"compare_available"`
	ComparisonRef    string           `json:"comparison_ref,omitempty"`
	Upstream         string           `json:"upstream,omitempty"`
	SyncAvailable    bool             `json:"sync_available"`
	SyncAhead        int              `json:"sync_ahead"`
	SyncBehind       int              `json:"sync_behind"`
	Operation        string           `json:"operation,omitempty"`
	MergeHead        string           `json:"merge_head,omitempty"`
	Conflicts        []string         `json:"conflicts,omitempty"`
	Error            string           `json:"error,omitempty"`
	StatusUpdatedAt  string           `json:"status_updated_at,omitempty"`
	Refreshing       bool             `json:"refreshing"`
}

type WorktreeChanges struct {
	Modified int `json:"modified"`
	Added    int `json:"added"`
	Deleted  int `json:"deleted"`
}
