import type { ThreadMessageLike } from "@assistant-ui/react";
import type {
  AssistantActivity,
  AssistantMessage,
  AssistantPlan,
  AssistantSnapshot,
} from "./global-assistant-controller";

export const assistantReplyID = (runID: string) => `assistant:${runID}`;

// Keep a reply's identity while its cards arrive before the final model text.
// Only attach actions to loaded turns so paginated history keeps its order.
export function assistantMessages(snapshot: AssistantSnapshot): ThreadMessageLike[] {
  const actions = new Map<string, { activities: AssistantActivity[]; plans: AssistantPlan[] }>();
  for (const activity of snapshot.activities || []) {
    const group = actions.get(activity.run_id) || { activities: [], plans: [] };
    group.activities.push(activity);
    actions.set(activity.run_id, group);
  }
  for (const plan of snapshot.plans || []) {
    const group = actions.get(plan.run_id) || { activities: [], plans: [] };
    group.plans.push(plan);
    actions.set(plan.run_id, group);
  }

  const turns = new Map<string, AssistantMessage[]>();
  for (const message of snapshot.messages) {
    // Older text-only snapshots may omit run IDs.
    const key = message.run_id || `message:${message.id}`;
    const turn = turns.get(key) || [];
    turn.push(message);
    turns.set(key, turn);
  }
  const messages: ThreadMessageLike[] = [];
  for (const [key, turn] of turns) {
    const runID = turn[0].run_id;
    const content: Exclude<ThreadMessageLike["content"], string>[number][] = [];
    for (const message of turn) {
      if (message.role === "user") {
        messages.push({ id: String(message.id), role: "user", content: message.text });
      } else {
        content.push({ type: "text", text: message.text });
      }
    }
    const group = actions.get(runID);
    if (group) {
      content.push({
        type: "tool-call",
        toolCallId: `actions:${runID}`,
        toolName: "yolu.actions",
        args: { run_id: runID },
        argsText: JSON.stringify({ run_id: runID }),
        result: group,
      });
    }
    if (content.length) {
      messages.push({
        id: runID ? assistantReplyID(runID) : String(turn[0].id),
        role: "assistant",
        content,
        status: snapshot.run?.id === key && snapshot.run.status === "running"
          ? { type: "running" }
          : { type: "complete", reason: "stop" },
      });
    }
  }
  return messages;
}
