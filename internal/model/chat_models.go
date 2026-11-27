package model

// ChatModel is the shared model catalog representation exposed by the API.
type ChatModel struct {
	ID            string             `json:"id"`
	Model         string             `json:"model"`
	Name          string             `json:"displayName"`
	Default       bool               `json:"isDefault"`
	DefaultEffort string             `json:"defaultReasoningEffort"`
	ServiceTiers  []ModelServiceTier `json:"serviceTiers,omitempty"`
	Efforts       []struct {
		Effort string `json:"reasoningEffort"`
	} `json:"supportedReasoningEfforts"`
}

type ModelServiceTier struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
