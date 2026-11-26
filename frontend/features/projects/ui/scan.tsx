import {uiText} from "@/shared/i18n"
import {Input} from "@/shared/ui/primitives/input"
import {Check} from "@/shared/ui/forms/check"
import {Feedback} from "@/shared/ui/feedback/message"

interface ScannedRepository {
  path: string
  name: string
  common_dir: string
  project_id?: string
  selected: boolean
  error?: string
}

export function ProjectScanResults({ repositories, warnings, truncated }: {
  repositories: ScannedRepository[]
  warnings: { path: string; message: string }[]
  truncated: boolean
}) {
  const available = repositories.filter(repository => !repository.project_id)
  return <div className="project-scan-results">
    <p className="text-sm text-muted-foreground" role="status">{repositories.length ? uiText("发现 {0} 个仓库，其中 {1} 个已登记。", repositories.length, repositories.length - available.length) : uiText("此目录下未发现可登记的 Git 仓库。")}</p>
    {truncated ? <Feedback>{uiText("扫描已达到目录或仓库数量上限，请选择更小的目录继续扫描。")}</Feedback> : null}
    {!!available.length && <Check id="projectScanSelectAll" label={uiText("全选未登记仓库")} defaultChecked={available.every(repository => repository.selected)} />}
    <ul className="project-scan-list">{repositories.map((repository, index) => <li key={repository.path} data-scan-row={index}>
      <Check data-scan-select={index} disabled={!!repository.project_id} defaultChecked={repository.selected && !repository.project_id} label={repository.project_id ? uiText("已登记 · {0}", repository.name) : repository.name} />
      <code className="project-scan-path">{repository.path}</code>
      {!repository.project_id ? <><label className="sr-only" htmlFor={`projectScanName${index}`}>{uiText("{0} 的项目名称", repository.path)}</label><Input id={`projectScanName${index}`} data-scan-name={index} aria-label={uiText("{0} 的项目名称", repository.path)} defaultValue={repository.name} maxLength={80} /></> : null}
      {repository.error ? <Feedback tone="error" role="alert">{uiText(repository.error)}</Feedback> : null}
    </li>)}</ul>
    {!!warnings.length && <details className="text-sm text-muted-foreground"><summary>{uiText("{0} 个目录读取失败", warnings.length)}</summary><ul>{warnings.map(warning => <li key={warning.path}><code className="project-scan-path">{warning.path}</code><span>{warning.message}</span></li>)}</ul></details>}
  </div>
}
