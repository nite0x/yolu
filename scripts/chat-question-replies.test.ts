import {test} from "node:test";
import assert from "node:assert/strict";
import {convertEntry, type Entry} from "../frontend/chat/model";
import {readQuestionReplies} from "../frontend/chat/question-replies";

const replies = [
  {questionItemId: '["request_user_input_async","call_1",0]', question: '这次是准备发布到哪个环境？我先按“新加坡生产环境，相对现有 master 发布版本”整理差异。', answer: "T3 测试环境"},
  {questionItemId: '["request_user_input_async","call_1",1]', question: "需要保留哪些内容？", answer: '保留表结构\n\n保留 `id` 和 <script>alert("literal")</script>'},
];
const envelope = (payload: unknown) => `<send_user_message_question_reply>\n${JSON.stringify(payload)}\n</send_user_message_question_reply>`;
const user = (text: string): Entry => ({id:"reply",turn_id:"turn",kind:"user",text});

test("Codex question replies expose readable text and ordered pairs without mutating the source", () => {
  const entry = {...user(envelope(replies)), images:["data:image/png;base64,aGVsbG8="]};
  const original = structuredClone(entry);
  const message = convertEntry(entry);
  assert.equal(message.role, "user");
  assert.deepEqual(message.metadata?.custom?.questionReplies, replies.map(({question, answer}) => ({question, answer})));
  assert.deepEqual(message.content, [
    {type:"text",text:replies.map(({question, answer}) => `${question}\n${answer}`).join("\n\n")},
    {type:"image",image:entry.images[0]},
  ]);
  assert.deepEqual(entry, original);
  assert.equal(convertEntry({...entry,kind:"assistant"}).metadata, undefined);
});

test("ordinary messages, quoted examples and invalid envelopes retain all their text", () => {
  const valid = envelope(replies);
  for (const text of ["T3 测试环境", `Example:\n${valid}`, `\`\`\`xml\n${valid}\n\`\`\``, `${valid}\n补充内容`,
    "<send_user_message_question_reply>[bad JSON]</send_user_message_question_reply>",
    envelope([]), envelope(null), envelope([null]), envelope([{...replies[0],answer:3}]),
    envelope([{...replies[0],questionItemId:null}]), envelope([replies[0],{question:"missing answer"}])]) {
    assert.equal(readQuestionReplies(text), undefined);
    assert.deepEqual(convertEntry(user(text)).content, [{type:"text",text}]);
  }
  assert.equal(readQuestionReplies(` \n${valid}\n `)?.length, 2);
  assert.deepEqual(readQuestionReplies(envelope([{...replies[0],answer:""}]))?.[0].answer, "");
});
