import {renderToStaticMarkup} from "react-dom/server"
import {mountGitView, resetGitView, scrollToGitSection} from "./ui/interactive"
import {SourceOptions} from "@/entities/projects/presentation"
import type {GitOverview} from "@/entities/projects/model"

export const gitUI = {
  mountGitView, resetGitView, scrollToGitSection,
  sourceOptions: (overview: GitOverview, includeHead = true) => renderToStaticMarkup(<SourceOptions overview={overview} includeHead={includeHead} />),
}
