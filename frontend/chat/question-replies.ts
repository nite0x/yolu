export interface QuestionReply { question: string; answer: string }

// Only unwrap a complete Codex reply envelope. Quoted examples, mixed prose
// and malformed payloads remain ordinary user content rather than losing text.
export function readQuestionReplies(text: string): QuestionReply[] | undefined {
  const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
  if (!match) return;
  try {
    const replies: unknown = JSON.parse(match[1]);
    if (!Array.isArray(replies) || !replies.length || !replies.every(reply =>
      reply && typeof reply === "object" && typeof reply.questionItemId === "string" && reply.questionItemId.length > 0 &&
      typeof reply.question === "string" && reply.question.trim() && typeof reply.answer === "string"
    )) return;
    return replies.map(({question, answer}) => ({question, answer}));
  } catch { return; }
}
