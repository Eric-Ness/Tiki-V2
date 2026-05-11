/**
 * Determine the appropriate Tiki command to run when a kanban card is moved
 * (or auto-resumed) into the Execute column.
 *
 * For Review→Execute drags, work that is `paused` or `failed` already has a
 * plan + partial phase progress; resume with `/tiki:execute --continue`
 * rather than replaying the full pipeline (which would overwrite plan
 * state). Issue #130 fixed the underlying mis-routing.
 *
 * Extracted from KanbanBoard.tsx so it can be unit-tested without rendering
 * the full component tree.
 */
export function getExecuteCommand(
  issueNumber: number,
  fromColumn: string,
  status?: string
): string {
  if (fromColumn === 'review') {
    if (status === 'paused' || status === 'failed') {
      return `/tiki:execute ${issueNumber} --continue`;
    }
    // reviewing / pending / undefined → full pipeline
    return `/tiki:yolo ${issueNumber}`;
  }
  if (fromColumn === 'open') {
    return `/tiki:yolo ${issueNumber}`;
  }
  // Plan column or resume from elsewhere — has a plan, just execute.
  return `/tiki:execute ${issueNumber}`;
}
