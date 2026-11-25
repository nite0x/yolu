import {MessagePartPrimitive, useAuiState, type TextMessagePartComponent} from "@assistant-ui/react";
import type {QuestionReply} from "./question-replies";

export const ChatUserText: TextMessagePartComponent = () => {
  const replies = useAuiState(s => s.message.metadata.custom.questionReplies) as QuestionReply[] | undefined;
  if (!replies) return <p style={{whiteSpace: "pre-line"}}><MessagePartPrimitive.Text /><MessagePartPrimitive.InProgress><span style={{fontFamily: "revert"}}>{" \u25CF"}</span></MessagePartPrimitive.InProgress></p>;
  return <dl className="chat-question-replies m-0 flex flex-col gap-3 whitespace-pre-wrap wrap-anywhere leading-relaxed">
    {replies.map((reply, index) => <div key={index} className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{reply.question}</dt>
      <dd className="m-0 text-foreground">{reply.answer}</dd>
    </div>)}
  </dl>;
};
