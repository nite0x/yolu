import {renderToStaticMarkup} from "react-dom/server"
import type {ComponentProps} from "react"
import {Projects, type ProjectFilter} from "./ui/projects"
import {ProjectScanResults} from "./ui/scan"
import type {Project} from "@/entities/projects/model"
import type {ProjectOpenTool} from "@/entities/projects/presentation"

export const projectUI = {
  projectScanResults: (scan: Parameters<typeof ProjectScanResults>[0]) => renderToStaticMarkup(<ProjectScanResults {...scan} />),
  projects: (projects: Project[], selectedID: string | null, openTool: ProjectOpenTool, filter: ProjectFilter, detailOpen: boolean, detailView: ComponentProps<typeof Projects>["detailView"], searching?: boolean, status?: ComponentProps<typeof Projects>["status"]) => renderToStaticMarkup(<Projects projects={projects} selectedID={selectedID} openTool={openTool} filter={filter} detailOpen={detailOpen} detailView={detailView} searching={searching} status={status} />),
}
