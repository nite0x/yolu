import type {DirectoryBindingInput} from "@/api/contracts"

export interface BindingInput extends Omit<DirectoryBindingInput, "access" | "role"> {
  project_id?: string; directory?: string; access: "read" | "write"; role?: "primary" | "additional"; allow_shared?: boolean;
}
export interface SessionTarget { project_id?: string; cwd?: string; access?: "read" | "write"; allow_shared?: boolean; bindings?: BindingInput[] }
