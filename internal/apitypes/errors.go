package apitypes

type APIErrorResponse struct {
	ConflictDirectory string   `json:"conflict_directory,omitempty"`
	Error             string   `json:"error"`
	Code              string   `json:"code,omitempty"`
	Details           []string `json:"details,omitempty"`
	Command           string   `json:"command,omitempty"`
	RequestID         string   `json:"request_id,omitempty"`
}
